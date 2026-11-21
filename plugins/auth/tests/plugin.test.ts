import { ForumAuthPlugin, CLIENT_SECRET_KEY } from '@pluxum/auth'
import { ForumCorePlugin } from '@pluxum/core'
import { ForumRedisPlugin } from '@pluxum/redis'
import { Plugin } from '@pluxel/core'
import { Redis, RedisNotRunningError, type RedisConnection } from '@pluxel/plugin-redis'
import { database } from '@pluxel/services/database'
import { pglite } from '@pluxel/services/database/pglite'
import { Vault, vault } from '@pluxel/services/vault'
import { createTestHost } from '@pluxel/test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { repairBase64Url } from '../src/base64-repair'
import { sha256Hex } from '../src/crypto'
import { CLIENT_ID, createMockIssuer, ISSUER, type MockUser } from './mock-issuer'

const ORIGIN = 'https://forum.test'
const COOKIE = '__Host-forum_session'

const createHost = () =>
	createTestHost({
		services: [database({ backend: pglite({ dataDir: 'memory://' }) }), vault()],
	})

type Host = Awaited<ReturnType<typeof createHost>>

const configured = (extra: Record<string, unknown> = {}) => ({
	publicOrigin: ORIGIN,
	oidc: { issuer: ISSUER, clientId: CLIENT_ID },
	...extra,
})

function down(): never {
	throw new RedisNotRunningError()
}

/** A Redis whose every command fails, as when the session store is down. */
@Plugin(Redis)
class BrokenRedis extends Redis {
	override connection(): RedisConnection {
		return {
			id: 'session',
			get client() {
				return down()
			},
			get scripts() {
				return down()
			},
		}
	}

	override connectionIds(): readonly string[] {
		return ['session']
	}
}

const withSession = (id: string) =>
	new Request(`${ORIGIN}/`, { headers: { cookie: `other=1; ${COOKIE}=${id}` } })

/** The session ID a `Set-Cookie` value hands to the browser. */
function sessionIdOf(setCookie: string): string {
	const [pair = ''] = setCookie.split(';')
	expect(pair.startsWith(`${COOKIE}=`)).toBe(true)
	return pair.slice(COOKIE.length + 1)
}

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('repairBase64Url', () => {
	it('replaces only fallbacks that ignore the base64url alphabet', () => {
		const original = Object.getOwnPropertyDescriptor(Uint8Array, 'fromBase64')
		try {
			// The fallback found in the host: standard base64 only, options ignored.
			Object.defineProperty(Uint8Array, 'fromBase64', {
				value: (text: string) => Uint8Array.from(atob(text), (char) => char.codePointAt(0) ?? 0),
				writable: true,
				configurable: true,
			})
			expect(repairBase64Url()).toContain('Uint8Array.fromBase64')
			const decode: unknown = Reflect.get(Uint8Array, 'fromBase64')
			if (typeof decode !== 'function') throw new Error('expected a function')
			const decoded: unknown = Reflect.apply(decode, Uint8Array, ['-_8', { alphabet: 'base64url' }])
			expect(decoded).toEqual(new Uint8Array([0xfb, 0xff]))
			// A correct implementation is left in place.
			expect(repairBase64Url()).not.toContain('Uint8Array.fromBase64')
		} finally {
			if (original) Object.defineProperty(Uint8Array, 'fromBase64', original)
			else Reflect.deleteProperty(Uint8Array, 'fromBase64')
		}
	})
})

