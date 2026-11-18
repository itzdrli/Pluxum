import { createHash, randomInt } from 'node:crypto'
import type { ForumNotification, Principal } from '@pluxum/domain'
import { ForumApiPlugin } from '@pluxum/api'
import { ForumCorePlugin, type ForumResult } from '@pluxum/core'
import { BasePlugin, Plugin } from '@pluxel/core'
import { Result } from '@pluxel/core/better-result'
import { Database, type PluginDatabaseHandle } from '@pluxel/services/database'
import { Vault } from '@pluxel/services/vault'
import { and, count, eq, isNotNull } from 'drizzle-orm'
import type { Transporter } from 'nodemailer'
import { Type, type Static } from 'typebox'
import * as v from 'valibot'
import {
	confirmationMail,
	EMAIL_MAX,
	maskEmail,
	normalizeEmail,
	notificationMail,
	testMail,
	type MailMessage,
	type MailSite,
} from './compose'
import { ForumMailConfig, isSendable } from './config'
import { MailDatabase, mailAddresses } from './database'
import { fromOf, MailQueue, smtpTransport, type MailSender } from './smtp'
import { MailWorkbench, type MailStatus } from './workbench'

export { ForumMailConfig } from './config'
export { maskEmail, normalizeEmail, notificationMail, confirmationMail } from './compose'
export type { MailMessage } from './compose'

/** The extension's ID: UI slot contributor ID and `/api/forum/ext/:extId` segment. */
export const MAIL_EXT_ID = 'forum-mail'
export const MAIL_CHANNEL_ID = 'forum-mail.smtp'
/** Vault record (in this plugin's namespace) holding the SMTP password. */
export const SMTP_PASSWORD_KEY = 'smtp-password'

const CODE_MINUTES = 30
const CODE_RESEND_MS = 60_000
const CODE_MAX_ATTEMPTS = 5

export const MailAddressResult = Type.Object({
	/** Whether the forum sends mail at all right now. */
	available: Type.Boolean(),
	email: Type.Union([Type.String(), Type.Null()]),
	verified: Type.Boolean(),
	enabled: Type.Boolean(),
	/** A confirmation code was sent and can still be entered. */
	pending: Type.Boolean(),
})
export type MailAddressResult = Static<typeof MailAddressResult>

const EmptyInput = Type.Object({})
const SetAddressInput = Type.Object({ email: Type.String({ maxLength: EMAIL_MAX + 16 }) })
const VerifyInput = Type.Object({ code: Type.String({ maxLength: 16 }) })
const PreferenceInput = Type.Object({ enabled: Type.Boolean() })

type AddressRow = typeof mailAddresses.$inferSelect

function codeHash(userId: string, code: string): string {
	return createHash('sha256').update(`${userId}:${code}`).digest('hex')
}

