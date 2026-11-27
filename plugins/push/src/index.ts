import { failure, type ForumNotification, type NoticeKey, type Principal } from '@pluxum/domain'
import { ForumApiPlugin } from '@pluxum/api'
import { ForumAuth } from '@pluxum/auth'
import { ForumCorePlugin, type ForumResult } from '@pluxum/core'
import { BasePlugin, Plugin } from '@pluxel/core'
import { Result } from '@pluxel/core/better-result'
import { Pg, type PluginDatabaseHandle } from '@pluxel/services/pg'
import { and, desc, eq, notInArray } from 'drizzle-orm'
import { Type, type Static } from 'typebox'
import { PushDatabase, pushSubscriptions } from './database'
import {
	generateVapidKeys,
	isPushEndpoint,
	sendPush,
	type Fetch,
	type PushTarget,
	type VapidKeys,
} from './webpush'

export { encryptPayload, generateVapidKeys, isPushEndpoint, vapidAuthorization } from './webpush'

/** The extension's ID: its segment of the ext ingress and its UI slot key. */
export const PUSH_EXT_ID = 'forum-push'
export const PUSH_CHANNEL_ID = 'forum-push.channel'

/** The Vault record of the server's VAPID key pair. */
export const VAPID_KEYS_RECORD = 'vapid-keys'

/** A member's browsers beyond this many: the longest-subscribed one is dropped. */
export const SUBSCRIPTIONS_PER_USER = 20

/** How long a push service keeps trying to reach a browser that is offline. */
const TTL_SECONDS = 24 * 3600

const PushLocale = Type.Union([Type.Literal('zh-CN'), Type.Literal('en')])
export type PushLocale = Static<typeof PushLocale>

/** What a browser learns about push: whether the forum sends it, and whether this browser gets it. */
export const PushState = Type.Object({
	/** The server key a browser subscribes with; null while push cannot be sent (Vault locked). */
	publicKey: Type.Union([Type.String(), Type.Null()]),
	subscribed: Type.Boolean(),
})
export type PushState = Static<typeof PushState>

const Endpoint = Type.String({ minLength: 1, maxLength: 1024 })
const Base64Url = (max: number) =>
	Type.String({ minLength: 1, maxLength: max, pattern: '^[A-Za-z0-9_-]+=*$' })
const SubscribeInput = Type.Object({
	endpoint: Endpoint,
	p256dh: Base64Url(128),
	auth: Base64Url(64),
	locale: PushLocale,
})
const EndpointInput = Type.Object({ endpoint: Endpoint })
const OptionalEndpointInput = Type.Object({ endpoint: Type.Optional(Endpoint) })

const TestResult = Type.Object({ sent: Type.Boolean() })

/** English titles; the Chinese one comes finished with each notification. */
const EN_TITLES: {
	[K in NoticeKey]: (params: Readonly<Record<string, string | number>>) => string
} = {
	'notice.reply.topic': (p) => `${p.actor} replied to your thread “${p.title}”`,
	'notice.reply.note': (p) => `${p.actor} replied to your note`,
	'notice.reply.in_topic': (p) => `${p.actor} replied to you in “${p.title}”`,
	'notice.reply.in_note': (p) => `${p.actor} replied to you in a note`,
	'notice.mention.in_topic': (p) => `${p.actor} mentioned you in “${p.title}”`,
	'notice.mention.in_note': (p) => `${p.actor} mentioned you in a note`,
	'notice.follow': (p) => `${p.actor} followed you`,
	'notice.accepted': (p) => `${p.actor} accepted your answer`,
	'notice.message': (p) => `${p.actor} sent you a message`,
}