describe('ForumAuthPlugin without a session store', () => {
	it('treats requests as guests and refuses to start a login when unconfigured', async () => {
		await using host = await createHost()
		await host.commit((change) => {
			change.start(BrokenRedis)
			change.start(ForumCorePlugin)
			change.start(ForumAuthPlugin)
		})
		const auth = host.require(ForumAuthPlugin)

		expect(auth.loginAvailable()).toBe(false)
		expect(await auth.authenticate(new Request(`${ORIGIN}/`))).toEqual({ status: 'guest' })
		const started = await auth.beginLogin('/')
		expect(started.isErr() && started.error.code).toBe('unavailable')
		// Nothing to protect without a public origin.
		expect(
			auth.allowsOrigin(new Request(`${ORIGIN}/`, { headers: { origin: 'https://evil.test' } })),
		).toBe(true)
	})

	it('reports a session it cannot check as unavailable, and guests as guests', async () => {
		await using host = await createHost()
		await host.commit((change) => {
			change.start(BrokenRedis)
			change.start(ForumCorePlugin)
			change.start(ForumAuthPlugin, { initialConfig: configured() })
		})
		const auth = host.require(ForumAuthPlugin)

		expect(await auth.authenticate(new Request(`${ORIGIN}/`))).toEqual({ status: 'guest' })
		// A malformed cookie is not a session and never reaches Redis.
		expect(await auth.authenticate(withSession('short'))).toEqual({ status: 'guest' })
		expect(await auth.authenticate(withSession('a'.repeat(43)))).toEqual({
			status: 'unavailable',
		})
		const everywhere = await auth.logoutEverywhere(withSession('a'.repeat(43)))
		expect(everywhere.isErr() && everywhere.error.code).toBe('unavailable')
		// Logging out still clears the browser's cookie.
		expect((await auth.logout(withSession('a'.repeat(43)))).setCookie).toContain('Max-Age=0')

		const request = (origin: string) => new Request(`${ORIGIN}/`, { headers: { origin } })
		expect(auth.allowsOrigin(request(ORIGIN))).toBe(true)
		expect(auth.allowsOrigin(request('https://evil.test'))).toBe(false)
		expect(auth.allowsOrigin(new Request(`${ORIGIN}/`))).toBe(true)
	})

	it('keeps test login off without a token hash and refuses a wrong token', async () => {
		await using host = await createHost()
		const hash = await sha256Hex('right-token')
		await host.commit((change) => {
			change.start(BrokenRedis)
			change.start(ForumCorePlugin)
			change.start(ForumAuthPlugin, { initialConfig: configured() })
		})
		const off = host.require(ForumAuthPlugin)
		expect(off.testLoginAvailable()).toBe(false)
		const disabled = await off.testLogin('right-token', { name: 'ada' }, null)
		expect(disabled.isErr() && disabled.error.code).toBe('unavailable')

		await using onHost = await createHost()
		await onHost.commit((change) => {
			change.start(BrokenRedis)
			change.start(ForumCorePlugin)
			change.start(ForumAuthPlugin, {
				initialConfig: configured({ testLoginTokenSha256: hash }),
			})
		})
		const on = onHost.require(ForumAuthPlugin)
		expect(on.testLoginAvailable()).toBe(true)
		const refused = await Promise.all(
			[null, 'wrong-token', ''].map((token) => on.testLogin(token, { name: 'ada' }, null)),
		)
		expect(refused.map((result) => result.isErr() && result.error.code)).toEqual([
			'rejected',
			'rejected',
			'rejected',
		])
		const badName = await on.testLogin('right-token', { name: 'Ada Lovelace' }, null)
		expect(badName.isErr() && badName.error.code).toBe('rejected')
	})

	it('refuses a plain HTTP public origin in production', async () => {
		const previous = process.env.NODE_ENV
		process.env.NODE_ENV = 'production'
		try {
			await using host = await createHost()
			const failure = await host.commitExpectFail((change) => {
				change.start(BrokenRedis)
				change.start(ForumCorePlugin)
				change.start(ForumAuthPlugin, {
					initialConfig: configured({ publicOrigin: 'http://forum.test' }),
				})
			})
			expect(failure.lifecycleReport.issues).toContainEqual(
				expect.objectContaining({ kind: 'start-failed' }),
			)
		} finally {
			process.env.NODE_ENV = previous
		}
	})
})

// Live checks against the dev valkey (compose.dev.yaml); set FORUM_TEST_REDIS_URL to enable.
const liveUrl = process.env.FORUM_TEST_REDIS_URL

