import { ForumAuth, type Authentication, type Logout } from '@pluxum/auth'
import { ForumCorePlugin } from '@pluxum/core'
import { Plugin } from '@pluxel/core'
import { MemoryRatesBackendPlugin, RatesPlugin } from '@pluxel/plugin-rates'
import { pglite } from '@pluxel/services/pg/pglite'
import { elysia } from '@pluxel/services/elysia'
import { createTestHost } from '@pluxel/test'
import { describe, expect, it } from 'vitest'
import { ForumAccountsPlugin, normalizeEmail } from '../src'
import { hashPassword, needsRehash, verifyPassword } from '../src/accounts/password'

const ORIGIN = 'https://forum.test'

/**
 * Stand-in for Pluxum Auth: a session is the cookie `s=<userId>`, and revoking an account's
 * sessions is counted. The real session store is tested in forum-auth.
 */
@Plugin(ForumAuth)
class FakeAuth extends ForumAuth {
	static revoked: string[] = []
	override loginAvailable(): boolean {
		return false
	}
	override publicOrigin(): string | null {
		return ORIGIN
	}
	override openSession(userId: string): Promise<string> {
		return Promise.resolve(`s=${userId}; Path=/; HttpOnly`)
	}
	override authenticate(request: Request): Promise<Authentication> {
		const userId = /(?:^|;\s*)s=([\w-]+)/.exec(request.headers.get('cookie') ?? '')?.[1]
		return Promise.resolve(userId ? { status: 'authenticated', userId } : { status: 'guest' })
	}
	override allowsOrigin(request: Request): boolean {
		const origin = request.headers.get('origin')
		return origin === null || origin === ORIGIN
	}
	override beginLogin(): never {
		throw new Error('not used')
	}
	override completeLogin(): never {
		throw new Error('not used')
	}
	override logout(): Promise<Logout> {
		return Promise.resolve({ setCookie: 's=; Path=/; Max-Age=0', providerUrl: null })
	}
	override logoutEverywhere(): never {
		throw new Error('not used')
	}
	override revokeUserSessions(userId: string): Promise<number> {
		FakeAuth.revoked.push(userId)
		return Promise.resolve(1)
	}
	override backchannelLogout(): never {
		throw new Error('not used')
	}
	override testLoginAvailable(): boolean {
		return false
	}
	override testLogin(): never {
		throw new Error('not used')
	}
}

async function boot(initialConfig: Record<string, unknown> = {}) {
	const host = await createTestHost({
		services: [elysia(), pglite({ dataDir: 'memory://' })],
	})
	await host.commit((change) => {
		change.start(ForumCorePlugin.nodeAddress())
		change.start(FakeAuth.nodeAddress())
		change.start(MemoryRatesBackendPlugin.nodeAddress())
		change.start(RatesPlugin.nodeAddress())
		change.start(ForumAccountsPlugin.nodeAddress(), { initialConfig })
	})
	const send = async (
		path: string,
		payload: unknown,
		origin: string | null = ORIGIN,
		cookie: string | null = null,
	) => {
		const response = await host.http.fetch(
			new Request(new URL(`/api/forum/accounts${path}`, host.http.origin), {
				method: payload === undefined ? 'GET' : 'POST',
				headers: {
					'content-type': 'application/json',
					'x-forwarded-for': '203.0.113.7',
					...(origin === null ? {} : { origin }),
					...(cookie === null ? {} : { cookie }),
				},
				body: payload === undefined ? undefined : JSON.stringify(payload),
			}),
		)
		const text = await response.text()
		return {
			status: response.status,
			cookie: response.headers.get('set-cookie'),
			// Parsed JSON stays untyped; each test states the shape it expects. A route that is
			// gone answers the framework's plain-text 404.
			body: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text,
		}
	}
	const post = (path: string, payload: unknown, origin: string | null = ORIGIN) =>
		send(path, payload, origin)
	/** As the signed-in member `userId` (the fake session cookie). */
	const as = (userId: string) => ({
		get: (path: string) => send(path, undefined, ORIGIN, `s=${userId}`),
		post: (path: string, payload: unknown) => send(path, payload, ORIGIN, `s=${userId}`),
	})
	return {
		host,
		as,
		[Symbol.asyncDispose]: () => host[Symbol.asyncDispose](),
		core: host.require(ForumCorePlugin.nodeAddress()),
		auth: host.require(FakeAuth.nodeAddress()),
		accounts: host.require(ForumAccountsPlugin.nodeAddress()),
		post,
		send,
	}
}

describe('passwords', () => {
	it('hashes with scrypt and verifies only the right password', async () => {
		const hash = await hashPassword('correct horse')
		expect(hash).toMatch(/^scrypt\$32768\$8\$3\$[\w-]+\$[\w-]+$/)
		expect(await verifyPassword('correct horse', hash)).toBe(true)
		expect(await verifyPassword('correct horsf', hash)).toBe(false)
		expect(await verifyPassword('x', 'garbage')).toBe(false)
		expect(needsRehash(hash)).toBe(false)
		expect(needsRehash('scrypt$16384$8$1$a$b')).toBe(true)
	})

	it('normalizes addresses without touching the local part', () => {
		expect(normalizeEmail('  Ada@Example.COM ')).toBe('Ada@example.com')
		expect(normalizeEmail('not an email')).toBeNull()
	})
})

