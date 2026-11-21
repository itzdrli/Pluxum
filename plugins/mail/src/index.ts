import { failure, noticeDetail } from '@pluxum/domain'
import type { ForumNotification, Principal } from '@pluxum/domain'
import { ForumApiPlugin } from '@pluxum/api'
import { ForumCorePlugin, type ForumResult } from '@pluxum/core'
import { BasePlugin, Plugin } from '@pluxel/core'
import { Result } from '@pluxel/core/better-result'
import { Database, type PluginDatabaseHandle } from '@pluxel/services/database'
import { Vault } from '@pluxel/services/vault'
import { count, eq } from 'drizzle-orm'
import type { Transporter } from 'nodemailer'
import { Type, type Static } from 'typebox'
import * as v from 'valibot'
import {
	maskEmail,
	escapeHtml,
	normalizeEmail,
	notificationMail,
	testMail,
	type MailMessage,
	type MailSite,
} from './compose'
import { ForumMailConfig, isSendable } from './config'
import { MailDatabase, mailPreferences } from './database'
import { fromOf, MailQueue, smtpTransport, type MailSender } from './smtp'
import { MAIL_LOCALES, type MailLocale } from './templates'
import { MailWorkbench, type MailStatus, type MailTestInput } from './workbench'

export { ForumMailConfig } from './config'
export { maskEmail, normalizeEmail, notificationMail } from './compose'
export type { MailMessage } from './compose'

/** The extension's ID: UI slot contributor ID and `/api/forum/ext/:extId` segment. */
export const MAIL_EXT_ID = 'forum-mail'
export const MAIL_CHANNEL_ID = 'forum-mail.smtp'
/** Vault record (in this plugin's namespace) holding the SMTP password. */
export const SMTP_PASSWORD_KEY = 'smtp-password'

const [chinese, english] = MAIL_LOCALES
const MailLocaleOrDefault = Type.Union([Type.Literal(chinese), Type.Literal(english), Type.Null()])

export const MailAddressResult = Type.Object({
	/** Whether the forum sends mail at all right now. */
	available: Type.Boolean(),
	/** The address the identity provider gave at the latest login; null when it shares none. */
	email: Type.Union([Type.String(), Type.Null()]),
	/** Whether the account wants notification mail (on unless switched off). */
	enabled: Type.Boolean(),
	/** The account's language override, or null to use the site default. */
	locale: MailLocaleOrDefault,
})
export type MailAddressResult = Static<typeof MailAddressResult>