async function start(host: Host, config: Record<string, unknown> = {}) {
	const issuer = await createMockIssuer()
	vi.stubGlobal('fetch', issuer.fetch)
	await host.commit((change) => {
		change.start(ForumRedisPlugin, {
			initialConfig: { connections: [{ id: 'session', url: liveUrl ?? '' }] },
		})
		change.start(ForumCorePlugin)
		// Short-lived, so the sessions these tests leave in the shared dev Redis expire on their own.
		change.start(ForumAuthPlugin, {
			initialConfig: configured({
				session: { idleTtlSeconds: 300, absoluteTtlSeconds: 300 },
				...config,
			}),
		})
	})
	const auth = host.require(ForumAuthPlugin)
	const login = async (user: MockUser, returnTo: string | null = '/') => {
		const started = await auth.beginLogin(returnTo)
		if (started.isErr()) throw new Error(started.error.message)
		const callback = issuer.authorize(started.value, user)
		return { callback, result: await auth.completeLogin(new Request(callback)) }
	}
	/** Logs in and returns the session ID; the login must succeed. */
	const session = async (user: MockUser) => {
		const { result } = await login(user)
		if (result.isErr()) throw new Error(result.error.message)
		return sessionIdOf(result.value.setCookie)
	}
	return { auth, issuer, login, session, core: host.require(ForumCorePlugin) }
}

// Subjects are unique per run so that repeated runs do not see each other's sessions.
const subject = () => `sub-${crypto.randomUUID()}`

