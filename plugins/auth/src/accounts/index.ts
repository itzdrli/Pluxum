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
import { ForumAuth } from '../index'
import { ForumCorePlugin } from '@pluxum/core'
import { BasePlugin, Plugin } from '@pluxel/core'
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
/** Subject prefix of these accounts in Pluxum Core; no identity provider issues subjects like it. */
export const LOCAL_SUBJECT_PREFIX = 'local:'
/** Web page that sets a new password from `?token=`. */
export const RESET_PAGE_PATH = '/reset-password'

const PASSWORD_MAX = 256
const EMAIL_MAX = 254
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/u

const RegisterBody = v.object({
	email: v.string(),
	password: v.string(),
	displayName: v.string(),
})
const LoginBody = v.object({ email: v.string(), password: v.string() })
const ResetRequestBody = v.object({ email: v.string() })
const ResetBody = v.object({ token: v.string(), password: v.string() })
const PasswordBody = v.object({ current: v.string(), password: v.string() })
const EmailBody = v.object({ password: v.string(), email: v.string() })
const DeleteBody = v.object({ password: v.string() })

/** Ext id of the account section on one's own profile page (web app: `slots/forum-accounts`). */
export const ACCOUNTS_EXT_ID = 'forum-accounts'

/** The signed-in member's own account, as the settings section shows it. */
export type AccountDto = Readonly<{ email: string; createdAt: string; passwordChangedAt: string }>

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
 * Each account is a Pluxum Core user with the subject `local:<account id>`; this plugin keeps
 * only the address and an scrypt hash. Sessions are Pluxum Auth's, the same as a provider login,
 * so logout, "log out everywhere" and bans work unchanged. Mounts:
 *
 * - `POST /api/forum/accounts/register` and `/login`: answer `{ userId }` and set the session;
 * - `POST /api/forum/accounts/reset-request`: mails a reset link through Pluxum Mail, when it runs;
 * - `POST /api/forum/accounts/reset`: sets a new password from a link and ends every old session;
 * - `GET /api/forum/accounts/options`: what the sign-in page may offer;
 * - `GET /api/forum/accounts/me`: the signed-in member's account (`{ account: null }` when they
 *   sign in another way);
 * - `POST /api/forum/accounts/password`, `/email` and `/delete`: change the password (ending every
 *   other session), change the address, or delete the account; each asks for the password.
 *
 * Attempts are rate limited per address (logins, resets) and per client (sign-ups).
 */