const EmptyInput = Type.Object({})
const PreferenceInput = Type.Union([
	Type.Object({ enabled: Type.Boolean(), locale: Type.Optional(MailLocaleOrDefault) }),
	Type.Object({ enabled: Type.Optional(Type.Boolean()), locale: MailLocaleOrDefault }),
])

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Email over SMTP: a notification channel that mails each notification to its recipient at the
 * address their identity provider vouches for (the forum keeps no addresses of its own), unless
 * they switched mail off on their profile page.
 *
 * Contributes:
 * - `notificationChannels` (`forum-mail.smtp`), queued so a slow server never holds up a write;
 * - `extActions` under `/api/forum/ext/forum-mail/{address,preference}`;
 * - `uiSlots` (`user.profile.tabs`): the on/off switch on one's own profile page;
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
				action: 'preference',
				method: 'POST',
				login: true,
				input: PreferenceInput,
				output: MailAddressResult,
				handle: ({ principal, input }) => this.setPreferences(principal, input),
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

	private templatesFor(locale: MailLocale) {
		return locale === 'en' ? this.config.templatesEn : this.config.templatesZhCN
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
		const [contact, preferences] = await Promise.all([
			this.core.contactEmail(notification.recipientId),
			this.preferencesOf(notification.recipientId),
		])
		const email = contact === null ? null : normalizeEmail(contact)
		if (email === null || !preferences.enabled) return
		const locale = preferences.locale ?? this.config.defaultLocale
		const message = notificationMail(
			email,
			notification,
			this.site(),
			locale,
			this.templatesFor(locale),
		)
		if (!this.queue.push(message)) {
			throw new Error('The mail queue is full')
		}
	}

	/** Sends right away (test mail), so the caller learns whether it worked. */
	private async sendNow(message: MailMessage): Promise<void> {
		const send = this.sender()
		if (send === null) throw new Error('Mail is not configured')
		await send(message)
	}

	/** Whether mail can go out right now (for other plugins, e.g. password reset mail). */
	canSend(): boolean {
		return this.available()
	}

	/**
	 * Queues one plain-text mail that is not a notification (password reset and the like). It
	 * goes out whatever the recipient's notification preference says. False when mail is off,
	 * the address is invalid or the queue is full.
	 */
	sendTransactional(input: Readonly<{ to: string; subject: string; text: string }>): boolean {
		if (!this.available()) return false
		const to = normalizeEmail(input.to)
		if (to === null) return false
		const html = `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(input.text)}</pre>`
		return this.queue.push({ to, subject: input.subject, text: input.text, html })
	}

	/** Resolves once queued notification mail has been attempted (for tests). */
	async idle(): Promise<void> {
		await this.queue.idle()
	}

	// ── Preference ──────────────────────────────────────────────────────────────────────────

	private async preferencesOf(userId: string) {
		const [row] = await this.database.read((db) =>
			db
				.select({ enabled: mailPreferences.enabled, locale: mailPreferences.locale })
				.from(mailPreferences)
				.where(eq(mailPreferences.userId, userId)),
		)
		return row ?? { enabled: true, locale: null }
	}

	private async stateOf(userId: string): Promise<MailAddressResult> {
		const [email, preferences] = await Promise.all([
			this.core.contactEmail(userId),
			this.preferencesOf(userId),
		])
		return { available: this.available(), email, ...preferences }
	}

	/** Where the signed-in account's notification mail goes, and whether it wants it. */
	async address(principal: Principal): Promise<ForumResult<MailAddressResult>> {
		const userId = principal.userId
		if (userId === null) return Result.err(failure('unauthenticated', 'auth.required'))
		return Result.ok(await this.stateOf(userId))
	}

	/** Switches notification mail on or off for the signed-in account. */
	setEnabled(principal: Principal, enabled: boolean): Promise<ForumResult<MailAddressResult>> {
		return this.setPreferences(principal, { enabled })
	}

	/** Updates only the fields the account chose. */
	async setPreferences(
		principal: Principal,
		input: Static<typeof PreferenceInput>,
	): Promise<ForumResult<MailAddressResult>> {
		const userId = principal.userId
		if (userId === null) return Result.err(failure('unauthenticated', 'auth.required'))
		const { enabled, locale } = input
		const updatedAt = new Date()
		await this.database.transaction((tx) =>
			tx
				.insert(mailPreferences)
				.values({ userId, enabled: enabled ?? true, locale: locale ?? null, updatedAt })
				.onConflictDoUpdate({
					target: mailPreferences.userId,
					set: { enabled, locale, updatedAt },
				}),
		)
		return Result.ok(await this.stateOf(userId))
	}

	// ── Workbench ───────────────────────────────────────────────────────────────────────────

	private exampleNotification(to: string, site: MailSite, locale: MailLocale): MailMessage {
		const actor = 'Alex'
		const title = locale === 'en' ? 'Welcome to the forum' : '欢迎来到论坛'
		const detail = noticeDetail('notice.reply.topic', { actor, title })
		return notificationMail(
			to,
			{
				id: 'example',
				recipientId: 'example',
				kind: 'thread.reply',
				title: detail.title,
				titleKey: detail.key,
				titleParams: detail.params,
				body: locale === 'en' ? 'Thanks for starting the discussion!' : '谢谢你发起讨论！',
				path: '/',
				createdAt: new Date().toISOString(),
			},
			site,
			locale,
			this.templatesFor(locale),
		)
	}

	private workbenchContent() {
		return {
			load: async () => ({ status: await this.status() }),
			actions: {
				sendTest: async ({ to, locale, template }: MailTestInput) => {
					if (!this.available()) {
						return { ok: false, message: '邮件没有开启，或设置不完整（服务器、发件地址、密码）' }
					}
					try {
						const language = locale === 'default' ? this.config.defaultLocale : locale
						const site = this.site()
						const message =
							template === 'notification'
								? this.exampleNotification(to, site, language)
								: testMail(to, site, language, this.templatesFor(language))
						await this.sendNow(message)
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
		const [optedOut] = await this.database.read((db) =>
			db.select({ value: count() }).from(mailPreferences).where(eq(mailPreferences.enabled, false)),
		)
		return {
			sending: this.available() ? 'ready' : config.enabled ? 'incomplete' : 'disabled',
			server: config.host === '' ? null : `${config.host}:${config.port}`,
			password: !record.exists ? 'none' : record.source === 'kv' ? 'vault' : 'deployment',
			optedOut: optedOut?.value ?? 0,
			queued: this.queue.size,
		}
	}
}