function clip(text: string, max: number): string {
	const chars = Array.from(text)
	return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`
}

/** The message a service worker shows for a notification, in the subscription's language. */
export function pushMessage(
	notification: Pick<
		ForumNotification,
		'id' | 'title' | 'titleKey' | 'titleParams' | 'body' | 'path'
	>,
	locale: PushLocale,
): Readonly<{ title: string; body: string; url: string; tag: string }> {
	const english =
		locale === 'en' && notification.titleKey !== undefined
			? EN_TITLES[notification.titleKey](notification.titleParams ?? {})
			: undefined
	return {
		title: clip(english ?? notification.title, 160),
		body: clip(notification.body ?? '', 240),
		url: notification.path?.startsWith('/') === true ? notification.path : '/notifications',
		tag: notification.id,
	}
}

/**
 * Browser push notifications (Web Push with VAPID), as an extension of the forum. Every
 * notification the forum delivers also goes to each browser its recipient switched push on in,
 * worded in that browser's language. The server key pair is made on first start and kept in this
 * plugin's Vault. Contributes:
 * - a notification channel (`forum-push.channel`);
 * - `extActions` `state`, `subscribe`, `unsubscribe` and `test` under `/api/forum/ext/forum-push`;
 * - `uiSlots`: the switch in `user.profile.tabs` (own profile).
 *
 * Stopping it stops the notices; subscriptions stay stored and work again when it starts.
 */
// PGlite compiles its WASM module on first use, which can exceed the default start timeout.
@Plugin({ displayName: 'Pluxum Push', startTimeoutMs: 30_000 })
export class ForumPushPlugin extends BasePlugin {
	private database!: PluginDatabaseHandle<typeof PushDatabase>
	private keys: VapidKeys | null = null
	private sending = new Set<Promise<void>>()
	/** Stands in for the network in tests; null sends for real. */
	private transport: Fetch | null = null

	constructor(
		private readonly core: ForumCorePlugin,
		private readonly api: ForumApiPlugin,
		private readonly auth: ForumAuth,
	) {
		super()
	}

	protected override async init(): Promise<void> {
		this.database = await this.ctx.service(Pg).use(PushDatabase)
		await this.loadKeys()
		this.ctx.effects.defer(
			this.core.registerUserRemoval({
				id: `${PUSH_EXT_ID}.removal`,
				remove: ({ userId }) =>
					this.database.transaction(async (tx) => {
						await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))
					}),
			}),
		)
		this.ctx.effects.defer(
			this.core.registerNotificationChannel({
				id: PUSH_CHANNEL_ID,
				deliver: (notification) => this.deliver(notification),
			}),
		)
		this.ctx.effects.defer(
			this.core.registerUiSlots({ id: PUSH_EXT_ID, slots: ['user.profile.tabs'] }),
		)
		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: PUSH_EXT_ID,
				action: 'state',
				method: 'GET',
				login: false,
				input: OptionalEndpointInput,
				output: PushState,
				handle: ({ principal, input }) => this.state(principal, input.endpoint),
			}),
		)
		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: PUSH_EXT_ID,
				action: 'subscribe',
				method: 'POST',
				login: true,
				input: SubscribeInput,
				output: PushState,
				handle: ({ principal, input }) => this.subscribe(principal, input),
			}),
		)
		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: PUSH_EXT_ID,
				action: 'unsubscribe',
				method: 'POST',
				login: true,
				input: EndpointInput,
				output: PushState,
				handle: ({ principal, input }) => this.unsubscribe(principal, input.endpoint),
			}),
		)
		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: PUSH_EXT_ID,
				action: 'test',
				method: 'POST',
				login: true,
				input: EndpointInput,
				output: TestResult,
				handle: ({ principal, input }) => this.test(principal, input.endpoint),
			}),
		)
	}

	/** The VAPID keys, made and saved on first use; null while Vault cannot be read. */
	private async loadKeys(): Promise<VapidKeys | null> {
		if (this.keys !== null) return this.keys
		try {
			const kv = this.ctx.vault.kv()
			const record = await kv.get<VapidKeys>(VAPID_KEYS_RECORD)
			if (record.exists && isVapidKeys(record.value)) {
				this.keys = record.value
			} else {
				const made = generateVapidKeys()
				// Two starts racing: the loser's write fails on the revision and it reads the winner's.
				await kv.set(VAPID_KEYS_RECORD, made, { expectedRevision: record.revision })
				this.keys = made
			}
		} catch (error) {
			this.ctx.logger.warn('push keys unavailable; browser push is off until Vault opens', {
				error,
			})
			return null
		}
		return this.keys
	}

	/** The contact push services get with each message: the forum's public address. */
	private subject(): string {
		return this.auth.publicOrigin() ?? 'mailto:push@localhost'
	}

	async state(principal: Principal, endpoint: string | undefined): Promise<ForumResult<PushState>> {
		const keys = await this.loadKeys()
		if (principal.userId === null || endpoint === undefined) {
			return Result.ok({ publicKey: keys?.publicKey ?? null, subscribed: false })
		}
		const [row] = await this.database.read((db) =>
			db
				.select({ endpoint: pushSubscriptions.endpoint })
				.from(pushSubscriptions)
				.where(
					and(
						eq(pushSubscriptions.endpoint, endpoint),
						eq(pushSubscriptions.userId, principal.userId ?? ''),
					),
				),
		)
		return Result.ok({ publicKey: keys?.publicKey ?? null, subscribed: row !== undefined })
	}

	/** Saves a browser's subscription for the member; the same browser moves to whoever signed in last. */
	async subscribe(
		principal: Principal,
		input: Static<typeof SubscribeInput>,
	): Promise<ForumResult<PushState>> {
		const userId = principal.userId
		if (userId === null) return Result.err(failure('unauthenticated', 'auth.required'))
		const keys = await this.loadKeys()
		if (keys === null) return Result.err(failure('unavailable', 'request.invalid'))
		if (!isPushEndpoint(input.endpoint)) return Result.err(failure('invalid', 'request.invalid'))
		const { endpoint, p256dh, auth, locale } = input
		await this.database.transaction(async (tx) => {
			await tx
				.insert(pushSubscriptions)
				.values({ endpoint, userId, p256dh, auth, locale })
				.onConflictDoUpdate({
					target: pushSubscriptions.endpoint,
					set: { userId, p256dh, auth, locale, createdAt: new Date() },
				})
			const kept = tx
				.select({ endpoint: pushSubscriptions.endpoint })
				.from(pushSubscriptions)
				.where(eq(pushSubscriptions.userId, userId))
				.orderBy(desc(pushSubscriptions.createdAt))
				.limit(SUBSCRIPTIONS_PER_USER)
			await tx
				.delete(pushSubscriptions)
				.where(
					and(eq(pushSubscriptions.userId, userId), notInArray(pushSubscriptions.endpoint, kept)),
				)
		})
		return Result.ok({ publicKey: keys.publicKey, subscribed: true })
	}

	async unsubscribe(principal: Principal, endpoint: string): Promise<ForumResult<PushState>> {
		const userId = principal.userId
		if (userId === null) return Result.err(failure('unauthenticated', 'auth.required'))
		await this.database.transaction((tx) =>
			tx
				.delete(pushSubscriptions)
				.where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId))),
		)
		return Result.ok({ publicKey: this.keys?.publicKey ?? null, subscribed: false })
	}

	/** Sends a sample notice to one of the member's browsers, and says whether the service took it. */
	async test(
		principal: Principal,
		endpoint: string,
	): Promise<ForumResult<Static<typeof TestResult>>> {
		const userId = principal.userId
		if (userId === null) return Result.err(failure('unauthenticated', 'auth.required'))
		const [row] = await this.database.read((db) =>
			db
				.select()
				.from(pushSubscriptions)
				.where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId))),
		)
		if (row === undefined) return Result.err(failure('invalid', 'request.invalid'))
		const locale: PushLocale = row.locale === 'en' ? 'en' : 'zh-CN'
		const site = this.core.site().name
		const sent = await this.sendTo(row, {
			title: site,
			body: locale === 'en' ? 'Notifications are on.' : '通知已开启',
			url: '/notifications',
			tag: 'forum-push-test',
		})
		return Result.ok({ sent })
	}

	/** Replaces the network for tests. */
	useTransport(send: Fetch | null): void {
		this.transport = send
	}

	/** Resolves once background sends have finished (for tests). */
	async idle(): Promise<void> {
		while (this.sending.size > 0) {
			// oxlint-disable-next-line no-await-in-loop -- sends started meanwhile are waited for too.
			await Promise.allSettled(this.sending)
		}
	}

	private async deliver(notification: ForumNotification): Promise<void> {
		if ((await this.loadKeys()) === null) return
		const rows = await this.database.read((db) =>
			db
				.select()
				.from(pushSubscriptions)
				.where(eq(pushSubscriptions.userId, notification.recipientId)),
		)
		if (rows.length === 0) return
		// Push services can be slow; the forum does not wait for them.
		const job = Promise.allSettled(
			rows.map((row) =>
				this.sendTo(row, pushMessage(notification, row.locale === 'en' ? 'en' : 'zh-CN')),
			),
		).then(() => undefined)
		this.sending.add(job)
		void job.finally(() => this.sending.delete(job))
	}

	/** Sends one message to one browser; drops the subscription when the service says it is gone. */
	private async sendTo(
		target: PushTarget,
		message: Readonly<Record<string, string>>,
	): Promise<boolean> {
		const keys = this.keys
		if (keys === null) return false
		const { outcome, status } = await sendPush(
			target,
			Buffer.from(JSON.stringify(message)),
			keys,
			this.subject(),
			TTL_SECONDS,
			this.transport ?? undefined,
		)
		if (outcome === 'gone') {
			await this.database.transaction((tx) =>
				tx.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, target.endpoint)),
			)
		} else if (outcome === 'failed') {
			this.ctx.logger.warn('push service refused a message', {
				status,
				host: new URL(target.endpoint).host,
			})
		}
		return outcome === 'sent'
	}
}

function isVapidKeys(value: unknown): value is VapidKeys {
	return (
		typeof value === 'object' &&
		value !== null &&
		'publicKey' in value &&
		typeof value.publicKey === 'string' &&
		'privateKey' in value &&
		typeof value.privateKey === 'string'
	)
}