describe.skipIf(!liveUrl)('ForumAuthPlugin with Redis sessions', () => {
	it('logs a user in through the provider and resolves the session afterwards', async () => {
		await using host = await createHost()
		const sub = subject()
		const { auth, core, login } = await start(host, { adminSubjects: [sub] })
		expect(auth.loginAvailable()).toBe(true)

		const started = await auth.beginLogin('/t/42?page=2')
		const authorization = new URL(started.unwrap())
		expect(authorization.origin + authorization.pathname).toBe(`${ISSUER}/authorize`)
		expect(authorization.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/forum/auth/callback`)
		expect(authorization.searchParams.get('scope')).toBe('openid profile email')

		const { callback, result } = await login({ sub, name: '  Ada   Lovelace ' }, '/t/42?page=2')
		const completed = result.unwrap()
		expect(completed.returnTo).toBe('/t/42?page=2')
		expect(completed.setCookie).toMatch(/; Max-Age=300; Path=\/; HttpOnly; SameSite=Lax; Secure$/)

		const id = sessionIdOf(completed.setCookie)
		const authentication = await auth.authenticate(withSession(id))
		if (authentication.status !== 'authenticated') throw new Error('expected a session')
		expect((await core.getUser(authentication.userId)).unwrap().displayName).toBe('Ada Lovelace')
		// The configured subject became an admin at login.
		expect((await core.principalOf(authentication.userId)).roles).toEqual(['member', 'admin'])

		// A callback URL works once: replaying it does not open a second session.
		const replay = await auth.completeLogin(new Request(callback))
		expect(replay.isErr() && replay.error.code).toBe('rejected')

		expect((await auth.logout(withSession(id))).setCookie).toMatch(
			new RegExp(`^${COOKIE}=; Max-Age=0; `),
		)
		expect(await auth.authenticate(withSession(id))).toEqual({ status: 'guest' })
	})

	it('opens a session for a test account with the right token', async () => {
		await using host = await createHost()
		const name = `t${crypto.randomUUID().slice(0, 8)}`
		const { auth, core } = await start(host, { testLoginTokenSha256: await sha256Hex('tok') })
		const login = (await auth.testLogin('tok', { name, admin: true }, 'vitest')).unwrap()
		const authentication = await auth.authenticate(withSession(sessionIdOf(login.setCookie)))
		expect(authentication).toEqual({ status: 'authenticated', userId: login.userId })
		expect((await core.principalOf(login.userId)).roles).toEqual(['member', 'admin'])
		// The same name logs into the same account.
		const again = (await auth.testLogin('tok', { name }, null)).unwrap()
		expect(again.userId).toBe(login.userId)
	})

	it('opens sessions for other login methods and tracks password login', async () => {
		await using host = await createHost()
		const { auth, core } = await start(host)
		expect(auth.publicOrigin()).toBe(ORIGIN)
		const user = (
			await core.ensureUser({ subject: `local:${subject()}`, displayName: 'Ada' })
		).unwrap()
		const setCookie = await auth.openSession(user.id, 'vitest')
		expect(await auth.authenticate(withSession(sessionIdOf(setCookie)))).toEqual({
			status: 'authenticated',
			userId: user.id,
		})
		expect(auth.providerLabel()).toBeNull()
		expect(auth.passwordLoginAvailable()).toBe(false)
		const withdraw = auth.registerPasswordLogin()
		expect(auth.passwordLoginAvailable()).toBe(true)
		withdraw()
		expect(auth.passwordLoginAvailable()).toBe(false)
	})

	it("shows the operator's provider button text", async () => {
		await using host = await createHost()
		const { auth } = await start(host, {
			oidc: { issuer: ISSUER, clientId: CLIENT_ID, buttonLabel: '  Sign in with OIDC ' },
		})
		expect(auth.providerLabel()).toBe('Sign in with OIDC')
	})

	it('takes the name from UserInfo when the ID token has none, also for an existing account', async () => {
		await using host = await createHost()
		const { auth, core, issuer, login } = await start(host)
		const sub = subject()
		const nameAfterLogin = async (user: MockUser) => {
			const id = sessionIdOf((await login(user)).result.unwrap().setCookie)
			const authentication = await auth.authenticate(withSession(id))
			if (authentication.status !== 'authenticated') throw new Error('expected a session')
			return (await core.getUser(authentication.userId)).unwrap().displayName
		}

		// A provider that shares no name at all leaves the placeholder.
		expect(await nameAfterLogin({ sub })).toBe('新用户')
		// Once it does (here through UserInfo only), the placeholder is replaced at the next login.
		issuer.options.nameInIdToken = false
		expect(await nameAfterLogin({ sub, name: 'Grace Hopper' })).toBe('Grace Hopper')
		// A name the account already has is not overwritten by the provider.
		expect(await nameAfterLogin({ sub, name: 'Someone Else' })).toBe('Grace Hopper')
	})

	it('keeps the address the provider vouches for, from the ID token or UserInfo', async () => {
		await using host = await createHost()
		const { auth, core, issuer, login } = await start(host)
		const sub = subject()
		const emailAfterLogin = async (user: MockUser) => {
			const id = sessionIdOf((await login(user)).result.unwrap().setCookie)
			const authentication = await auth.authenticate(withSession(id))
			if (authentication.status !== 'authenticated') throw new Error('expected a session')
			return core.contactEmail(authentication.userId)
		}

		expect(await emailAfterLogin({ sub })).toBeNull()
		expect(await emailAfterLogin({ sub, email: 'ada@example.com', emailVerified: true })).toBe(
			'ada@example.com',
		)
		// An address the provider has not verified is not used, and replaces the old one.
		expect(
			await emailAfterLogin({ sub, email: 'other@example.com', emailVerified: false }),
		).toBeNull()
		// Providers that never verify leave the claim out; UserInfo is asked when the token lacks it.
		issuer.options.nameInIdToken = false
		expect(await emailAfterLogin({ sub, name: 'Ada', email: 'ada@example.org' })).toBe(
			'ada@example.org',
		)
	})

	it('rejects login attempts that do not check out', async () => {
		await using host = await createHost()
		const { auth, issuer, login } = await start(host)

		// A return target that would leave the forum falls back to the home page.
		const escapes = ['//evil.test/', '/\\evil.test', 'https://evil.test/', '/a b', null]
		const landed = await Promise.all(
			escapes.map(async (target) => (await login({ sub: subject() }, target)).result),
		)
		expect(landed.map((result) => result.unwrap().returnTo)).toEqual(escapes.map(() => '/'))

		const unknownState = await auth.completeLogin(
			new Request(`${ORIGIN}/api/forum/auth/callback?code=x&state=never-issued`),
		)
		expect(unknownState.isErr() && unknownState.error.code).toBe('rejected')

		// The provider reports a refusal by redirecting back without a code.
		const started = (await auth.beginLogin('/')).unwrap()
		const state = new URL(started).searchParams.get('state')
		const denied = await auth.completeLogin(
			new Request(`${ORIGIN}/api/forum/auth/callback?error=access_denied&state=${state}`),
		)
		expect(denied.isErr() && denied.error.code).toBe('rejected')

		// An ID token minted for another login attempt (wrong nonce) is not accepted.
		issuer.options.tamperNonce = true
		const { result } = await login({ sub: subject() })
		expect(result.isErr() && result.error.code).toBe('rejected')
	})

	it('authenticates a confidential client with the secret from Vault', async () => {
		await using host = await createHost()
		const { auth, issuer, login } = await start(host)
		issuer.options.clientSecret = 's3cr3t/+ value'

		// Without the secret the provider refuses the code.
		const refused = await login({ sub: subject() })
		expect(refused.result.isErr() && refused.result.error.code).toBe('rejected')

		await auth.ctx.require(Vault).kv().set(CLIENT_SECRET_KEY, 's3cr3t/+ value')
		expect((await login({ sub: subject() })).result.isOk()).toBe(true)
	})

	it('ends sessions by provider session, by account and everywhere', async () => {
		await using host = await createHost()
		const { auth, issuer, session } = await start(host)
		const sub = subject()
		const [phone, laptop, tablet] = [
			await session({ sub, sid: `sid-${crypto.randomUUID()}` }),
			await session({ sub, sid: `sid-${crypto.randomUUID()}` }),
			await session({ sub }),
		]
		const otherSub = subject()
		const other = await session({ sub: otherSub })
		const live = async (id: string) =>
			(await auth.authenticate(withSession(id))).status === 'authenticated'

		// A logout token without the back-channel event is just some signed JWT.
		const notLogout = await auth.backchannelLogout(await issuer.logoutToken({ sub }, false))
		expect(notLogout.isErr() && notLogout.error.code).toBe('rejected')
		const garbage = await auth.backchannelLogout('not-a-token')
		expect(garbage.isErr() && garbage.error.code).toBe('rejected')

		// Back-channel logout of one provider session ends only the session that came from it.
		const phoneSid = await sidOf(issuer, auth, sub)
		expect(
			(await auth.backchannelLogout(await issuer.logoutToken({ sid: phoneSid }))).unwrap(),
		).toBe(1)
		// `phoneSid` belongs to a fourth session opened inside sidOf; the first three still live.
		expect(await Promise.all([phone, laptop, tablet].map(live))).toEqual([true, true, true])

		// "Log out everywhere" from one device ends all sessions of that account only.
		const everywhere = await auth.logoutEverywhere(withSession(laptop))
		expect(everywhere.unwrap().setCookie).toContain('Max-Age=0')
		expect(await Promise.all([phone, laptop, tablet].map(live))).toEqual([false, false, false])
		expect(await live(other)).toBe(true)

		// A logout token naming only the subject ends every session of that account.
		expect(
			(await auth.backchannelLogout(await issuer.logoutToken({ sub: otherSub }))).unwrap(),
		).toBe(1)
		expect(await live(other)).toBe(false)
	})

	it('expires a session at its absolute end even while it is in use', async () => {
		await using host = await createHost()
		const { auth, session } = await start(host, {
			session: { idleTtlSeconds: 60, absoluteTtlSeconds: 60 },
		})
		const id = await session({ sub: subject() })
		expect((await auth.authenticate(withSession(id))).status).toBe('authenticated')

		vi.useFakeTimers({ now: Date.now() + 61_000, toFake: ['Date'] })
		try {
			expect(await auth.authenticate(withSession(id))).toEqual({ status: 'guest' })
		} finally {
			vi.useRealTimers()
		}
	})
})

/** Opens one more session for `sub` with a known provider session ID and returns that ID. */
async function sidOf(
	issuer: Awaited<ReturnType<typeof createMockIssuer>>,
	auth: ForumAuthPlugin,
	sub: string,
): Promise<string> {
	const sid = `sid-${crypto.randomUUID()}`
	const started = await auth.beginLogin('/')
	const result = await auth.completeLogin(
		new Request(issuer.authorize(started.unwrap(), { sub, sid })),
	)
	expect(result.isOk()).toBe(true)
	return sid
}
