import { LIMITS } from '@pluxum/domain'
import { ForumCorePlugin } from '@pluxum/core'
import { BasePlugin, Plugin } from '@pluxel/core'
import { Result } from '@pluxel/core/better-result'
import { Redis } from '@pluxel/plugin-redis'
import { Vault } from '@pluxel/services/vault'
import * as v from 'valibot'
import { repairBase64Url } from './base64-repair'
import { ForumAuthConfig } from './config'
import { matchesSha256, pkceChallenge, randomToken } from './crypto'
import { OidcClient, OidcRejectedError, OidcUnavailableError } from './oidc'
import { SessionStore } from './sessions'

export { ForumAuthConfig } from './config'

/** Path of the OIDC redirect URI on the forum's public origin; registered with the provider. */
export const LOGIN_CALLBACK_PATH = '/api/forum/auth/callback'
/** Vault record (in this plugin's namespace) holding a confidential client's secret. */
export const CLIENT_SECRET_KEY = 'oidc-client-secret'

const LOGIN_STATE_TTL_SECONDS = 10 * 60
const SESSION_ID = /^[\w-]{43}$/
const FALLBACK_DISPLAY_NAME = '新用户'

/** Who a request acts as. `unavailable`: it carries a session that cannot be checked right now. */
export type Authentication =
	| Readonly<{ status: 'guest' }>
	| Readonly<{ status: 'authenticated'; userId: string }>
	| Readonly<{ status: 'unavailable' }>

export type AuthFailure = Readonly<{
	/**
	 * `unavailable`: login is not configured, or Redis / the provider cannot be reached.
	 * `rejected`: this login attempt or token is not acceptable.
	 * `unauthenticated`: the operation needs a session and the request has none.
	 */
	code: 'unavailable' | 'rejected' | 'unauthenticated'
	message: string
}>
export type AuthResult<T> = Result<T, AuthFailure>

export type CompletedLogin = Readonly<{
	/** Same-origin path to send the browser to. */
	returnTo: string
	/** `Set-Cookie` value that hands the session to the browser. */
	setCookie: string
}>

export type TestLoginInput = Readonly<{
	/** Names the account: `[a-z0-9-]{1,24}`; the same name logs into the same account again. */
	name: string
	/** Also grant the admin role, to see moderation and admin UI. */
	admin?: boolean
}>

/** Subject prefix of accounts made by test login; no provider issues subjects like this. */
export const TEST_SUBJECT_PREFIX = 'pluxum-test:'
const TEST_NAME = /^[a-z0-9-]{1,24}$/

export type Logout = Readonly<{
	/** `Set-Cookie` value that removes the session cookie. */
	setCookie: string
	/** Provider URL that ends its own session too, when that is configured and supported. */
	providerUrl: string | null
}>

/**
 * Forum identity: who a request acts as, and the login and logout flows that decide it.
 * forum-api owns the URLs and calls into this capability; nothing here mounts a route.
 */
export abstract class ForumAuth extends BasePlugin {
	/** Whether a login can be started at all (public origin and provider are configured). */
	abstract loginAvailable(): boolean
	/** Resolves the session of a request. Requests without a session cookie never touch Redis. */
	abstract authenticate(request: Request): Promise<Authentication>
	/**
	 * Cross-site request check for state-changing requests: false when a browser sent the request
	 * from another origin. Requests without an `Origin` header (server-side callers) pass.
	 */
	abstract allowsOrigin(request: Request): boolean
	/** Starts a login and returns the provider URL to redirect the browser to. */
	abstract beginLogin(returnTo: string | null): Promise<AuthResult<string>>
	/** Finishes a login from the provider's redirect back to the callback URL. */
	abstract completeLogin(request: Request): Promise<AuthResult<CompletedLogin>>
	/** Ends the session of this request. Always yields the cookie removal, even for guests. */
	abstract logout(request: Request): Promise<Logout>
	/** Ends every session of the account this request acts as. */
	abstract logoutEverywhere(request: Request): Promise<AuthResult<Logout>>
	/** Ends every session of an account (bans, role changes); returns how many were live. */
	abstract revokeUserSessions(userId: string): Promise<number>
	/** Handles an OIDC back-channel logout token; returns how many sessions it ended. */
	abstract backchannelLogout(logoutToken: string): Promise<AuthResult<number>>
	/** Whether test login is configured (`testLoginTokenSha256`). */
	abstract testLoginAvailable(): boolean
	/**
	 * Opens a session for a throwaway test account, for checking signed-in UI without the provider.
	 * `unavailable` unless `testLoginTokenSha256` is configured; `rejected` for a wrong token.
	 */
	abstract testLogin(
		token: string | null,
		input: TestLoginInput,
		userAgent: string | null,
	): Promise<AuthResult<Readonly<{ userId: string; setCookie: string }>>>
}

