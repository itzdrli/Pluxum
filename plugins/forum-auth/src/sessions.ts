import { defineRedisScript, type RedisConnection } from '@pluxel/plugin-redis'
import { randomToken, sha256Hex } from './crypto'

// Key layout (one forum per Redis database):
//   forum:sess:<sha256(session id)>   hash  userId, sid, createdAt, seenAt, expiresAt, ua
//   forum:user-sess:<userId>          set   session hashes of one account ("log out everywhere")
//   forum:sid-sess:<sha256(OIDC sid)> set   session hashes of one provider session (back-channel)
//   forum:oidc-state:<sha256(state)>  string  pending login, single use
// Redis only ever sees hashes of the cookie value and of the OIDC state, so a dump of the keyspace
// cannot be replayed as a session.
const SESSION = 'forum:sess:'
const USER_SESSIONS = 'forum:user-sess:'
const SID_SESSIONS = 'forum:sid-sess:'
const LOGIN_STATE = 'forum:oidc-state:'

// The revoke scripts derive member keys from stored data, which is fine on the single-node
// deployments the forum targets and would need hash tags before moving to Redis Cluster.
const REVOKE_ONE = `
local function revoke(hash)
	local key = ARGV[1] .. hash
	local owner = redis.call('HMGET', key, 'userId', 'sid')
	if not owner[1] then return 0 end
	redis.call('DEL', key)
	redis.call('SREM', ARGV[2] .. owner[1], hash)
	if owner[2] and owner[2] ~= '' then redis.call('SREM', ARGV[3] .. owner[2], hash) end
	return 1
end
`

const Create = defineRedisScript<
	readonly [session: string, userSessions: string, sidSessions: string],
	readonly [
		hash: string,
		userId: string,
		sidHash: string,
		now: string,
		expiresAt: string,
		idleTtlMs: string,
		userAgent: string,
	],
	void
>({
	name: 'forum.session.create',
	numberOfKeys: 3,
	source: `
local absolute = tonumber(ARGV[5]) - tonumber(ARGV[4])
redis.call('HSET', KEYS[1], 'userId', ARGV[2], 'sid', ARGV[3], 'createdAt', ARGV[4],
	'seenAt', ARGV[4], 'expiresAt', ARGV[5], 'ua', ARGV[7])
redis.call('PEXPIRE', KEYS[1], math.min(tonumber(ARGV[6]), absolute))
redis.call('SADD', KEYS[2], ARGV[1])
if redis.call('PTTL', KEYS[2]) < absolute then redis.call('PEXPIRE', KEYS[2], absolute) end
if ARGV[3] ~= '' then
	redis.call('SADD', KEYS[3], ARGV[1])
	if redis.call('PTTL', KEYS[3]) < absolute then redis.call('PEXPIRE', KEYS[3], absolute) end
end
return 1`,
	decode: () => undefined,
})

/** Reads a session and slides its idle expiry, never past its absolute end. */
const Touch = defineRedisScript<
	readonly [session: string],
	readonly [now: string, idleTtlMs: string],
	string | null
>({
	name: 'forum.session.touch',
	numberOfKeys: 1,
	source: `
local session = redis.call('HMGET', KEYS[1], 'userId', 'expiresAt')
if not session[1] then return false end
local remaining = tonumber(session[2]) - tonumber(ARGV[1])
if remaining <= 0 then return false end
redis.call('HSET', KEYS[1], 'seenAt', ARGV[1])
redis.call('PEXPIRE', KEYS[1], math.min(tonumber(ARGV[2]), remaining))
return session[1]`,
	decode: (reply) => (typeof reply === 'string' ? reply : null),
})

const prefixes = [SESSION, USER_SESSIONS, SID_SESSIONS] as const
type Prefixes = readonly [session: string, userSessions: string, sidSessions: string]

const Revoke = defineRedisScript<readonly [], readonly [...Prefixes, hash: string], number>({
	name: 'forum.session.revoke',
	numberOfKeys: 0,
	source: `${REVOKE_ONE}
return revoke(ARGV[4])`,
	decode: Number,
})