@Plugin({ displayName: 'Pluxum Accounts', startTimeoutMs: 30_000 })
export class ForumAccountsPlugin extends BasePlugin {
	private readonly config = this.configs.use(ForumAccountsConfig)
	private database!: PluginDatabaseHandle<typeof AccountsDatabase>
	private limiters = new Map<'logins' | 'signups' | 'resets', RateLimiter>()

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
		this.ctx.effects.defer(this.auth.registerPasswordLogin())
		this.ctx.effects.defer(
			this.core.registerUiSlots({ id: ACCOUNTS_EXT_ID, slots: ['user.profile.tabs'] }),
		)
		// However a forum user is removed, its login goes with it.
		this.ctx.effects.defer(
			this.core.registerUserRemoval({
				id: `${ACCOUNTS_EXT_ID}.removal`,
				remove: ({ userId }) =>
					this.database.transaction(async (tx) => {
						const gone = await tx
							.delete(accounts)
							.where(eq(accounts.userId, userId))
							.returning({ id: accounts.id })
						for (const { id } of gone) {
							// oxlint-disable-next-line no-await-in-loop -- one account per user.
							await tx.delete(passwordResets).where(eq(passwordResets.accountId, id))
						}
					}),
			}),
		)
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
				.post('/reset', ({ request, body }) => this.respond(() => this.reset(request, body)))
				.get('/me', ({ request }) => this.respond(() => this.me(request)))
				.post('/password', ({ request, body }) =>
					this.respond(() => this.changePassword(request, body)),
				)
				.post('/email', ({ request, body }) => this.respond(() => this.changeEmail(request, body)))
				.post('/delete', ({ request, body }) =>
					this.respond(() => this.deleteAccount(request, body)),
				),
		)
	}

	/** What the sign-in page may offer right now. */
	options(): Readonly<{ registration: boolean; reset: boolean; passwordMin: number }> {
		return {
			registration: this.config.registration === 'open',
			reset: this.auth.mailer()?.canSend() === true && this.auth.publicOrigin() !== null,
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
		const mail = this.auth.mailer()
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

	// ── Own account ─────────────────────────────────────────────────────────────────────────

	/**
	 * The signed-in member's account (`account: null` when they sign in another way) and the
	 * shortest password a change accepts.
	 */
	async me(request: Request): Promise<Response> {
		const userId = await this.viewerOf(request)
		const [account] = await this.database.read((db) =>
			db.select().from(accounts).where(eq(accounts.userId, userId)),
		)
		return Response.json(
			{ account: account ? accountDto(account) : null, passwordMin: this.config.passwordMin },
			{ headers: { 'cache-control': 'no-store' } },
		)
	}

	/** Sets a new password, ends every session and opens a fresh one for this request. */
	async changePassword(request: Request, raw: unknown): Promise<Response> {
		this.sameOrigin(request)
		const body = this.parse(PasswordBody, raw)
		this.password(body.password)
		const account = await this.confirmed(request, body.current)
		const passwordHash = await hashPassword(body.password)
		await this.database.transaction(async (tx) => {
			await tx
				.update(accounts)
				.set({ passwordHash, passwordChangedAt: new Date() })
				.where(eq(accounts.id, account.id))
			await tx.delete(passwordResets).where(eq(passwordResets.accountId, account.id))
		})
		await this.auth.revokeUserSessions(account.userId)
		this.notice(account.email, '密码已修改 / Your password was changed', [
			'你的账号密码刚刚修改过，其他设备都已退出登录。',
			'The password of your account was just changed; every other device was signed out.',
		])
		this.ctx.logger.info('password changed', { userId: account.userId })
		return this.signedIn(request, account.userId, 200)
	}

	/** Moves the account to another address; the old one is told. */
	async changeEmail(request: Request, raw: unknown): Promise<Response> {
		this.sameOrigin(request)
		const body = this.parse(EmailBody, raw)
		const email = this.email(body.email)
		const account = await this.confirmed(request, body.password)
		const emailKey = email.toLowerCase()
		const [updated] = await this.database
			.transaction(async (tx) => {
				if (emailKey !== account.emailKey) {
					const [taken] = await tx
						.select({ id: accounts.id })
						.from(accounts)
						.where(eq(accounts.emailKey, emailKey))
					if (taken) return []
				}
				return tx
					.update(accounts)
					.set({ email, emailKey })
					.where(eq(accounts.id, account.id))
					.returning()
			})
			// Another account took the address between the check and the write.
			.catch((error: unknown) => {
				if (isUniqueViolation(error)) return []
				throw error
			})
		if (!updated) throw refuse('conflict', errorDetail('account.email_taken'))
		await this.database.transaction((tx) =>
			tx.delete(passwordResets).where(eq(passwordResets.accountId, account.id)),
		)
		await this.core.setContactEmail(account.userId, email)
		if (emailKey !== account.emailKey) {
			this.notice(account.email, '邮箱已更换 / Your email address was changed', [
				`你的账号邮箱已改为 ${email}，以后的邮件会发到新地址。`,
				`The email address of your account is now ${email}; mail goes there from now on.`,
			])
		}
		this.ctx.logger.info('account email changed', { userId: account.userId })
		return Response.json(
			{ account: accountDto(updated) },
			{ headers: { 'cache-control': 'no-store' } },
		)
	}

	/**
	 * Deletes the account: the login goes, and Pluxum Core hands everything it wrote to Ghost
	 * before removing the forum user. Ends every session and removes the cookie.
	 */
	async deleteAccount(request: Request, raw: unknown): Promise<Response> {
		this.sameOrigin(request)
		const body = this.parse(DeleteBody, raw)
		const account = await this.confirmed(request, body.password)
		await this.database.transaction(async (tx) => {
			await tx.delete(passwordResets).where(eq(passwordResets.accountId, account.id))
			await tx.delete(accounts).where(eq(accounts.id, account.id))
		})
		const removed = await this.core.removeUser(account.userId)
		if (removed.isErr())
			this.ctx.logger.warn('deleted account had no forum user', { userId: account.userId })
		const { setCookie } = await this.auth.logout(request)
		await this.auth.revokeUserSessions(account.userId)
		this.notice(account.email, '账号已注销 / Your account was deleted', [
			'你的账号已经注销，这个邮箱可以重新注册。',
			'Your account was deleted; this address can sign up again.',
		])
		this.ctx.logger.info('account deleted', { userId: account.userId })
		return Response.json(
			{ ok: true },
			{ headers: { 'cache-control': 'no-store', 'set-cookie': setCookie } },
		)
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

	private async viewerOf(request: Request): Promise<string> {
		const authentication = await this.auth.authenticate(request)
		if (authentication.status !== 'authenticated')
			throw refuse('unauthenticated', errorDetail('auth.required'))
		return authentication.userId
	}

	/**
	 * The signed-in member's account once `password` is theirs. Attempts count against the
	 * login limit of the account, so a left-open session cannot be used to guess it.
	 */
	private async confirmed(request: Request, password: string) {
		const userId = await this.viewerOf(request)
		const [account] = await this.database.read((db) =>
			db.select().from(accounts).where(eq(accounts.userId, userId)),
		)
		if (!account) throw refuse('not_found', errorDetail('entity.not_found', { entity: 'user' }))
		if (password.length === 0 || password.length > PASSWORD_MAX)
			throw refuse('invalid', errorDetail('account.password_wrong'))
		await this.limit('logins', `user:${account.id}`)
		if (!(await verifyPassword(password, account.passwordHash)))
			throw refuse('invalid', errorDetail('account.password_wrong'))
		return account
	}

	/** Tells the owner about a change to their account, when Pluxum Mail can send. */
	private notice(to: string, subject: string, lines: readonly string[]): void {
		const mail = this.auth.mailer()
		if (!mail?.canSend()) return
		const site = this.core.site().name
		const sent = mail.sendTransactional({
			to,
			subject: `${site} ${subject}`,
			text: [
				...lines,
				'',
				'如果不是你本人操作，请尽快联系管理员。 / If it was not you, contact an administrator.',
			].join('\n'),
		})
		if (!sent) this.ctx.logger.warn('account notice mail was not queued')
	}

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
						mail: this.auth.mailer()?.canSend() === true ? 'available' : 'off',
						publicOrigin: this.auth.publicOrigin(),
					},
				}
			},
			actions: {
				resetLink: async ({ email }: ResetLinkInput) => {
					if (this.auth.publicOrigin() === null)
						return { ok: false, message: '先在 Pluxum Auth 的配置里填写论坛公开地址' }
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

function accountDto(account: typeof accounts.$inferSelect): AccountDto {
	return {
		email: account.email,
		createdAt: account.createdAt.toISOString(),
		passwordChangedAt: account.passwordChangedAt.toISOString(),
	}
}

/** Postgres `unique_violation`, wherever the driver puts the code. */
function isUniqueViolation(error: unknown): boolean {
	for (let current: unknown = error; current instanceof Error; current = current.cause) {
		if ('code' in current && current.code === '23505') return true
	}
	return false
}

/**
 * Who sent the request, for per-client limits: the first `X-Forwarded-For` hop (the HTTPS proxy
 * in front of the web app sets it), else a shared bucket.
 */
function clientAddress(request: Request): string {
	const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
	return forwarded && forwarded.length <= 64 ? forwarded : 'unknown'
}