const LoginState = v.object({
	codeVerifier: v.string(),
	nonce: v.string(),
	returnTo: v.string(),
})

const fail = (code: AuthFailure['code'], message: string): Result<never, AuthFailure> =>
	Result.err({ code, message })
const NOT_CONFIGURED = '登录尚未配置'
const TRY_LATER = '登录服务暂时不可用，请稍后再试'

/** A same-origin path to return to after login; anything that could leave the origin becomes `/`. */
function safeReturnTo(value: string | null): string {
	if (value === null || value.length > 512) return '/'
	// One leading slash only: `//host` and `/\host` are read by browsers as another origin.
	// Printable ASCII only: a real path-and-query is percent-encoded, and nothing else is needed.
	return /^\/(?![/\\])[\x21-\x7E]*$/.test(value) ? value : '/'
}

function readCookie(request: Request, name: string): string | null {
	for (const part of (request.headers.get('cookie') ?? '').split(';')) {
		const separator = part.indexOf('=')
		if (separator > 0 && part.slice(0, separator).trim() === name) {
			return part.slice(separator + 1).trim()
		}
	}
	return null
}

/** The provider's name for the account, cut to what the forum accepts as a display name. */
function displayNameOf(name: string): string {
	const singleLine = name.replaceAll(/\s+/g, ' ').trim()
	// The forum counts display names in code points.
	const cut = Array.from(singleLine).slice(0, LIMITS.displayNameMax).join('').trim()
	return cut || FALLBACK_DISPLAY_NAME
}

/**
 * Zitadel-compatible OpenID Connect login (authorization code + PKCE) with server-side sessions in
 * Redis. The browser only ever holds an opaque session ID in an HttpOnly cookie.
 */
@Plugin(ForumAuth, { displayName: 'Forum Auth' })
export class ForumAuthPlugin extends ForumAuth {
	private readonly config = this.configs.use(ForumAuthConfig)
	private readonly sessions = new SessionStore(
		() => this.redis.connection(this.config.session.connectionId),
		() => this.config.session,
	)
	private oidc: OidcClient | undefined

	constructor(
		private readonly core: ForumCorePlugin,
		private readonly redis: Redis,
	) {
		super()
	}

	protected override init(): void {
		const { oidc, publicOrigin, session } = this.config
		if (session.idleTtlSeconds > session.absoluteTtlSeconds) {
			throw new Error('Forum Auth session.idleTtlSeconds must not exceed absoluteTtlSeconds')
		}
		if (publicOrigin?.startsWith('http://') && process.env.NODE_ENV === 'production') {
			throw new Error('Forum Auth publicOrigin must be https:// when NODE_ENV is "production"')
		}
		// Fails the start, and with it every consumer, when the session connection is not declared.
		this.redis.connection(session.connectionId)
		const repaired = repairBase64Url()
		if (repaired.length > 0) {
			this.ctx.logger.warn(`replaced base64url-unaware runtime fallbacks: ${repaired.join(', ')}`)
		}
		this.oidc = oidc && publicOrigin ? new OidcClient(oidc) : undefined
		if (!this.oidc) {
			this.ctx.logger.warn('forum login is unavailable: publicOrigin and oidc are not both set')
		}
	}

	override loginAvailable(): boolean {
		return this.oidc !== undefined
	}

	override async authenticate(request: Request): Promise<Authentication> {
		const id = this.sessionIdOf(request)
		if (id === null) return { status: 'guest' }
		try {
			const userId = await this.sessions.touch(id)
			return userId === null ? { status: 'guest' } : { status: 'authenticated', userId }
		} catch (error) {
			this.ctx.logger.error('forum session lookup failed', { error })
			return { status: 'unavailable' }
		}
	}

	override allowsOrigin(request: Request): boolean {
		const origin = request.headers.get('origin')
		// Without a public origin there is no login and therefore no session to ride on.
		if (origin === null || this.config.publicOrigin === undefined) return true
		return origin === this.config.publicOrigin
	}