function stateOf(row: AddressRow | undefined, available: boolean): MailAddressResult {
	if (!row) return { available, email: null, verified: false, enabled: false, pending: false }
	return {
		available,
		email: row.email,
		verified: row.verifiedAt !== null,
		enabled: row.enabled,
		pending:
			row.codeHash !== null &&
			row.codeExpiresAt !== null &&
			row.codeExpiresAt.getTime() > Date.now() &&
			row.codeAttempts < CODE_MAX_ATTEMPTS,
	}
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Email over SMTP: a notification channel that mails each notification to its recipient, once
 * they have confirmed an address on their profile page and while they keep mail switched on.
 *
 * Contributes:
 * - `notificationChannels` (`forum-mail.smtp`), queued so a slow server never holds up a write;
 * - `extActions` under `/api/forum/ext/forum-mail/{address,set-address,verify,preference,remove}`;
 * - `uiSlots` (`user.profile.tabs`) for the address form on one's own profile page;
 * - a Workbench "邮件" tab: status, a test mail and the SMTP password (kept in Vault).
 */
@Plugin({ displayName: 'Forum Mail', startTimeoutMs: 30_000 })
export class ForumMailPlugin extends BasePlugin {
	private readonly config = this.configs.use(ForumMailConfig)
	private database!: PluginDatabaseHandle<typeof MailDatabase>
	private transport: Transporter | undefined
	private readonly queue = new MailQueue(
		() => this.sender(),
		(error, message) =>
			this.ctx.logger.warn('notification mail was not sent', {
				error,
				to: maskEmail(message.to),
			}),
	)

	constructor(
		private readonly core: ForumCorePlugin,
		private readonly api: ForumApiPlugin,
	) {
		super()
	}

	protected override async init(): Promise<void> {
		this.database = await this.ctx.require(Database).use(MailDatabase)
		await this.reconnect(this.config)
		this.configs.onUpdate(this.config, async ({ desired }) => {
			await this.reconnect(v.parse(ForumMailConfig, desired))
		})
		this.ctx.effects.defer(() => {
			const dropped = this.queue.stop()
			if (dropped > 0) this.ctx.logger.warn('stopped with notification mail unsent', { dropped })
			this.transport?.close()
			this.transport = undefined
		})

		this.ctx.effects.defer(
			this.core.registerNotificationChannel({
				id: MAIL_CHANNEL_ID,
				deliver: (notification) => this.deliver(notification),
			}),
		)
		this.ctx.effects.defer(
			this.core.registerUiSlots({ id: MAIL_EXT_ID, slots: ['user.profile.tabs'] }),
		)
		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: MAIL_EXT_ID,
				action: 'address',
				method: 'GET',
				login: true,
				input: EmptyInput,
				output: MailAddressResult,
				handle: ({ principal }) => this.address(principal),
			}),
		)
		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: MAIL_EXT_ID,
				action: 'set-address',
				method: 'POST',
				login: true,
				input: SetAddressInput,
				output: MailAddressResult,
				handle: ({ principal, input }) => this.setAddress(principal, input.email),
			}),
		)
		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: MAIL_EXT_ID,
				action: 'verify',
				method: 'POST',
				login: true,
				input: VerifyInput,
				output: MailAddressResult,
				handle: ({ principal, input }) => this.verify(principal, input.code),
			}),
		)
		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: MAIL_EXT_ID,
				action: 'preference',
				method: 'POST',
				login: true,
				input: PreferenceInput,
				output: MailAddressResult,
				handle: ({ principal, input }) => this.setEnabled(principal, input.enabled),
			}),
		)
		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: MAIL_EXT_ID,
				action: 'remove',
				method: 'POST',
				login: true,
				input: EmptyInput,
				output: MailAddressResult,
				handle: ({ principal }) => this.remove(principal),
			}),
		)
		this.ctx.workbench?.publish(MailWorkbench, { mail: () => this.workbenchContent() })
	}

	// ── Sending ─────────────────────────────────────────────────────────────────────────────

	/** Whether mail can go out: switched on, complete settings and a transport. */
	private available(): boolean {
		return this.transport !== undefined
	}

	private site(): MailSite {
		const url = this.config.siteUrl
		return { name: this.core.site().name, url: url === '' ? undefined : url }
	}

	private sender(): MailSender | null {
		const transport = this.transport
		if (!transport) return null
		const from = fromOf(this.config, this.site().name)
		return async (message) => {
			await transport.sendMail({ from, ...message })
		}
	}

	/** Rebuilds the transport for `config` and the password in Vault. */
	private async reconnect(config: Readonly<ForumMailConfig>): Promise<void> {
		this.transport?.close()
		this.transport = undefined
		if (!isSendable(config)) return
		const record = await this.ctx.require(Vault).kv().get(SMTP_PASSWORD_KEY)
		const password = record.exists && typeof record.value === 'string' ? record.value : null
		if (config.username !== '' && password === null) {
			this.ctx.logger.warn('SMTP needs a login but no password is set; mail stays off')
			return
		}
		this.transport = smtpTransport(config, password)
	}

	private async deliver(notification: ForumNotification): Promise<void> {
		if (!this.available()) return
		const [row] = await this.database.read((db) =>
			db.select().from(mailAddresses).where(eq(mailAddresses.userId, notification.recipientId)),
		)
		if (!row || row.verifiedAt === null || !row.enabled) return
		if (!this.queue.push(notificationMail(row.email, notification, this.site()))) {
			throw new Error('The mail queue is full')
		}
	}

	/** Sends right away (confirmation codes, test mail), so the caller learns whether it worked. */
	private async sendNow(message: MailMessage): Promise<void> {
		const send = this.sender()
		if (send === null) throw new Error('Mail is not configured')
		await send(message)
	}

	/** Resolves once queued notification mail has been attempted (for tests). */
	async idle(): Promise<void> {
		await this.queue.idle()
	}

	// ── Addresses ───────────────────────────────────────────────────────────────────────────

	private async row(userId: string): Promise<AddressRow | undefined> {
		const [row] = await this.database.read((db) =>
			db.select().from(mailAddresses).where(eq(mailAddresses.userId, userId)),
		)
		return row
	}

	/** The signed-in account's address and whether it receives mail. */
	async address(principal: Principal): Promise<ForumResult<MailAddressResult>> {
		const userId = principal.userId
		if (userId === null) return Result.err({ code: 'unauthenticated', message: '请先登录' })
		return Result.ok(stateOf(await this.row(userId), this.available()))
	}

	/**
	 * Sets (or replaces) the account's address and mails it a confirmation code. Until the code is
	 * entered the address receives nothing else. A new code can be asked for once a minute.
	 */
	async setAddress(principal: Principal, input: string): Promise<ForumResult<MailAddressResult>> {
		const userId = principal.userId
		if (userId === null) return Result.err({ code: 'unauthenticated', message: '请先登录' })
		if (!this.available()) return Result.err({ code: 'unavailable', message: '论坛暂未开启邮件' })
		const email = normalizeEmail(input)
		if (email === null) return Result.err({ code: 'invalid', message: '请输入有效的邮箱地址' })

		const current = await this.row(userId)
		const now = Date.now()
		if (current?.codeSentAt && now - current.codeSentAt.getTime() < CODE_RESEND_MS) {
			const seconds = Math.ceil((CODE_RESEND_MS - (now - current.codeSentAt.getTime())) / 1000)
			return Result.err({ code: 'rate_limited', message: `请 ${seconds} 秒后再获取验证码` })
		}
		if (current?.email === email && current.verifiedAt !== null) {
			return Result.ok(stateOf(current, true))
		}

		const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
		try {
			await this.sendNow(confirmationMail(email, code, CODE_MINUTES, this.site()))
		} catch (error) {
			this.ctx.logger.warn('confirmation mail was not sent', { error, to: maskEmail(email) })
			return Result.err({ code: 'unavailable', message: '验证码发送失败，请稍后再试' })
		}
		const values = {
			email,
			verifiedAt: null,
			codeHash: codeHash(userId, code),
			codeExpiresAt: new Date(now + CODE_MINUTES * 60_000),
			codeSentAt: new Date(now),
			codeAttempts: 0,
			updatedAt: new Date(now),
		}
		const [row] = await this.database.transaction((tx) =>
			tx
				.insert(mailAddresses)
				.values({ userId, enabled: true, ...values })
				.onConflictDoUpdate({ target: mailAddresses.userId, set: values })
				.returning(),
		)
		return Result.ok(stateOf(row, true))
	}

	/** Confirms the address with the mailed code. Five wrong tries void the code. */
	async verify(principal: Principal, input: string): Promise<ForumResult<MailAddressResult>> {
		const userId = principal.userId
		if (userId === null) return Result.err({ code: 'unauthenticated', message: '请先登录' })
		const code = input.trim()
		const current = await this.row(userId)
		const state = stateOf(current, this.available())
		if (!current || !state.pending || current.codeHash === null) {
			return Result.err({ code: 'invalid', message: '验证码已失效，请重新获取' })
		}
		if (!/^\d{6}$/.test(code) || codeHash(userId, code) !== current.codeHash) {
			const attempts = current.codeAttempts + 1
			await this.database.transaction((tx) =>
				tx
					.update(mailAddresses)
					.set({ codeAttempts: attempts })
					.where(eq(mailAddresses.userId, userId)),
			)
			return Result.err({
				code: 'invalid',
				message: attempts >= CODE_MAX_ATTEMPTS ? '验证码错误次数过多，请重新获取' : '验证码不正确',
			})
		}
		const [row] = await this.database.transaction((tx) =>
			tx
				.update(mailAddresses)
				.set({
					verifiedAt: new Date(),
					enabled: true,
					codeHash: null,
					codeExpiresAt: null,
					codeAttempts: 0,
					updatedAt: new Date(),
				})
				.where(eq(mailAddresses.userId, userId))
				.returning(),
		)
		return Result.ok(stateOf(row, this.available()))
	}

	/** Switches notification mail on or off for a confirmed address. */
	async setEnabled(
		principal: Principal,
		enabled: boolean,
	): Promise<ForumResult<MailAddressResult>> {
		const userId = principal.userId
		if (userId === null) return Result.err({ code: 'unauthenticated', message: '请先登录' })
		const [row] = await this.database.transaction((tx) =>
			tx
				.update(mailAddresses)
				.set({ enabled, updatedAt: new Date() })
				.where(and(eq(mailAddresses.userId, userId), isNotNull(mailAddresses.verifiedAt)))
				.returning(),
		)
		if (!row) return Result.err({ code: 'invalid', message: '请先验证邮箱' })
		return Result.ok(stateOf(row, this.available()))
	}

	/** Forgets the account's address. */
	async remove(principal: Principal): Promise<ForumResult<MailAddressResult>> {
		const userId = principal.userId
		if (userId === null) return Result.err({ code: 'unauthenticated', message: '请先登录' })
		await this.database.transaction((tx) =>
			tx.delete(mailAddresses).where(eq(mailAddresses.userId, userId)),
		)
		return Result.ok(stateOf(undefined, this.available()))
	}

	// ── Workbench ───────────────────────────────────────────────────────────────────────────

	private workbenchContent() {
		return {
			load: async () => ({ status: await this.status() }),
			actions: {
				sendTest: async ({ to }: { to: string }) => {
					if (!this.available()) {
						return { ok: false, message: '邮件没有开启，或设置不完整（服务器、发件地址、密码）' }
					}
					try {
						await this.sendNow(testMail(to, this.site()))
						return { ok: true, message: `测试邮件已发往 ${to}` }
					} catch (error) {
						this.ctx.logger.warn('test mail failed', { error })
						return { ok: false, message: `发送失败：${errorText(error)}` }
					}
				},
				setPassword: async ({ password }: { password: string }) => {
					const kv = this.ctx.require(Vault).kv()
					const current = await kv.get(SMTP_PASSWORD_KEY)
					if (current.exists && !current.writable) {
						return { ok: false, message: '密码由部署环境提供，不能在这里修改' }
					}
					await kv.set(SMTP_PASSWORD_KEY, password)
					await this.reconnect(this.config)
					return { ok: true, message: 'SMTP 密码已保存' }
				},
				clearPassword: async () => {
					const kv = this.ctx.require(Vault).kv()
					const current = await kv.get(SMTP_PASSWORD_KEY)
					if (!current.exists) return { ok: true, message: '没有保存 SMTP 密码' }
					if (!current.writable) {
						return { ok: false, message: '密码由部署环境提供，不能在这里删除' }
					}
					await kv.delete(SMTP_PASSWORD_KEY)
					await this.reconnect(this.config)
					return { ok: true, message: 'SMTP 密码已删除' }
				},
			},
		}
	}

	private async status(): Promise<MailStatus> {
		const config = this.config
		const record = await this.ctx.require(Vault).kv().get(SMTP_PASSWORD_KEY)
		const [subscribers] = await this.database.read((db) =>
			db
				.select({ value: count() })
				.from(mailAddresses)
				.where(and(isNotNull(mailAddresses.verifiedAt), eq(mailAddresses.enabled, true))),
		)
		return {
			sending: this.available() ? 'ready' : config.enabled ? 'incomplete' : 'disabled',
			server: config.host === '' ? null : `${config.host}:${config.port}`,
			password: !record.exists ? 'none' : record.source === 'kv' ? 'vault' : 'deployment',
			subscribers: subscribers?.value ?? 0,
			queued: this.queue.size,
		}
	}
}
