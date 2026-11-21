import {
	errorDetail,
	failure,
	failureOf,
	validateDisplayName,
	type ApiError,
	type ErrorDetail,
	type ForumErrorCode,
	type RateBucket,
} from '@pluxum/domain'
import { ForumAuth } from '@pluxum/auth'
import { ForumCorePlugin } from '@pluxum/core'
import type { ForumMailPlugin } from '@pluxum/mail'
import { BasePlugin, definePluginRef, Plugin } from '@pluxel/core'
import { Rates, type RateLimiter } from '@pluxel/plugin-rates'
import { Database, type PluginDatabaseHandle } from '@pluxel/services/database'
import { ElysiaApp } from '@pluxel/services/elysia'
import { and, count, eq, gt, lt } from 'drizzle-orm'
import * as v from 'valibot'
import { ForumAccountsConfig } from './config'
import { accounts, AccountsDatabase, passwordResets } from './database'
import {
	decoyHash,
	hashPassword,
	needsRehash,
	randomToken,
	sha256,
	verifyPassword,
} from './password'
import { AccountsWorkbench, type AccountsStatus, type ResetLinkInput } from './workbench'

export { ForumAccountsConfig } from './config'

/** Where the routes live; the web app proxies everything under `/api/forum`. */
export const ACCOUNTS_PREFIX = '/api/forum/accounts'
/** Subject prefix of these accounts in Forum Core; no identity provider issues subjects like it. */
export const LOCAL_SUBJECT_PREFIX = 'local:'
/** Web page that sets a new password from `?token=`. */
export const RESET_PAGE_PATH = '/reset-password'

const PASSWORD_MAX = 256
const EMAIL_MAX = 254
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/u

const Mail = definePluginRef<ForumMailPlugin>()

const RegisterBody = v.object({
	email: v.string(),
	password: v.string(),
	displayName: v.string(),
})
const LoginBody = v.object({ email: v.string(), password: v.string() })
const ResetRequestBody = v.object({ email: v.string() })
const ResetBody = v.object({ token: v.string(), password: v.string() })

const STATUS: Readonly<Record<ForumErrorCode | 'unavailable', number>> = {
	invalid: 422,
	unauthenticated: 401,
	forbidden: 403,
	not_found: 404,
	conflict: 409,
	unavailable: 503,
	rate_limited: 429,
}

class Refusal extends Error {
	constructor(
		readonly status: number,
		readonly error: ApiError,
	) {
		super(error.message)
	}
}

const refuse = (code: ForumErrorCode, detail: ErrorDetail): Refusal =>
	new Refusal(STATUS[code], failureOf(code, detail))

/** A trimmed address with the domain lower-cased, or null when it does not look deliverable. */
export function normalizeEmail(input: string): string | null {
	const value = input.trim()
	if (value.length === 0 || value.length > EMAIL_MAX || !EMAIL.test(value)) return null
	const at = value.lastIndexOf('@')
	return `${value.slice(0, at)}@${value.slice(at + 1).toLowerCase()}`
}

/**
 * Email and password accounts, so a forum can open without an identity provider.
 *
 * Each account is a Forum Core user with the subject `local:<account id>`; this plugin keeps
 * only the address and an scrypt hash. Sessions are Forum Auth's, the same as a provider login,
 * so logout, "log out everywhere" and bans work unchanged. Mounts:
 *
 * - `POST /api/forum/accounts/register` and `/login`: answer `{ userId }` and set the session;
 * - `POST /api/forum/accounts/reset-request`: mails a reset link through Forum Mail, when it runs;
 * - `POST /api/forum/accounts/reset`: sets a new password from a link and ends every old session;
 * - `GET /api/forum/accounts/options`: what the sign-in page may offer.
 *
 * Attempts are rate limited per address (logins, resets) and per client (sign-ups).
 */
@Plugin({ displayName: 'Forum Accounts', startTimeoutMs: 30_000 })
export class ForumAccountsPlugin extends BasePlugin {
	private readonly config = this.configs.use(ForumAccountsConfig)
	private database!: PluginDatabaseHandle<typeof AccountsDatabase>
	private limiters = new Map<'logins' | 'signups' | 'resets', RateLimiter>()
	private mail: ForumMailPlugin | undefined