	override async beginLogin(returnTo: string | null): Promise<AuthResult<string>> {
		const oidc = this.oidc
		if (!oidc) return fail('unavailable', NOT_CONFIGURED)
		const state = randomToken()
		const nonce = randomToken()
		const codeVerifier = randomToken()
		const pending: v.InferOutput<typeof LoginState> = {
			codeVerifier,
			nonce,
			returnTo: safeReturnTo(returnTo),
		}
		try {
			const url = await oidc.authorizationUrl({
				redirectUri: this.redirectUri(),
				state,
				nonce,
				codeChallenge: await pkceChallenge(codeVerifier),
			})
			await this.sessions.putLoginState(state, JSON.stringify(pending), LOGIN_STATE_TTL_SECONDS)
			return Result.ok(url)
		} catch (error) {
			this.ctx.logger.error('forum login could not start', { error })
			return fail('unavailable', TRY_LATER)
		}
	}

	override async completeLogin(request: Request): Promise<AuthResult<CompletedLogin>> {
		const oidc = this.oidc
		if (!oidc) return fail('unavailable', NOT_CONFIGURED)
		const params = new URL(request.url).searchParams
		const state = params.get('state')
		if (state === null) return fail('rejected', '登录请求无效')
		try {
			// Taken before anything else: a state is good for one attempt whatever its outcome.
			const stored = await this.sessions.takeLoginState(state)
			const pending = stored === null ? null : v.safeParse(LoginState, JSON.parse(stored))
			if (!pending?.success) return fail('rejected', '登录已过期，请重新登录')
			const code = params.get('code')
			if (code === null) {
				// The provider reports a refusal (`error=access_denied` and the like) the same way.
				return fail('rejected', '登录已取消')
			}
			const identity = await oidc.redeem({
				code,
				codeVerifier: pending.output.codeVerifier,
				redirectUri: this.redirectUri(),
				nonce: pending.output.nonce,
				clientSecret: await this.clientSecret(),
			})
			const user = await this.core.ensureUser({
				subject: identity.subject,
				displayName: displayNameOf(identity.name),
				handleHint: identity.preferredUsername,
			})
			if (user.isErr()) return fail('rejected', user.error.message)
			// An account created before the provider shared a name picks it up once it does.
			const provided = displayNameOf(identity.name)
			if (user.value.displayName === FALLBACK_DISPLAY_NAME && provided !== FALLBACK_DISPLAY_NAME) {
				await this.core.renameUser(user.value.id, provided)
			}
			if (this.config.adminSubjects.includes(identity.subject)) {
				const granted = await this.core.grantRole(user.value.id, 'admin')
				if (granted.isErr()) throw new Error(`Cannot grant admin: ${granted.error.message}`)
			}
			const id = await this.sessions.create({
				userId: user.value.id,
				sid: identity.sid,
				userAgent: request.headers.get('user-agent'),
			})
			return Result.ok({
				returnTo: pending.output.returnTo,
				setCookie: this.cookie(id, this.config.session.absoluteTtlSeconds),
			})
		} catch (error) {
			if (error instanceof OidcRejectedError) {
				this.ctx.logger.warn('forum login was rejected', { error })
				return fail('rejected', '登录失败，请重试')
			}
			this.ctx.logger.error('forum login could not complete', { error })
			return fail('unavailable', TRY_LATER)
		}
	}

	override async logout(request: Request): Promise<Logout> {
		const id = this.sessionIdOf(request)
		if (id === null) return this.loggedOut(false)
		try {
			return await this.loggedOut(await this.sessions.revoke(id))
		} catch (error) {
			// The browser still forgets the session; the stored one then ends by its idle expiry.
			this.ctx.logger.error('forum session could not be revoked on logout', { error })
			return this.loggedOut(false)
		}
	}

	override async logoutEverywhere(request: Request): Promise<AuthResult<Logout>> {
		const authentication = await this.authenticate(request)
		if (authentication.status === 'unavailable') return fail('unavailable', TRY_LATER)
		if (authentication.status === 'guest') return fail('unauthenticated', '请先登录')
		try {
			await this.sessions.revokeUser(authentication.userId)
		} catch (error) {
			this.ctx.logger.error('forum sessions could not be revoked', { error })
			return fail('unavailable', TRY_LATER)
		}
		return Result.ok(await this.loggedOut(true))
	}