describe('forum accounts plugin', () => {
	it('registers, signs in and tells the web app password login exists', async () => {
		await using env = await boot()
		const { core, auth, post } = env
		expect(auth.passwordLoginAvailable()).toBe(true)
		expect(env.accounts.options()).toEqual({ registration: true, reset: false, passwordMin: 8 })

		const created = await post('/register', {
			email: 'Ada@Example.com',
			password: 'analytical engine',
			displayName: 'Ada',
		})
		expect(created.status).toBe(201)
		expect(created.cookie).toMatch(/^s=[\w-]+;/)
		const userId: string = created.body.userId
		const user = (await core.getUser(userId)).unwrap()
		expect(user.displayName).toBe('Ada')
		// The handle comes from the display name, never from the address.
		expect(user.handle).not.toContain('example')
		expect(await core.contactEmail(userId)).toBe('Ada@example.com')

		// Another case of the same address is the same account.
		const again = await post('/register', {
			email: 'ada@example.com',
			password: 'something else',
			displayName: 'Ada 2',
		})
		expect(again).toMatchObject({ status: 409, body: { error: { key: 'account.email_taken' } } })

		const login = await post('/login', { email: 'ADA@example.com', password: 'analytical engine' })
		expect(login).toMatchObject({ status: 200, body: { userId } })
		expect(login.cookie).toContain(`s=${userId}`)
	})

	it('answers a wrong password and an unknown address the same way', async () => {
		await using env = await boot()
		await env.post('/register', { email: 'a@b.co', password: 'password one', displayName: 'A' })
		const wrong = await env.post('/login', { email: 'a@b.co', password: 'password two' })
		const unknown = await env.post('/login', { email: 'z@b.co', password: 'password one' })
		expect(wrong).toMatchObject({ status: 422, cookie: null })
		expect(unknown).toEqual(wrong)
		expect(wrong.body.error.key).toBe('account.credentials')
	})

	it('validates input and refuses cross-site requests', async () => {
		await using env = await boot({ passwordMin: 10 })
		const base = { email: 'a@b.co', password: 'long enough!', displayName: 'A' }
		expect((await env.post('/register', { ...base, email: 'nope' })).body.error.key).toBe(
			'account.email_invalid',
		)
		expect((await env.post('/register', { ...base, password: 'short' })).body.error).toMatchObject({
			key: 'account.password_short',
			params: { min: 10 },
		})
		expect((await env.post('/register', { ...base, displayName: ' ' })).body.error.key).toBe(
			'field.empty',
		)
		expect((await env.post('/register', { email: 'a@b.co' })).body.error.key).toBe(
			'request.invalid',
		)
		expect(await env.post('/register', base, 'https://evil.test')).toMatchObject({
			status: 403,
			body: { error: { key: 'request.cross_site' } },
		})
	})

	it('closes registration while letting existing accounts sign in', async () => {
		await using env = await boot()
		await env.post('/register', { email: 'a@b.co', password: 'password one', displayName: 'A' })
		await env.host.config.patch(ForumAccountsPlugin.nodeAddress(), {
			set: { registration: 'closed' },
		})
		expect(env.accounts.options().registration).toBe(false)
		const closed = await env.post('/register', {
			email: 'c@d.co',
			password: 'password one',
			displayName: 'C',
		})
		expect(closed).toMatchObject({
			status: 403,
			body: { error: { key: 'account.registration_closed' } },
		})
		expect((await env.post('/login', { email: 'a@b.co', password: 'password one' })).status).toBe(
			200,
		)
	})

	it('rate limits login attempts per address', async () => {
		await using env = await boot({ limits: { loginsPerEmail: 2 } })
		const attempt = () => env.post('/login', { email: 'a@b.co', password: 'whatever pw' })
		expect((await attempt()).status).toBe(422)
		expect((await attempt()).status).toBe(422)
		const limited = await attempt()
		expect(limited).toMatchObject({
			status: 429,
			body: { error: { key: 'rate.limited', params: { bucket: 'logins' } } },
		})
	})

	it('resets a password once from a link, ending the old sessions', async () => {
		await using env = await boot()
		const { userId } = (
			await env.post('/register', { email: 'a@b.co', password: 'old password', displayName: 'A' })
		).body
		expect(await env.accounts.resetLinkFor('nobody@b.co')).toBeNull()
		const link = await env.accounts.resetLinkFor('A@B.co')
		expect(link).toMatch(/^https:\/\/forum\.test\/reset-password\?token=[\w-]{43}$/)
		const token = new URL(link!).searchParams.get('token')

		const done = await env.post('/reset', { token, password: 'new password' })
		expect(done).toMatchObject({ status: 200, body: { userId } })
		expect(FakeAuth.revoked).toContain(userId)
		expect((await env.post('/reset', { token, password: 'another one' })).body.error.key).toBe(
			'account.reset_invalid',
		)
		expect((await env.post('/login', { email: 'a@b.co', password: 'old password' })).status).toBe(
			422,
		)
		expect((await env.post('/login', { email: 'a@b.co', password: 'new password' })).status).toBe(
			200,
		)
		// Without Pluxum Mail running, nobody can ask for a link by mail.
		expect((await env.post('/reset-request', { email: 'a@b.co' })).body.error.key).toBe(
			'account.reset_unavailable',
		)
	})

	it('mails a reset link through the mailer registered with auth', async () => {
		await using env = await boot()
		await env.post('/register', { email: 'a@b.co', password: 'old password', displayName: 'A' })
		const sent: Array<Readonly<{ to: string; subject: string; text: string }>> = []
		const unregister = env.auth.registerMailer({
			canSend: () => true,
			sendTransactional: (input) => {
				sent.push(input)
				return true
			},
		})
		expect((await env.post('/reset-request', { email: 'A@b.co' })).status).toBe(200)
		expect(sent).toHaveLength(1)
		expect(sent[0]?.to).toBe('A@b.co')
		expect(sent[0]?.text).toContain(`${ORIGIN}/reset-password`)
		unregister()
		expect((await env.post('/reset-request', { email: 'a@b.co' })).body.error.key).toBe(
			'account.reset_unavailable',
		)
	})

	it('shows and changes the own account, asking for the password each time', async () => {
		await using env = await boot()
		const { userId } = (
			await env.post('/register', { email: 'a@b.co', password: 'old password', displayName: 'A' })
		).body
		const me = env.as(userId)
		expect((await env.send('/me', undefined)).status).toBe(401)
		expect((await me.get('/me')).body.account).toMatchObject({ email: 'a@b.co' })
		// A member who signs in another way has no account here.
		const other = (await env.core.ensureUser({ subject: 'oidc:1', displayName: 'O' })).unwrap()
		expect((await env.as(other.id).get('/me')).body).toEqual({ account: null, passwordMin: 8 })

		const wrong = await me.post('/password', { current: 'nope nope', password: 'new password' })
		expect(wrong).toMatchObject({ status: 422, body: { error: { key: 'account.password_wrong' } } })
		const changed = await me.post('/password', {
			current: 'old password',
			password: 'new password',
		})
		expect(changed).toMatchObject({ status: 200, body: { userId } })
		expect(changed.cookie).toContain(`s=${userId}`)
		expect(FakeAuth.revoked).toContain(userId)
		expect((await env.post('/login', { email: 'a@b.co', password: 'new password' })).status).toBe(
			200,
		)

		await env.post('/register', { email: 'c@d.co', password: 'password c', displayName: 'C' })
		expect(
			(await me.post('/email', { password: 'new password', email: 'C@D.co' })).body.error.key,
		).toBe('account.email_taken')
		const moved = await me.post('/email', { password: 'new password', email: 'Ada@New.co' })
		expect(moved).toMatchObject({ status: 200, body: { account: { email: 'Ada@new.co' } } })
		expect(await env.core.contactEmail(userId)).toBe('Ada@new.co')
		expect((await env.post('/login', { email: 'a@b.co', password: 'new password' })).status).toBe(
			422,
		)
		expect(
			(await env.post('/login', { email: 'ada@new.co', password: 'new password' })).status,
		).toBe(200)
	})

	it('deletes an account, handing it to Ghost', async () => {
		await using env = await boot()
		const { userId } = (
			await env.post('/register', { email: 'a@b.co', password: 'my password', displayName: 'Ada' })
		).body
		const me = env.as(userId)
		expect((await me.post('/delete', { password: 'not mine!' })).status).toBe(422)
		const gone = await me.post('/delete', { password: 'my password' })
		expect(gone.status).toBe(200)
		expect(gone.cookie).toBeTruthy()
		expect(FakeAuth.revoked).toContain(userId)

		expect((await env.core.getUser(userId)).isErr()).toBe(true)
		expect((await env.core.getUser('ghost')).unwrap().displayName).toBe('Ghost')
		expect(await env.core.findUserBySubject(`local:${userId}`)).toBeNull()
		expect((await env.post('/login', { email: 'a@b.co', password: 'my password' })).status).toBe(
			422,
		)
		// The address is free again, for a new account.
		const again = await env.post('/register', {
			email: 'a@b.co',
			password: 'my password',
			displayName: 'Ada',
		})
		expect(again.status).toBe(201)
		expect(again.body.userId).not.toBe(userId)
	})

	it('withdraws password login when it stops', async () => {
		await using env = await boot()
		await env.host.stop(ForumAccountsPlugin.nodeAddress())
		expect(env.auth.passwordLoginAvailable()).toBe(false)
		expect((await env.post('/login', { email: 'a@b.co', password: 'x' })).status).toBe(404)
	})
})
