import {
	failure,
	isEntityId,
	isNoticeKey,
	normalizePage,
	noticeDetail,
	placeholderUser,
	type ForumNotification,
	type NoticeDetail,
	type NotificationDto,
	type NotificationPageDto,
	type Principal,
	type UserDto,
} from '@pluxum/domain'
import { ForumApiPlugin } from '@pluxum/api'
import {
	answeredAuthorOf,
	ForumCorePlugin,
	type ForumResult,
	type PostAfterWriteEvent,
} from '@pluxum/core'
import { BasePlugin, Plugin } from '@pluxel/core'
import { Result } from '@pluxel/core/better-result'
import { Database, type PluginDatabaseHandle } from '@pluxel/services/database'
import { and, count, desc, eq, isNull } from 'drizzle-orm'
import { Type, type Static } from 'typebox'
import * as v from 'valibot'
import * as f from 'valibot-form'
import { notifications, NotificationsDatabase } from './database'

/** The extension's ID: UI slot contributor ID and `/api/forum/ext/:extId` segment. */
export const NOTIFICATIONS_EXT_ID = 'forum-notifications'
export const INBOX_CHANNEL_ID = 'forum-notifications.inbox'
export const NOTIFICATIONS_POST_HOOK_ID = 'forum-notifications.replies'

export const ForumNotificationsConfig = v.object({
	/** Characters of the reply kept in a reply notification. */
	excerptChars: v.optional(
		v.pipe(
			v.number(),
			v.integer(),
			v.minValue(40),
			v.maxValue(500),
			f.formMeta({
				title: '回复摘要长度',
				description: '回帖通知里保留的回复正文字数。只影响之后产生的通知。',
			}),
			f.numberMeta({ step: 20 }),
		),
		160,
	),
})
export type ForumNotificationsConfig = v.InferOutput<typeof ForumNotificationsConfig>

export const NotificationActor = Type.Object({
	id: Type.String(),
	handle: Type.String(),
	displayName: Type.String(),
	ext: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})
export type NotificationActor = Static<typeof NotificationActor>

export const NotificationItem = Type.Object({
	id: Type.String(),
	recipientId: Type.String(),
	kind: Type.String(),
	title: Type.String(),
	titleKey: Type.Union([Type.String(), Type.Null()]),
	titleParams: Type.Union([
		Type.Record(Type.String(), Type.Union([Type.String(), Type.Number()])),
		Type.Null(),
	]),
	body: Type.Union([Type.String(), Type.Null()]),
	path: Type.Union([Type.String(), Type.Null()]),
	threadId: Type.Union([Type.String(), Type.Null()]),
	postId: Type.Union([Type.String(), Type.Null()]),
	actor: Type.Union([NotificationActor, Type.Null()]),
	read: Type.Boolean(),
	readAt: Type.Union([Type.String(), Type.Null()]),
	createdAt: Type.String(),
})
export type NotificationItem = Static<typeof NotificationItem>

export const NotificationListResult = Type.Object({
	items: Type.Array(NotificationItem),
	page: Type.Integer({ minimum: 1 }),
	pageSize: Type.Integer({ minimum: 1 }),
	total: Type.Integer({ minimum: 0 }),
	unreadCount: Type.Integer({ minimum: 0 }),
})
export type NotificationListResult = Static<typeof NotificationListResult>

export const UnreadCountResult = Type.Object({
	count: Type.Integer({ minimum: 0 }),
})
export type UnreadCountResult = Static<typeof UnreadCountResult>

export const MarkReadResult = Type.Object({
	id: Type.String(),
	read: Type.Literal(true),
	readAt: Type.String(),
	unreadCount: Type.Integer({ minimum: 0 }),
})
export type MarkReadResult = Static<typeof MarkReadResult>

export const MarkAllReadResult = Type.Object({
	marked: Type.Integer({ minimum: 0 }),
	unreadCount: Type.Literal(0),
})
export type MarkAllReadResult = Static<typeof MarkAllReadResult>

// Query parameters on `GET` extActions arrive as strings.
const ListNotificationsInput = Type.Object({
	page: Type.Optional(Type.String({ maxLength: 10 })),
	pageSize: Type.Optional(Type.String({ maxLength: 10 })),
	unreadOnly: Type.Optional(Type.String({ maxLength: 10 })),
})