	override revokeUserSessions(userId: string): Promise<number> {
		return this.sessions.revokeUser(userId)
	}

	override async backchannelLogout(logoutToken: string): Promise<AuthResult<number>> {
		const oidc = this.oidc
		if (!oidc) return fail('unavailable', NOT_CONFIGURED)
		try {
			const { sid, subject } = await oidc.verifyLogoutToken(logoutToken)
			if (sid !== undefined) return Result.ok(await this.sessions.revokeProviderSession(sid))
			// Without a session ID the token logs the whole account out.
			const user = subject === undefined ? null : await this.core.findUserBySubject(subject)
			return Result.ok(user ? await this.sessions.revokeUser(user.id) : 0)
		} catch (error) {
			if (error instanceof OidcRejectedError) return fail('rejected', 'Invalid logout token')
			if (!(error instanceof OidcUnavailableError)) {
				this.ctx.logger.error('forum back-channel logout failed', { error })
			}
			return fail('unavailable', 'Logout cannot be processed right now')
		}
	}

	override testLoginAvailable(): boolean {
		return this.config.testLoginTokenSha256 !== undefined
	}

	override async testLogin(
		token: string | null,
		input: TestLoginInput,
		userAgent: string | null,
	): Promise<AuthResult<Readonly<{ userId: string; setCookie: string }>>> {
		const expected = this.config.testLoginTokenSha256
		if (expected === undefined) return fail('unavailable', '测试登录未启用')
		if (token === null || token.length > 512 || !(await matchesSha256(token, expected))) {
			return fail('rejected', '测试登录令牌无效')
		}
		if (!TEST_NAME.test(input.name)) return fail('rejected', '测试账号名只能用小写字母、数字和 -')
		try {
			const user = await this.core.ensureUser({
				subject: `${TEST_SUBJECT_PREFIX}${input.name}`,
				displayName: `测试 ${input.name}`,
				handleHint: `test-${input.name}`,
			})
			if (user.isErr()) return fail('rejected', user.error.message)
			if (input.admin === true) {
				const granted = await this.core.grantRole(user.value.id, 'admin')
				if (granted.isErr()) return fail('rejected', granted.error.message)
			}
			const id = await this.sessions.create({ userId: user.value.id, sid: undefined, userAgent })
			this.ctx.logger.warn('test login opened a session', { userId: user.value.id })
			return Result.ok({
				userId: user.value.id,
				setCookie: this.cookie(id, this.config.session.absoluteTtlSeconds),
			})
		} catch (error) {
			this.ctx.logger.error('test login failed', { error })
			return fail('unavailable', TRY_LATER)
		}
	}

	private redirectUri(): string {
		return `${this.config.publicOrigin}${LOGIN_CALLBACK_PATH}`
	}

	private secure(): boolean {
		return this.config.publicOrigin?.startsWith('https://') ?? true
	}

	/** `__Host-` pins the cookie to this exact host over HTTPS; plain HTTP exists only in development. */
	private cookieName(): string {
		return this.secure() ? '__Host-forum_session' : 'forum_session'
	}

	private cookie(value: string, maxAgeSeconds: number): string {
		const attributes = [`Max-Age=${maxAgeSeconds}`, 'Path=/', 'HttpOnly', 'SameSite=Lax']
		if (this.secure()) attributes.push('Secure')
		return `${this.cookieName()}=${value}; ${attributes.join('; ')}`
	}

	private sessionIdOf(request: Request): string | null {
		const value = readCookie(request, this.cookieName())
		return value !== null && SESSION_ID.test(value) ? value : null
	}

	private async loggedOut(endedSession: boolean): Promise<Logout> {
		let providerUrl: string | null = null
		const { oidc, publicOrigin } = this.config
		if (endedSession && this.oidc && oidc?.providerLogout && publicOrigin) {
			// Best effort: the local logout stands even when the provider cannot be asked.
			providerUrl = (await this.oidc.endSessionUrl(`${publicOrigin}/`).catch(() => null)) ?? null
		}
		return { setCookie: this.cookie('', 0), providerUrl }
	}

	private async clientSecret(): Promise<string | undefined> {
		const record = await this.ctx.require(Vault).kv().get(CLIENT_SECRET_KEY)
		if (!record.exists) return undefined
		if (typeof record.value !== 'string' || record.value === '') {
			throw new Error(`Vault record "${CLIENT_SECRET_KEY}" must be a non-empty string`)
		}
		return record.value
	}
}