	constructor(
		private readonly core: ForumCorePlugin,
		private readonly auth: ForumAuth,
		private readonly rates: Rates,
	) {
		super()
	}

	protected override async init(): Promise<void> {
		this.database = await this.ctx.require(Database).use(AccountsDatabase)
		this.limiters = this.openLimiters(this.config.limits)
		this.configs.onUpdate(this.config, ({ desired }) => {
			this.limiters = this.openLimiters(v.parse(ForumAccountsConfig, desired).limits)
		})
		this.plugins.use(Mail, (mail) => {
			this.mail = mail
			return () => {
				this.mail = undefined
			}
		})
		this.ctx.effects.defer(this.auth.registerPasswordLogin())
		this.ctx.workbench?.publish(AccountsWorkbench, { accounts: () => this.workbenchContent() })
		this.ctx.require(ElysiaApp).group(ACCOUNTS_PREFIX, (app) =>
			app
				.get('/options', () =>
					Response.json(this.options(), { headers: { 'cache-control': 'no-store' } }),
				)
				.post('/register', ({ request, body }) => this.respond(() => this.register(request, body)))
				.post('/login', ({ request, body }) => this.respond(() => this.login(request, body)))
				.post('/reset-request', ({ request, body }) =>
					this.respond(() => this.requestReset(request, body)),
				)
				.post('/reset', ({ request, body }) => this.respond(() => this.reset(request, body))),
		)
	}

	/** What the sign-in page may offer right now. */
	options(): Readonly<{ registration: boolean; reset: boolean; passwordMin: number }> {
		return {
			registration: this.config.registration === 'open',
			reset: this.mail?.canSend() === true && this.auth.publicOrigin() !== null,
			passwordMin: this.config.passwordMin,
		}
	}

	// ── Flows ───────────────────────────────────────────────────────────────────────────────

	/** Creates an account and signs it in. */
	async register(request: Request, raw: unknown): Promise<Response> {
		this.sameOrigin(request)
		const body = this.parse(RegisterBody, raw)
		if (this.config.registration !== 'open')
			throw refuse('forbidden', errorDetail('account.registration_closed'))
		const email = this.email(body.email)
		this.password(body.password)
		const displayName = validateDisplayName(body.displayName)
		if (!displayName.ok) throw refuse('invalid', displayName.error)
		await this.limit('signups', clientAddress(request))

		const emailKey = email.toLowerCase()
		const [taken] = await this.database.read((db) =>
			db.select({ id: accounts.id }).from(accounts).where(eq(accounts.emailKey, emailKey)),
		)
		if (taken) throw refuse('conflict', errorDetail('account.email_taken'))

		const passwordHash = await hashPassword(body.password)
		const id = crypto.randomUUID()
		const user = await this.core.ensureUser({
			subject: `${LOCAL_SUBJECT_PREFIX}${id}`,
			displayName: displayName.value,
		})
		if (user.isErr()) throw new Refusal(STATUS[user.error.code], user.error)
		const inserted = await this.database
			.transaction((tx) =>
				tx
					.insert(accounts)
					.values({ id, userId: user.value.id, email, emailKey, passwordHash })
					.onConflictDoNothing()
					.returning({ id: accounts.id }),
			)
			.then((rows) => rows.length > 0)
		// Lost a race for the address: the forum user just made stays unused (no login reaches it).
		if (!inserted) throw refuse('conflict', errorDetail('account.email_taken'))
		await this.core.setContactEmail(user.value.id, email)
		this.ctx.logger.info('account registered', { userId: user.value.id })
		return this.signedIn(request, user.value.id, 201)
	}

	/** Signs in with email and password. Unknown address and wrong password answer the same. */
	async login(request: Request, raw: unknown): Promise<Response> {
		this.sameOrigin(request)
		const body = this.parse(LoginBody, raw)
		const email = normalizeEmail(body.email)
		if (email === null || body.password.length === 0 || body.password.length > PASSWORD_MAX)
			throw refuse('invalid', errorDetail('account.credentials'))
		await this.limit('logins', email.toLowerCase())

		const [account] = await this.database.read((db) =>
			db.select().from(accounts).where(eq(accounts.emailKey, email.toLowerCase())),
		)
		const matches = await verifyPassword(
			body.password,
			account?.passwordHash ?? (await decoyHash()),
		)
		if (!account || !matches) throw refuse('invalid', errorDetail('account.credentials'))
		if (needsRehash(account.passwordHash)) {
			const passwordHash = await hashPassword(body.password)
			await this.database.transaction((tx) =>
				tx.update(accounts).set({ passwordHash }).where(eq(accounts.id, account.id)),
			)
		}
		return this.signedIn(request, account.userId, 200)
	}