const EmptyInput = Type.Object({})

const MarkReadInput = Type.Object({
	id: Type.String({ maxLength: 64 }),
})

function queryInt(value: string | undefined): number | undefined {
	return value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined
}

function summarizeReplyBody(raw: string, maxChars: number): string | undefined {
	const cleaned = raw.replaceAll(/\s+/gu, ' ').trim()
	if (!cleaned) return undefined
	const chars = Array.from(cleaned)
	if (chars.length <= maxChars) return cleaned
	return `${chars.slice(0, maxChars).join('')}…`
}

function optionalEntityId(value: string | undefined): string | null {
	return value !== undefined && isEntityId(value) ? value : null
}

/**
 * In-app notification inbox and reply notifier.
 *
 * Contributes:
 * - `notificationChannels` (`forum-notifications.inbox`) persisting `ForumNotification` rows;
 * - `postHooks` (`forum-notifications.replies`) emitting a notification via `core.deliverNotification`
 *   when someone replies to another user's thread;
 * - `uiSlots` (`shell.actions`) so the top-bar notification bell hides when this plugin stops;
 * - `extActions` under `/api/forum/ext/forum-notifications/{list,unread-count,mark-read,mark-all-read}`.
 */
@Plugin({ displayName: 'Forum Notifications', startTimeoutMs: 30_000 })
export class ForumNotificationsPlugin extends BasePlugin {
	private readonly config = this.configs.use(ForumNotificationsConfig)
	private database!: PluginDatabaseHandle<typeof NotificationsDatabase>

	constructor(
		private readonly core: ForumCorePlugin,
		private readonly api: ForumApiPlugin,
	) {
		super()
	}