/** Revokes every session listed in an index set (per account or per provider session). */
const RevokeIndexed = defineRedisScript<readonly [index: string], Prefixes, number>({
	name: 'forum.session.revoke-indexed',
	numberOfKeys: 1,
	source: `${REVOKE_ONE}
local revoked = 0
for _, hash in ipairs(redis.call('SMEMBERS', KEYS[1])) do revoked = revoked + revoke(hash) end
redis.call('DEL', KEYS[1])
return revoked`,
	decode: Number,
})

const PutLoginState = defineRedisScript<
	readonly [state: string],
	readonly [value: string, ttlMs: string],
	void
>({
	name: 'forum.login-state.put',
	numberOfKeys: 1,
	source: `return redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])`,
	decode: () => undefined,
})

const TakeLoginState = defineRedisScript<readonly [state: string], readonly [], string | null>({
	name: 'forum.login-state.take',
	numberOfKeys: 1,
	source: `
local value = redis.call('GET', KEYS[1])
if value then redis.call('DEL', KEYS[1]) end
return value`,
	decode: (reply) => (typeof reply === 'string' ? reply : null),
})

export type SessionTtl = Readonly<{ idleTtlSeconds: number; absoluteTtlSeconds: number }>

export type NewSession = Readonly<{
	userId: string
	/** OIDC provider session ID, when the provider issued one. */
	sid: string | undefined
	userAgent: string | null
}>

/**
 * Server-side sessions in Redis. Every operation is one atomic script; a Redis failure rejects and
 * the caller decides what an unreachable session store means for the request.
 */
export class SessionStore {
	constructor(
		private readonly connection: () => RedisConnection,
		private readonly ttl: () => SessionTtl,
	) {}

	/** Opens a session and returns its secret ID, which only the browser cookie keeps. */
	async create(session: NewSession): Promise<string> {
		const id = randomToken()
		const hash = await sha256Hex(id)
		const sidHash = session.sid === undefined ? '' : await sha256Hex(session.sid)
		const now = Date.now()
		const { idleTtlSeconds, absoluteTtlSeconds } = this.ttl()
		await this.connection().scripts.run(Create, {
			keys: [SESSION + hash, USER_SESSIONS + session.userId, SID_SESSIONS + sidHash],
			arguments: [
				hash,
				session.userId,
				sidHash,
				String(now),
				String(now + absoluteTtlSeconds * 1000),
				String(idleTtlSeconds * 1000),
				// A digest is enough to tell devices apart later without storing the raw header.
				session.userAgent ? (await sha256Hex(session.userAgent)).slice(0, 16) : '',
			],
		})
		return id
	}

	/** The account a live session belongs to, renewing its idle expiry; null when it is gone. */
	async touch(id: string): Promise<string | null> {
		return this.connection().scripts.run(Touch, {
			keys: [SESSION + (await sha256Hex(id))],
			arguments: [String(Date.now()), String(this.ttl().idleTtlSeconds * 1000)],
		})
	}

	async revoke(id: string): Promise<boolean> {
		const revoked = await this.connection().scripts.run(Revoke, {
			keys: [],
			arguments: [...prefixes, await sha256Hex(id)],
		})
		return revoked > 0
	}

	/** Ends every session of an account; returns how many were live. */
	revokeUser(userId: string): Promise<number> {
		return this.connection().scripts.run(RevokeIndexed, {
			keys: [USER_SESSIONS + userId],
			arguments: prefixes,
		})
	}

	/** Ends the sessions that grew out of one provider session. */
	async revokeProviderSession(sid: string): Promise<number> {
		return this.connection().scripts.run(RevokeIndexed, {
			keys: [SID_SESSIONS + (await sha256Hex(sid))],
			arguments: prefixes,
		})
	}

	async putLoginState(state: string, value: string, ttlSeconds: number): Promise<void> {
		await this.connection().scripts.run(PutLoginState, {
			keys: [LOGIN_STATE + (await sha256Hex(state))],
			arguments: [value, String(ttlSeconds * 1000)],
		})
	}

	/** Returns a pending login exactly once. */
	async takeLoginState(state: string): Promise<string | null> {
		return this.connection().scripts.run(TakeLoginState, {
			keys: [LOGIN_STATE + (await sha256Hex(state))],
		})
	}
}