	/** Mails a reset link when the address has an account. Always answers the same way. */
	async requestReset(request: Request, raw: unknown): Promise<Response> {
		this.sameOrigin(request)
		const body = this.parse(ResetRequestBody, raw)
		const email = this.email(body.email)
		const mail = this.mail
		const origin = this.auth.publicOrigin()
		if (!mail?.canSend() || origin === null)
			throw refuse('unavailable', errorDetail('account.reset_unavailable'))
		await this.limit('resets', email.toLowerCase())
		const link = await this.resetLinkFor(email)
		if (link !== null) {
			const site = this.core.site().name
			const minutes = this.config.resetMinutes
			const sent = mail.sendTransactional({
				to: email,
				subject: `${site} 重设密码 / Reset your password`,
				text: [
					`有人为你在 ${site} 的账号申请了重设密码。打开下面的链接设置新密码（${minutes} 分钟内有效）：`,
					`Someone asked to reset the password of your account on ${site}. Open this link to set a new one (valid for ${minutes} minutes):`,
					'',
					link,
					'',
					'如果不是你申请的，忽略这封邮件即可。 / If it was not you, ignore this mail.',
				].join('\n'),
			})
			if (!sent) this.ctx.logger.warn('password reset mail was not queued')
		}
		return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } })
	}

	/** Sets a new password from a reset link, ends every other session and signs in. */
	async reset(request: Request, raw: unknown): Promise<Response> {
		this.sameOrigin(request)
		const body = this.parse(ResetBody, raw)
		this.password(body.password)
		if (!/^[\w-]{43}$/.test(body.token))
			throw refuse('invalid', errorDetail('account.reset_invalid'))
		const passwordHash = await hashPassword(body.password)
		const userId = await this.database.transaction(async (tx) => {
			// Taken in the same step as it is checked: a link works once.
			const [taken] = await tx
				.delete(passwordResets)
				.where(
					and(
						eq(passwordResets.tokenHash, sha256(body.token)),
						gt(passwordResets.expiresAt, new Date()),
					),
				)
				.returning({ accountId: passwordResets.accountId })
			if (!taken) return null
			const [account] = await tx
				.update(accounts)
				.set({ passwordHash, passwordChangedAt: new Date() })
				.where(eq(accounts.id, taken.accountId))
				.returning({ userId: accounts.userId })
			await tx.delete(passwordResets).where(eq(passwordResets.accountId, taken.accountId))
			return account?.userId ?? null
		})
		if (userId === null) throw refuse('invalid', errorDetail('account.reset_invalid'))
		await this.auth.revokeUserSessions(userId)
		this.ctx.logger.info('password reset', { userId })
		return this.signedIn(request, userId, 200)
	}

	/**
	 * A one-time reset link for an address, or null when it has no account. Expired links are
	 * swept on the way.
	 */
	async resetLinkFor(email: string): Promise<string | null> {
		const origin = this.auth.publicOrigin()
		if (origin === null) return null
		const [account] = await this.database.read((db) =>
			db
				.select({ id: accounts.id })
				.from(accounts)
				.where(eq(accounts.emailKey, email.toLowerCase())),
		)
		if (!account) return null
		const token = randomToken()
		const expiresAt = new Date(Date.now() + this.config.resetMinutes * 60_000)
		await this.database.transaction(async (tx) => {
			await tx.delete(passwordResets).where(lt(passwordResets.expiresAt, new Date()))
			await tx
				.insert(passwordResets)
				.values({ tokenHash: sha256(token), accountId: account.id, expiresAt })
		})
		return `${origin}${RESET_PAGE_PATH}?token=${token}`
	}

	// ── Helpers ─────────────────────────────────────────────────────────────────────────────

	private async signedIn(request: Request, userId: string, status: number): Promise<Response> {
		const setCookie = await this.auth.openSession(userId, request.headers.get('user-agent'))
		return Response.json(
			{ userId },
			{ status, headers: { 'cache-control': 'no-store', 'set-cookie': setCookie } },
		)
	}

	/** Runs a flow and turns a refusal into the forum's JSON error. */
	private async respond(flow: () => Promise<Response>): Promise<Response> {
		try {
			return await flow()
		} catch (error) {
			if (error instanceof Refusal) {
				return Response.json(
					{ error: error.error },
					{ status: error.status, headers: { 'cache-control': 'no-store' } },
				)
			}
			this.ctx.logger.error('account request failed', { error })
			return Response.json(
				{ error: failure('internal', 'server.internal') },
				{ status: 500, headers: { 'cache-control': 'no-store' } },
			)
		}
	}

	private sameOrigin(request: Request): void {
		if (!this.auth.allowsOrigin(request))
			throw refuse('forbidden', errorDetail('request.cross_site'))
	}

	private parse<T extends v.GenericSchema>(schema: T, raw: unknown): v.InferOutput<T> {
		const parsed = v.safeParse(schema, raw)
		if (!parsed.success) throw refuse('invalid', errorDetail('request.invalid'))
		return parsed.output
	}

	private email(input: string): string {
		const email = normalizeEmail(input)
		if (email === null) throw refuse('invalid', errorDetail('account.email_invalid'))
		return email
	}

	private password(input: string): void {
		const min = this.config.passwordMin
		if (Array.from(input).length < min)
			throw refuse('invalid', errorDetail('account.password_short', { min }))
		if (input.length > PASSWORD_MAX)
			throw refuse('invalid', errorDetail('account.password_long', { max: PASSWORD_MAX }))
	}

	private async limit(bucket: 'logins' | 'signups' | 'resets', key: string): Promise<void> {
		const limiter = this.limiters.get(bucket)
		if (!limiter) return
		const decision = await limiter.consume(key)
		if (!decision.denied) return
		const seconds = Math.max(1, Math.ceil(decision.retryAfterMs / 1000))
		throw refuse(
			'rate_limited',
			errorDetail('rate.limited', { bucket: bucket satisfies RateBucket, seconds }),
		)
	}

	/** One limiter per bucket; the policy is in the name so a changed limit starts a fresh count. */
	private openLimiters(limits: ForumAccountsConfig['limits']) {
		const open = (name: string, limit: number, windowMs: number) =>
			this.rates.use(`${name}-${limit}-per-${windowMs}`, {
				algorithm: 'sliding-window-counter',
				limit,
				windowMs,
			})
		return new Map([
			['logins', open('logins', limits.loginsPerEmail, 15 * 60_000)],
			['signups', open('signups', limits.signupsPerAddress, 60 * 60_000)],
			['resets', open('resets', limits.resetsPerEmail, 60 * 60_000)],
		] as const)
	}

	private workbenchContent() {
		return {
			load: async (): Promise<{ status: AccountsStatus }> => {
				const [row] = await this.database.read((db) => db.select({ total: count() }).from(accounts))
				return {
					status: {
						registration: this.config.registration,
						accounts: row?.total ?? 0,
						mail: this.mail?.canSend() === true ? 'available' : 'off',
						publicOrigin: this.auth.publicOrigin(),
					},
				}
			},
			actions: {
				resetLink: async ({ email }: ResetLinkInput) => {
					if (this.auth.publicOrigin() === null)
						return { ok: false, message: '先在 Forum Auth 的配置里填写论坛公开地址' }
					const normalized = normalizeEmail(email)
					const link = normalized === null ? null : await this.resetLinkFor(normalized)
					if (link === null) return { ok: false, message: '没有用这个邮箱注册的账号' }
					return {
						ok: true,
						message: `${this.config.resetMinutes} 分钟内有效，只能用一次：${link}`,
					}
				},
			},
		}
	}
}

/**
 * Who sent the request, for per-client limits: the first `X-Forwarded-For` hop (the HTTPS proxy
 * in front of the web app sets it), else a shared bucket.
 */
function clientAddress(request: Request): string {
	const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
	return forwarded && forwarded.length <= 64 ? forwarded : 'unknown'
}