	protected override async init(): Promise<void> {
		this.database = await this.ctx.require(Database).use(NotificationsDatabase)
		// The excerpt length is read per notification, so a new value applies as is.
		this.configs.onUpdate(this.config, () => {})

		this.ctx.effects.defer(
			this.core.registerPaletteCommands({
				id: 'forum-notifications',
				commands: [
					{
						id: 'inbox',
						label: '通知',
						keywords: ['消息', 'inbox'],
						href: '/notifications',
						minRole: 'member',
					},
				],
			}),
		)
		this.ctx.effects.defer(
			this.core.registerNotificationChannel({
				id: INBOX_CHANNEL_ID,
				deliver: (notification) => this.persistNotification(notification),
			}),
		)
		this.ctx.effects.defer(
			this.core.registerPostHook({
				id: NOTIFICATIONS_POST_HOOK_ID,
				afterWrite: (event) => this.onPostAfterWrite(event),
			}),
		)
		this.ctx.effects.defer(
			this.core.registerUiSlots({
				id: NOTIFICATIONS_EXT_ID,
				slots: ['shell.actions'],
			}),
		)
		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: NOTIFICATIONS_EXT_ID,
				action: 'list',
				method: 'GET',
				login: true,
				input: ListNotificationsInput,
				output: NotificationListResult,
				handle: ({ principal, input }) =>
					this.list(principal, {
						page: queryInt(input.page),
						pageSize: queryInt(input.pageSize),
						unreadOnly: input.unreadOnly === 'true' || input.unreadOnly === '1',
					}),
			}),
		)
		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: NOTIFICATIONS_EXT_ID,
				action: 'unread-count',
				method: 'GET',
				login: true,
				input: EmptyInput,
				output: UnreadCountResult,
				handle: ({ principal }) => this.unreadCount(principal),
			}),
		)
		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: NOTIFICATIONS_EXT_ID,
				action: 'mark-read',
				method: 'POST',
				login: true,
				input: MarkReadInput,
				output: MarkReadResult,
				handle: ({ principal, input }) => this.markRead(principal, input.id),
			}),
		)
		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: NOTIFICATIONS_EXT_ID,
				action: 'mark-all-read',
				method: 'POST',
				login: true,
				input: EmptyInput,
				output: MarkAllReadResult,
				handle: ({ principal }) => this.markAllRead(principal),
			}),
		)
	}

	/**
	 * Persists a delivered notification into the in-app inbox. Idempotent on `notification.id` so
	 * duplicate deliveries are harmless.
	 */
	async persistNotification(notification: ForumNotification): Promise<void> {
		if (!isEntityId(notification.recipientId)) {
			throw new TypeError('Invalid notification recipientId')
		}
		const id = isEntityId(notification.id) ? notification.id : crypto.randomUUID()
		const parsedTime = Date.parse(notification.createdAt)
		const createdAt = Number.isNaN(parsedTime) ? new Date() : new Date(parsedTime)
		await this.database.transaction((tx) =>
			tx
				.insert(notifications)
				.values({
					id,
					recipientId: notification.recipientId,
					kind: notification.kind,
					title: notification.title,
					titleKey: notification.titleKey ?? null,
					titleParams: notification.titleParams ?? null,
					body: notification.body ?? null,
					path: notification.path ?? null,
					threadId: optionalEntityId(notification.threadId),
					postId: optionalEntityId(notification.postId),
					actorId: optionalEntityId(notification.actor?.id),
					createdAt,
				})
				.onConflictDoNothing({ target: notifications.id }),
		)
	}

	private async onPostAfterWrite(event: PostAfterWriteEvent): Promise<void> {
		if (event.kind !== 'post.created') return
		const recipientId = answeredAuthorOf(event)
		if (recipientId === event.authorId) return
		if (!isEntityId(recipientId)) return

		const actorResult = await this.core.getUser(event.authorId)
		const actor: UserDto = actorResult.isOk()
			? actorResult.value
			: placeholderUser(event.authorId, 'member')
		const excerpt = summarizeReplyBody(event.body, this.config.excerptChars)
		const notification: ForumNotification = {
			id: isEntityId(event.postId) ? event.postId : crypto.randomUUID(),
			recipientId,
			kind: event.parentId === null ? 'thread.reply' : 'post.reply',
			...noticeFields(replyNotice(actor.displayName, event)),
			...(excerpt === undefined ? {} : { body: excerpt }),
			path: `/t/${event.threadRef}/${event.postNumber}`,
			threadId: event.threadId,
			postId: event.postId,
			actor,
			createdAt: event.createdAt,
		}
		await this.core.deliverNotification(notification)
	}

	/** Lists a page of notifications for the signed-in principal together with their unread count. */
	async list(
		principal: Principal,
		options: { page?: number; pageSize?: number; unreadOnly?: boolean } = {},
	): Promise<ForumResult<NotificationPageDto>> {
		const userId = principal.userId
		if (userId === null) return Result.err(failure('unauthenticated', 'auth.required'))
		const { page, pageSize } = normalizePage(options)
		const filter = options.unreadOnly
			? and(eq(notifications.recipientId, userId), isNull(notifications.readAt))
			: eq(notifications.recipientId, userId)
		const unreadFilter = and(eq(notifications.recipientId, userId), isNull(notifications.readAt))

		const { rows, total, unread } = await this.database.read(async (db) => {
			const [totalRow] = await db.select({ value: count() }).from(notifications).where(filter)
			const [unreadRow] = await db
				.select({ value: count() })
				.from(notifications)
				.where(unreadFilter)
			const pageRows = await db
				.select()
				.from(notifications)
				.where(filter)
				.orderBy(desc(notifications.createdAt), desc(notifications.id))
				.limit(pageSize)
				.offset((page - 1) * pageSize)
			return {
				rows: pageRows,
				total: totalRow?.value ?? 0,
				unread: unreadRow?.value ?? 0,
			}
		})

		const actorIds = [
			...new Set(
				rows
					.map((row) => row.actorId)
					.filter((actorId): actorId is string => actorId !== null && isEntityId(actorId)),
			),
		]
		const actorsById = new Map<string, UserDto>()
		await Promise.all(
			actorIds.map(async (actorId) => {
				const resolved = await this.core.getUser(actorId, principal)
				actorsById.set(actorId, resolved.isOk() ? resolved.value : placeholderUser(actorId))
			}),
		)

		const items: NotificationDto[] = rows.map((row) => ({
			id: row.id,
			recipientId: row.recipientId,
			kind: row.kind,
			title: row.title,
			titleKey: isNoticeKey(row.titleKey) ? row.titleKey : null,
			titleParams: row.titleParams ?? null,
			body: row.body,
			path: row.path,
			threadId: row.threadId,
			postId: row.postId,
			actor:
				row.actorId === null ? null : (actorsById.get(row.actorId) ?? placeholderUser(row.actorId)),
			read: row.readAt !== null,
			readAt: row.readAt === null ? null : row.readAt.toISOString(),
			createdAt: row.createdAt.toISOString(),
		}))

		return Result.ok({
			items,
			page,
			pageSize,
			total,
			unreadCount: unread,
		})
	}

	/** Returns the number of unread notifications for the signed-in principal. */
	async unreadCount(principal: Principal): Promise<ForumResult<UnreadCountResult>> {
		const userId = principal.userId
		if (userId === null) return Result.err(failure('unauthenticated', 'auth.required'))
		const [row] = await this.database.read((db) =>
			db
				.select({ value: count() })
				.from(notifications)
				.where(and(eq(notifications.recipientId, userId), isNull(notifications.readAt))),
		)
		return Result.ok({ count: row?.value ?? 0 })
	}

	/**
	 * Marks one of the principal's own notifications as read. Returns `not_found` (404) when the
	 * notification does not exist or belongs to another account, leaving other accounts untouched.
	 */
	async markRead(
		principal: Principal,
		notificationId: string,
	): Promise<ForumResult<MarkReadResult>> {
		const userId = principal.userId
		if (userId === null) return Result.err(failure('unauthenticated', 'auth.required'))
		if (!isEntityId(notificationId)) {
			return Result.err(failure('not_found', 'entity.not_found', { entity: 'notification' }))
		}

		const outcome = await this.database.transaction(async (tx) => {
			const [existing] = await tx
				.select({ id: notifications.id, readAt: notifications.readAt })
				.from(notifications)
				.where(and(eq(notifications.id, notificationId), eq(notifications.recipientId, userId)))
			if (!existing) return null

			const readAt = existing.readAt ?? new Date()
			if (existing.readAt === null) {
				await tx
					.update(notifications)
					.set({ readAt })
					.where(and(eq(notifications.id, notificationId), eq(notifications.recipientId, userId)))
			}
			const [unreadRow] = await tx
				.select({ value: count() })
				.from(notifications)
				.where(and(eq(notifications.recipientId, userId), isNull(notifications.readAt)))
			return {
				id: existing.id,
				read: true as const,
				readAt: readAt.toISOString(),
				unreadCount: unreadRow?.value ?? 0,
			}
		})

		if (!outcome)
			return Result.err(failure('not_found', 'entity.not_found', { entity: 'notification' }))
		return Result.ok(outcome)
	}

	/** Marks all unread notifications of the signed-in principal as read. */
	async markAllRead(principal: Principal): Promise<ForumResult<MarkAllReadResult>> {
		const userId = principal.userId
		if (userId === null) return Result.err(failure('unauthenticated', 'auth.required'))
		const now = new Date()
		const updated = await this.database.transaction((tx) =>
			tx
				.update(notifications)
				.set({ readAt: now })
				.where(and(eq(notifications.recipientId, userId), isNull(notifications.readAt)))
				.returning({ id: notifications.id }),
		)
		return Result.ok({ marked: updated.length, unreadCount: 0 })
	}
}

/** The fields of a notification that say its title: the Chinese text, and the key and params behind it. */
function noticeFields(
	detail: NoticeDetail,
): Pick<ForumNotification, 'title' | 'titleKey' | 'titleParams'> {
	return { title: detail.title, titleKey: detail.key, titleParams: detail.params }
}

/** The title of a reply notice: the one who answered, and where (the reader's own thread or a floor in it). */
function replyNotice(
	actor: string,
	event: Extract<PostAfterWriteEvent, { kind: 'post.created' }>,
): NoticeDetail {
	const note = event.threadKind === 'note'
	if (event.parentId !== null) {
		return note
			? noticeDetail('notice.reply.in_note', { actor })
			: noticeDetail('notice.reply.in_topic', { actor, title: event.threadTitle })
	}
	return note
		? noticeDetail('notice.reply.note', { actor })
		: noticeDetail('notice.reply.topic', { actor, title: event.threadTitle })
}
