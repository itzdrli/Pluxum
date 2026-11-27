import { createHash } from 'node:crypto'
import {
	errorDetail,
	failure,
	isEntityId,
	noticeDetail,
	placeholderUser,
	type Principal,
	type UserDto,
} from '@pluxum/domain'
import { ForumApiPlugin } from '@pluxum/api'
import { ForumCorePlugin, type ForumResult } from '@pluxum/core'
import { BasePlugin, Plugin } from '@pluxel/core'
import { Result } from '@pluxel/core/better-result'
import { Pg, type PluginDatabaseHandle } from '@pluxel/services/pg'
import { and, asc, count, desc, eq, gt, inArray, lt, max, ne, sql } from 'drizzle-orm'
import { Type, type Static } from 'typebox'
import { conversations, members, messages, MessagesDatabase, messageSettings } from './database'
import { MessageHub, Presence, RateWindow } from './hub'

export { MessageHub, Presence, RateWindow } from './hub'

/** The extension's ID: its segment of the ext ingress and its UI slot key. */
export const MESSAGES_EXT_ID = 'forum-messages'

export const MESSAGE_BODY_MAX = 2000
export const GROUP_MEMBERS_MAX = 20
export const GROUP_TITLE_MAX = 40
/** Messages per page of a conversation. */
export const MESSAGE_PAGE = 50
/** Conversations the list shows, newest activity first. */
export const CONVERSATION_LIST_MAX = 100
/** The longest a poll waits for the next message, in seconds. */
export const POLL_WAIT_MAX = 25

const UserRef = Type.Object({
	id: Type.String(),
	handle: Type.String(),
	displayName: Type.String(),
	ext: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})
type UserRef = Static<typeof UserRef>

export const MessageDto = Type.Object({
	id: Type.String(),
	seq: Type.Integer(),
	conversationId: Type.String(),
	author: UserRef,
	body: Type.String(),
	createdAt: Type.String(),
})
export type MessageDto = Static<typeof MessageDto>

export const ConversationDto = Type.Object({
	id: Type.String(),
	kind: Type.Union([Type.Literal('direct'), Type.Literal('group')]),
	/** A group's name; empty for a direct conversation (clients show the other person). */
	title: Type.String(),
	ownerId: Type.String(),
	members: Type.Array(UserRef),
	lastMessage: Type.Union([MessageDto, Type.Null()]),
	/** Messages from others the viewer has not seen. */
	unread: Type.Integer({ minimum: 0 }),
	/** The newest message's time, or when the conversation started. */
	updatedAt: Type.String(),
})
export type ConversationDto = Static<typeof ConversationDto>

const ConversationList = Type.Object({
	items: Type.Array(ConversationDto),
	unread: Type.Integer({ minimum: 0 }),
})
const ConversationDetail = Type.Object({
	conversation: ConversationDto,
	/** Oldest first. */
	messages: Type.Array(MessageDto),
	hasMore: Type.Boolean(),
})
const PollResult = Type.Object({
	/** The newest `seq` the viewer can see: the next poll's `since`. */
	seq: Type.Integer(),
	/** New messages of the conversation the viewer has open, oldest first. */
	messages: Type.Array(MessageDto),
	/** Whether anything arrived in any conversation since `since`. */
	changed: Type.Boolean(),
	unread: Type.Integer({ minimum: 0 }),
})
type PollResult = Static<typeof PollResult>

const Allow = Type.Union([
	Type.Literal('everyone'),
	Type.Literal('following'),
	Type.Literal('nobody'),
])
export type Allow = Static<typeof Allow>
const MessageSettings = Type.Object({ allow: Allow })

const Id = Type.String({ maxLength: 64 })
const Seq = Type.Integer({ minimum: 0 })
/** A sequence number in a query string. */
const SeqQuery = Type.String({ pattern: '^[0-9]{1,15}$' })
const Started = Type.Object({ id: Type.String() })

/** A UUID (version 8, name-based) for the notice of one unread streak in one conversation. */
export function messageNoticeId(
	conversationId: string,
	recipientId: string,
	readSeq: number,
): string {
	const hex = createHash('sha256')
		.update(`message:${conversationId}:${recipientId}:${readSeq}`)
		.digest('hex')
	const variant = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16)
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function directKeyOf(a: string, b: string): string {
	return a < b ? `${a}:${b}` : `${b}:${a}`
}

function isStaff(principal: Principal): boolean {
	return principal.roles.includes('moderator') || principal.roles.includes('admin')
}

const userRef = (user: UserDto): UserRef => ({
	id: user.id,
	handle: user.handle,
	displayName: user.displayName,
	...(user.ext === undefined ? {} : { ext: user.ext }),
})

type MessageRow = Readonly<{
	id: string
	seq: number
	conversationId: string
	authorId: string
	body: string
	createdAt: Date
}>

const messageColumns = {
	id: messages.id,
	seq: messages.seq,
	conversationId: messages.conversationId,
	authorId: messages.authorId,
	body: messages.body,
	createdAt: messages.createdAt,
}

/**
 * Private messages: conversations between two members, and small groups (up to
 * `GROUP_MEMBERS_MAX` people) with a name and an owner. An open conversation updates live through
 * a long poll; a member who is not looking at a conversation gets one notice per unread streak
 * (in the inbox, by mail and push, as their settings say). Each member chooses who may start a
 * conversation with them: everyone, people they follow, or nobody (moderators always may).
 * Contributes:
 * - `extActions` under `/api/forum/ext/forum-messages`: `list`, `get`, `poll`, `start`, `group`,
 *   `send`, `read`, `leave`, `members`, `rename`, `settings`, `preference`;
 * - `uiSlots`: the inbox button in `shell.actions`, 「私信」 in `user.header` and the setting in
 *   `user.profile.tabs`.
 *
 * Stopping it hides messaging; the conversations stay stored and return with it.
 */
// PGlite compiles its WASM module on first use, which can exceed the default start timeout.
@Plugin({ displayName: 'Pluxum Messages', startTimeoutMs: 30_000 })
export class ForumMessagesPlugin extends BasePlugin {
	private database!: PluginDatabaseHandle<typeof MessagesDatabase>
	private readonly hub = new MessageHub(5000)
	private readonly presence = new Presence()
	private readonly sendRate = new RateWindow(30, 60_000)
	private readonly startRate = new RateWindow(20, 3600_000)

	constructor(
		private readonly core: ForumCorePlugin,
		private readonly api: ForumApiPlugin,
	) {
		super()
	}

	protected override async init(): Promise<void> {
		this.database = await this.ctx.service(Pg).use(MessagesDatabase)
		this.ctx.effects.defer(() => this.hub.close())
		this.ctx.effects.defer(
			this.core.registerUserRemoval({
				id: `${MESSAGES_EXT_ID}.removal`,
				remove: ({ userId, ghostId }) => this.removeUser(userId, ghostId),
			}),
		)
		this.ctx.effects.defer(
			this.core.registerUiSlots({
				id: MESSAGES_EXT_ID,
				slots: ['shell.actions', 'user.header', 'user.profile.tabs'],
			}),
		)
		const action = this.api.registerExtAction.bind(this.api)
		const extId = MESSAGES_EXT_ID
		this.ctx.effects.defer(
			action({
				extId,
				action: 'list',
				method: 'GET',
				login: true,
				input: Type.Object({}),
				output: ConversationList,
				handle: ({ principal }) => this.list(principal),
			}),
		)
		this.ctx.effects.defer(
			action({
				extId,
				action: 'get',
				method: 'GET',
				login: true,
				input: Type.Object({ id: Id, before: Type.Optional(SeqQuery) }),
				output: ConversationDetail,
				handle: ({ principal, input }) =>
					this.get(
						principal,
						input.id,
						input.before === undefined ? undefined : Number(input.before),
					),
			}),
		)
		this.ctx.effects.defer(
			action({
				extId,
				action: 'poll',
				method: 'GET',
				login: true,
				input: Type.Object({
					since: SeqQuery,
					conversation: Type.Optional(Id),
					wait: Type.Optional(Type.String({ pattern: '^[0-9]{1,2}$' })),
				}),
				output: PollResult,
				handle: ({ principal, input }) =>
					this.poll(
						principal,
						Number(input.since),
						input.conversation,
						Math.min(POLL_WAIT_MAX, Number(input.wait ?? 0)),
					),
			}),
		)
		this.ctx.effects.defer(
			action({
				extId,
				action: 'start',
				method: 'POST',
				login: true,
				input: Type.Object({ userId: Id }),
				output: Started,
				handle: ({ principal, input }) => this.start(principal, input.userId),
			}),
		)
		this.ctx.effects.defer(
			action({
				extId,
				action: 'group',
				method: 'POST',
				login: true,
				input: Type.Object({
					title: Type.String({ maxLength: 200 }),
					memberIds: Type.Array(Id, { maxItems: GROUP_MEMBERS_MAX * 2 }),
				}),
				output: Started,
				handle: ({ principal, input }) => this.group(principal, input.title, input.memberIds),
			}),
		)
		this.ctx.effects.defer(
			action({
				extId,
				action: 'send',
				method: 'POST',
				login: true,
				input: Type.Object({
					conversationId: Id,
					body: Type.String({ maxLength: MESSAGE_BODY_MAX * 2 }),
				}),
				output: MessageDto,
				handle: ({ principal, input }) => this.send(principal, input.conversationId, input.body),
			}),
		)
		this.ctx.effects.defer(
			action({
				extId,
				action: 'read',
				method: 'POST',
				login: true,
				input: Type.Object({ conversationId: Id, seq: Seq }),
				output: Type.Object({ unread: Type.Integer({ minimum: 0 }) }),
				handle: ({ principal, input }) => this.read(principal, input.conversationId, input.seq),
			}),
		)
		this.ctx.effects.defer(
			action({
				extId,
				action: 'leave',
				method: 'POST',
				login: true,
				input: Type.Object({ conversationId: Id }),
				output: Type.Object({ left: Type.Boolean() }),
				handle: ({ principal, input }) => this.leave(principal, input.conversationId),
			}),
		)
		this.ctx.effects.defer(
			action({
				extId,
				action: 'members',
				method: 'POST',
				login: true,
				input: Type.Object({
					conversationId: Id,
					add: Type.Optional(Type.Array(Id, { maxItems: GROUP_MEMBERS_MAX })),
					remove: Type.Optional(Type.Array(Id, { maxItems: GROUP_MEMBERS_MAX })),
				}),
				output: ConversationDto,
				handle: ({ principal, input }) =>
					this.changeMembers(principal, input.conversationId, input.add ?? [], input.remove ?? []),
			}),
		)
		this.ctx.effects.defer(
			action({
				extId,
				action: 'rename',
				method: 'POST',
				login: true,
				input: Type.Object({ conversationId: Id, title: Type.String({ maxLength: 200 }) }),
				output: ConversationDto,
				handle: ({ principal, input }) => this.rename(principal, input.conversationId, input.title),
			}),
		)
		this.ctx.effects.defer(
			action({
				extId,
				action: 'settings',
				method: 'GET',
				login: true,
				input: Type.Object({}),
				output: MessageSettings,
				handle: async ({ principal }) =>
					Result.ok({ allow: await this.allowOf(principal.userId ?? '') }),
			}),
		)
		this.ctx.effects.defer(
			action({
				extId,
				action: 'preference',
				method: 'POST',
				login: true,
				input: MessageSettings,
				output: MessageSettings,
				handle: ({ principal, input }) => this.setAllow(principal, input.allow),
			}),
		)
	}

	// ── Reading ────────────────────────────────────────────────────────────

	/** The viewer's conversations, newest activity first, and their unread total. */
	async list(principal: Principal): Promise<ForumResult<Static<typeof ConversationList>>> {
		const userId = principal.userId
		if (userId === null) return Result.err(failure('unauthenticated', 'auth.required'))
		const rows = await this.database.read((db) =>
			db
				.select({ conversation: conversations })
				.from(members)
				.innerJoin(conversations, eq(conversations.id, members.conversationId))
				.where(eq(members.userId, userId))
				.orderBy(desc(conversations.lastSeq), desc(conversations.createdAt))
				.limit(CONVERSATION_LIST_MAX),
		)
		const items = await this.describe(
			userId,
			rows.map((row) => row.conversation),
		)
		return Result.ok({ items, unread: await this.unreadTotal(userId) })
	}

	/** One conversation and a page of its messages (the newest, or those before `before`). */
	async get(
		principal: Principal,
		conversationId: string,
		before?: number,
	): Promise<ForumResult<Static<typeof ConversationDetail>>> {
		const found = await this.membership(principal, conversationId)
		if (found.isErr()) return Result.err(found.error)
		const { userId, conversation } = found.value
		const page = await this.database.read((db) =>
			db
				.select(messageColumns)
				.from(messages)
				.where(
					and(
						eq(messages.conversationId, conversation.id),
						before === undefined ? undefined : lt(messages.seq, before),
					),
				)
				.orderBy(desc(messages.seq))
				.limit(MESSAGE_PAGE + 1),
		)
		const hasMore = page.length > MESSAGE_PAGE
		const shown = page.slice(0, MESSAGE_PAGE).toReversed()
		const [described] = await this.describe(userId, [conversation])
		if (described === undefined)
			return Result.err(failure('not_found', 'entity.not_found', { entity: 'conversation' }))
		return Result.ok({
			conversation: described,
			messages: await this.messageDtos(shown),
			hasMore,
		})
	}

	/**
	 * Answers at once when anything newer than `since` reached the viewer, else waits up to `wait`
	 * seconds for it. While waiting with a conversation open, the viewer counts as reading it, so
	 * its messages send them no notice.
	 */
	async poll(
		principal: Principal,
		since: number,
		conversationId: string | undefined,
		wait: number,
	): Promise<ForumResult<PollResult>> {
		const userId = principal.userId
		if (userId === null) return Result.err(failure('unauthenticated', 'auth.required'))
		const open =
			conversationId !== undefined &&
			isEntityId(conversationId) &&
			(await this.isMember(userId, conversationId))
				? conversationId
				: undefined
		let latest = await this.latestSeq(userId)
		if (latest <= since && wait > 0) {
			this.presence.see(userId, open, Date.now() + (wait + 10) * 1000)
			await this.hub.wait(userId, wait * 1000)
			// The next poll follows right away; keep counting the viewer as present until then.
			this.presence.see(userId, open, Date.now() + 10_000)
			latest = await this.latestSeq(userId)
		} else {
			this.presence.see(userId, open, Date.now() + 10_000)
		}
		const fresh =
			open === undefined || latest <= since
				? []
				: await this.database.read((db) =>
						db
							.select(messageColumns)
							.from(messages)
							.where(and(eq(messages.conversationId, open), gt(messages.seq, since)))
							.orderBy(asc(messages.seq))
							.limit(MESSAGE_PAGE * 2),
					)
		return Result.ok({
			seq: Math.max(latest, since),
			messages: await this.messageDtos(fresh),
			changed: latest > since,
			unread: await this.unreadTotal(userId),
		})
	}

	// ── Starting and writing ───────────────────────────────────────────────

	/** The direct conversation with a member, made when there is none yet. */
	async start(
		principal: Principal,
		targetRef: string,
	): Promise<ForumResult<Static<typeof Started>>> {
		const writer = this.writer(principal)
		if (writer.isErr()) return Result.err(writer.error)
		const userId = writer.value
		const target = await this.core.getUser(targetRef, principal)
		if (target.isErr()) return Result.err(target.error)
		const targetId = target.value.id
		const key = directKeyOf(userId, targetId)
		const [existing] = await this.database.read((db) =>
			db
				.select({ id: conversations.id })
				.from(conversations)
				.where(eq(conversations.directKey, key)),
		)
		if (existing !== undefined) return Result.ok({ id: existing.id })
		const allowed = await this.mayReach(principal, targetId)
		if (allowed.isErr()) return Result.err(allowed.error)
		const limited = this.limited(this.startRate, userId)
		if (limited) return Result.err(limited)
		const id = await this.database.transaction(async (tx) => {
			const [made] = await tx
				.insert(conversations)
				.values({ kind: 'direct', ownerId: userId, directKey: key })
				.onConflictDoNothing({ target: conversations.directKey })
				.returning({ id: conversations.id })
			if (made === undefined) {
				// Both started it at once: the other one won.
				const [won] = await tx
					.select({ id: conversations.id })
					.from(conversations)
					.where(eq(conversations.directKey, key))
				return won?.id ?? ''
			}
			await tx.insert(members).values([
				{ conversationId: made.id, userId },
				{ conversationId: made.id, userId: targetId },
			])
			return made.id
		})
		return Result.ok({ id })
	}

	/** A new group with the viewer as owner. */
	async group(
		principal: Principal,
		rawTitle: string,
		memberRefs: readonly string[],
	): Promise<ForumResult<Static<typeof Started>>> {
		const writer = this.writer(principal)
		if (writer.isErr()) return Result.err(writer.error)
		const userId = writer.value
		const title = rawTitle.trim()
		if (Array.from(title).length > GROUP_TITLE_MAX) {
			return Result.err(
				failure('invalid', 'field.too_long', { field: 'title', max: GROUP_TITLE_MAX }),
			)
		}
		const others = await this.reachable(principal, memberRefs)
		if (others.isErr()) return Result.err(others.error)
		if (others.value.length === 0) return Result.err(failure('invalid', 'request.invalid'))
		if (others.value.length + 1 > GROUP_MEMBERS_MAX) {
			return Result.err(failure('invalid', 'messages.members_max', { max: GROUP_MEMBERS_MAX }))
		}
		const limited = this.limited(this.startRate, userId)
		if (limited) return Result.err(limited)
		const id = await this.database.transaction(async (tx) => {
			const [made] = await tx
				.insert(conversations)
				.values({ kind: 'group', title, ownerId: userId })
				.returning({ id: conversations.id })
			if (made === undefined) throw new Error('Conversation insert returned no row')
			await tx.insert(members).values(
				[userId, ...others.value].map((memberId) => ({
					conversationId: made.id,
					userId: memberId,
				})),
			)
			return made.id
		})
		return Result.ok({ id })
	}

	async send(
		principal: Principal,
		conversationId: string,
		rawBody: string,
	): Promise<ForumResult<MessageDto>> {
		const body = rawBody.trim()
		if (body === '') return Result.err(failure('invalid', 'field.empty', { field: 'content' }))
		if (Array.from(body).length > MESSAGE_BODY_MAX) {
			return Result.err(
				failure('invalid', 'field.too_long', { field: 'content', max: MESSAGE_BODY_MAX }),
			)
		}
		const writer = this.writer(principal)
		if (writer.isErr()) return Result.err(writer.error)
		const found = await this.membership(principal, conversationId)
		if (found.isErr()) return Result.err(found.error)
		const { userId, conversation } = found.value
		const memberRows = await this.database.read((db) =>
			db
				.select({ userId: members.userId, lastReadSeq: members.lastReadSeq })
				.from(members)
				.where(eq(members.conversationId, conversation.id)),
		)
		// Someone who closed their messages is not written to, even in a conversation from before.
		if (conversation.kind === 'direct') {
			const other = memberRows.find((row) => row.userId !== userId)
			if (other !== undefined) {
				const allowed = await this.mayReach(principal, other.userId)
				if (allowed.isErr()) return Result.err(allowed.error)
			}
		}
		const limited = this.limited(this.sendRate, userId)
		if (limited) return Result.err(limited)
		const row = await this.database.transaction(async (tx) => {
			const [written] = await tx
				.insert(messages)
				.values({ conversationId: conversation.id, authorId: userId, body })
				.returning(messageColumns)
			if (written === undefined) throw new Error('Message insert returned no row')
			await tx
				.update(conversations)
				.set({ lastSeq: written.seq })
				.where(eq(conversations.id, conversation.id))
			await tx
				.update(members)
				.set({ lastReadSeq: written.seq })
				.where(and(eq(members.conversationId, conversation.id), eq(members.userId, userId)))
			return written
		})
		this.hub.publish(memberRows.map((member) => member.userId))
		const [dto] = await this.messageDtos([row])
		if (dto === undefined) throw new Error('Message lost its author')
		await this.notify(row, dto.author, memberRows)
		return Result.ok(dto)
	}

	/** Marks a conversation seen up to `seq`; returns the viewer's unread total. */
	async read(
		principal: Principal,
		conversationId: string,
		seq: number,
	): Promise<ForumResult<Readonly<{ unread: number }>>> {
		const found = await this.membership(principal, conversationId)
		if (found.isErr()) return Result.err(found.error)
		const { userId, conversation } = found.value
		const upTo = Math.min(seq, conversation.lastSeq)
		await this.database.transaction((tx) =>
			tx
				.update(members)
				.set({ lastReadSeq: sql`greatest(${members.lastReadSeq}, ${upTo})` })
				.where(and(eq(members.conversationId, conversation.id), eq(members.userId, userId))),
		)
		return Result.ok({ unread: await this.unreadTotal(userId) })
	}

	// ── Groups ─────────────────────────────────────────────────────────────

	/** Leaves a group; the owner's role passes to the longest member, and an empty group goes. */
	async leave(
		principal: Principal,
		conversationId: string,
	): Promise<ForumResult<Readonly<{ left: boolean }>>> {
		const found = await this.membership(principal, conversationId)
		if (found.isErr()) return Result.err(found.error)
		const { userId, conversation } = found.value
		if (conversation.kind !== 'group') return Result.err(failure('invalid', 'request.invalid'))
		await this.database.transaction(async (tx) => {
			await tx
				.delete(members)
				.where(and(eq(members.conversationId, conversation.id), eq(members.userId, userId)))
			await this.settleGroup(tx, conversation.id, userId)
		})
		return Result.ok({ left: true })
	}

	/** The owner adds or removes people of a group. */
	async changeMembers(
		principal: Principal,
		conversationId: string,
		addRefs: readonly string[],
		removeIds: readonly string[],
	): Promise<ForumResult<ConversationDto>> {
		const found = await this.ownedGroup(principal, conversationId)
		if (found.isErr()) return Result.err(found.error)
		const { userId, conversation } = found.value
		const current = await this.memberIds(conversation.id)
		const added = await this.reachable(principal, addRefs)
		if (added.isErr()) return Result.err(added.error)
		const joining = added.value.filter((id) => !current.includes(id))
		const leaving = removeIds.filter((id) => id !== userId && current.includes(id))
		if (current.length - leaving.length + joining.length > GROUP_MEMBERS_MAX) {
			return Result.err(failure('invalid', 'messages.members_max', { max: GROUP_MEMBERS_MAX }))
		}
		await this.database.transaction(async (tx) => {
			if (leaving.length > 0) {
				await tx
					.delete(members)
					.where(and(eq(members.conversationId, conversation.id), inArray(members.userId, leaving)))
			}
			if (joining.length > 0) {
				// Newcomers see the history but start with nothing unread.
				await tx.insert(members).values(
					joining.map((memberId) => ({
						conversationId: conversation.id,
						userId: memberId,
						lastReadSeq: conversation.lastSeq,
					})),
				)
			}
		})
		const [described] = await this.describe(userId, [conversation])
		if (described === undefined) throw new Error('Group vanished while changing members')
		return Result.ok(described)
	}

	async rename(
		principal: Principal,
		conversationId: string,
		rawTitle: string,
	): Promise<ForumResult<ConversationDto>> {
		const found = await this.ownedGroup(principal, conversationId)
		if (found.isErr()) return Result.err(found.error)
		const { userId, conversation } = found.value
		const title = rawTitle.trim()
		if (Array.from(title).length > GROUP_TITLE_MAX) {
			return Result.err(
				failure('invalid', 'field.too_long', { field: 'title', max: GROUP_TITLE_MAX }),
			)
		}
		await this.database.transaction((tx) =>
			tx.update(conversations).set({ title }).where(eq(conversations.id, conversation.id)),
		)
		const [described] = await this.describe(userId, [{ ...conversation, title }])
		if (described === undefined) throw new Error('Group vanished while renaming')
		return Result.ok(described)
	}

	// ── Settings ───────────────────────────────────────────────────────────

	async allowOf(userId: string): Promise<Allow> {
		if (!isEntityId(userId)) return 'everyone'
		const [row] = await this.database.read((db) =>
			db
				.select({ allow: messageSettings.allow })
				.from(messageSettings)
				.where(eq(messageSettings.userId, userId)),
		)
		return row?.allow ?? 'everyone'
	}

	async setAllow(
		principal: Principal,
		allow: Allow,
	): Promise<ForumResult<Static<typeof MessageSettings>>> {
		const userId = principal.userId
		if (userId === null) return Result.err(failure('unauthenticated', 'auth.required'))
		await this.database.transaction((tx) =>
			tx
				.insert(messageSettings)
				.values({ userId, allow })
				.onConflictDoUpdate({
					target: messageSettings.userId,
					set: { allow, updatedAt: new Date() },
				}),
		)
		return Result.ok({ allow })
	}

	// ── Helpers ────────────────────────────────────────────────────────────

	/** The signed-in member, when they may write at all (a ban stops messages too). */
	private writer(principal: Principal): ForumResult<string> {
		if (principal.userId === null) return Result.err(failure('unauthenticated', 'auth.required'))
		if (!this.core.can(principal, 'post.create'))
			return Result.err(failure('forbidden', 'ban.cannot_post'))
		return Result.ok(principal.userId)
	}

	private limited(window: RateWindow, userId: string) {
		const seconds = window.take(userId)
		if (seconds === 0) return null
		const detail = errorDetail('rate.limited', { bucket: 'messages', seconds })
		return {
			code: 'rate_limited' as const,
			message: detail.message,
			key: detail.key,
			params: detail.params,
		}
	}

	/** Whether the viewer may start talking to `targetId`, as the target's setting says. */
	private async mayReach(principal: Principal, targetId: string): Promise<ForumResult<void>> {
		if (targetId === principal.userId) return Result.err(failure('invalid', 'messages.self'))
		if (targetId === (await this.core.findGhostId()))
			return Result.err(failure('forbidden', 'permission.denied'))
		if (isStaff(principal)) return Result.ok(undefined)
		const allow = await this.allowOf(targetId)
		if (allow === 'nobody') return Result.err(failure('forbidden', 'messages.closed'))
		if (allow === 'following') {
			const follows = await this.core.followsUser(targetId, principal.userId ?? '')
			// Without a follow plugin there is no one to follow: the setting cannot be met, so it lapses.
			if (follows === false) return Result.err(failure('forbidden', 'messages.closed'))
		}
		return Result.ok(undefined)
	}

	/** The members `refs` name (ID or handle), each of whom the viewer may reach; without the viewer. */
	private async reachable(
		principal: Principal,
		refs: readonly string[],
	): Promise<ForumResult<string[]>> {
		const ids: string[] = []
		for (const ref of new Set(refs)) {
			// oxlint-disable-next-line no-await-in-loop -- a group is at most twenty people.
			const user = await this.core.getUser(ref, principal)
			if (user.isErr()) return Result.err(user.error)
			if (user.value.id === principal.userId || ids.includes(user.value.id)) continue
			// oxlint-disable-next-line no-await-in-loop -- see above.
			const allowed = await this.mayReach(principal, user.value.id)
			if (allowed.isErr()) return Result.err(allowed.error)
			ids.push(user.value.id)
		}
		return Result.ok(ids)
	}

	private async isMember(userId: string, conversationId: string): Promise<boolean> {
		const [row] = await this.database.read((db) =>
			db
				.select({ id: members.userId })
				.from(members)
				.where(and(eq(members.conversationId, conversationId), eq(members.userId, userId))),
		)
		return row !== undefined
	}

	private async membership(principal: Principal, conversationId: string) {
		const userId = principal.userId
		if (userId === null) return Result.err(failure('unauthenticated', 'auth.required'))
		const missing = Result.err(failure('not_found', 'entity.not_found', { entity: 'conversation' }))
		if (!isEntityId(conversationId)) return missing
		const [row] = await this.database.read((db) =>
			db
				.select({ conversation: conversations })
				.from(members)
				.innerJoin(conversations, eq(conversations.id, members.conversationId))
				.where(and(eq(members.conversationId, conversationId), eq(members.userId, userId))),
		)
		return row === undefined ? missing : Result.ok({ userId, conversation: row.conversation })
	}

	private async ownedGroup(principal: Principal, conversationId: string) {
		const found = await this.membership(principal, conversationId)
		if (found.isErr()) return found
		const { conversation } = found.value
		if (conversation.kind !== 'group' || conversation.ownerId !== found.value.userId) {
			return Result.err(failure('forbidden', 'permission.denied'))
		}
		return found
	}

	private async memberIds(conversationId: string): Promise<string[]> {
		const rows = await this.database.read((db) =>
			db
				.select({ userId: members.userId })
				.from(members)
				.where(eq(members.conversationId, conversationId)),
		)
		return rows.map((row) => row.userId)
	}

	/** After someone left a group: hand ownership on, or remove the group once it is empty. */
	private async settleGroup(
		tx: Parameters<Parameters<PluginDatabaseHandle<typeof MessagesDatabase>['transaction']>[0]>[0],
		conversationId: string,
		leftId: string,
	): Promise<void> {
		const [next] = await tx
			.select({ userId: members.userId })
			.from(members)
			.where(eq(members.conversationId, conversationId))
			.orderBy(asc(members.joinedAt))
			.limit(1)
		if (next === undefined) {
			await tx.delete(messages).where(eq(messages.conversationId, conversationId))
			await tx.delete(conversations).where(eq(conversations.id, conversationId))
			return
		}
		await tx
			.update(conversations)
			.set({ ownerId: next.userId })
			.where(and(eq(conversations.id, conversationId), eq(conversations.ownerId, leftId)))
	}

	private async latestSeq(userId: string): Promise<number> {
		const [row] = await this.database.read((db) =>
			db
				.select({ value: max(conversations.lastSeq) })
				.from(members)
				.innerJoin(conversations, eq(conversations.id, members.conversationId))
				.where(eq(members.userId, userId)),
		)
		return row?.value ?? 0
	}

	private async unreadByConversation(
		userId: string,
		ids?: readonly string[],
	): Promise<Map<string, number>> {
		const rows = await this.database.read((db) =>
			db
				.select({ id: messages.conversationId, value: count() })
				.from(messages)
				.innerJoin(
					members,
					and(eq(members.conversationId, messages.conversationId), eq(members.userId, userId)),
				)
				.where(
					and(
						gt(messages.seq, members.lastReadSeq),
						ne(messages.authorId, userId),
						ids === undefined ? undefined : inArray(messages.conversationId, [...ids]),
					),
				)
				.groupBy(messages.conversationId),
		)
		return new Map(rows.map((row) => [row.id, row.value]))
	}

	private async unreadTotal(userId: string): Promise<number> {
		let total = 0
		for (const value of (await this.unreadByConversation(userId)).values()) total += value
		return total
	}

	/** Users by ID; one the core cannot find shows as a stand-in. */
	private async users(ids: Iterable<string>): Promise<Map<string, UserRef>> {
		const unique = [...new Set(ids)]
		const found = await Promise.all(unique.map((id) => this.core.getUser(id)))
		return new Map(
			unique.map((id, index) => {
				const user = found[index]
				return [id, userRef(user?.isOk() ? user.value : placeholderUser(id))]
			}),
		)
	}

	private async messageDtos(rows: readonly MessageRow[]): Promise<MessageDto[]> {
		const authors = await this.users(rows.map((row) => row.authorId))
		return rows.map((row) => ({
			id: row.id,
			seq: row.seq,
			conversationId: row.conversationId,
			author: authors.get(row.authorId) ?? userRef(placeholderUser(row.authorId)),
			body: row.body,
			createdAt: row.createdAt.toISOString(),
		}))
	}

	/** Conversations as the viewer sees them: members, newest message and unread count. */
	private async describe(
		userId: string,
		list: readonly (typeof conversations.$inferSelect)[],
	): Promise<ConversationDto[]> {
		if (list.length === 0) return []
		const ids = list.map((conversation) => conversation.id)
		const lastSeqs = list.map((conversation) => conversation.lastSeq).filter((seq) => seq > 0)
		const [memberRows, lastRows, unread] = await Promise.all([
			this.database.read((db) =>
				db
					.select({ conversationId: members.conversationId, userId: members.userId })
					.from(members)
					.where(inArray(members.conversationId, ids))
					.orderBy(asc(members.joinedAt)),
			),
			lastSeqs.length === 0
				? Promise.resolve([])
				: this.database.read((db) =>
						db.select(messageColumns).from(messages).where(inArray(messages.seq, lastSeqs)),
					),
			this.unreadByConversation(userId, ids),
		])
		const people = await this.users([
			...memberRows.map((row) => row.userId),
			...lastRows.map((row) => row.authorId),
		])
		const lastByConversation = new Map(lastRows.map((row) => [row.conversationId, row]))
		return list.map((conversation) => {
			const last = lastByConversation.get(conversation.id)
			return {
				id: conversation.id,
				kind: conversation.kind,
				title: conversation.title,
				ownerId: conversation.ownerId,
				members: memberRows
					.filter((row) => row.conversationId === conversation.id)
					.map((row) => people.get(row.userId) ?? userRef(placeholderUser(row.userId))),
				lastMessage:
					last === undefined
						? null
						: {
								id: last.id,
								seq: last.seq,
								conversationId: last.conversationId,
								author: people.get(last.authorId) ?? userRef(placeholderUser(last.authorId)),
								body: last.body,
								createdAt: last.createdAt.toISOString(),
							},
				unread: unread.get(conversation.id) ?? 0,
				updatedAt: (last?.createdAt ?? conversation.createdAt).toISOString(),
			}
		})
	}

	/**
	 * One notice per unread streak: to each other member who is not looking at the conversation
	 * and had nothing unread in it before this message.
	 */
	private async notify(
		message: MessageRow,
		author: UserRef,
		memberRows: readonly Readonly<{ userId: string; lastReadSeq: number }>[],
	): Promise<void> {
		for (const member of memberRows) {
			if (member.userId === message.authorId) continue
			if (this.presence.isLooking(member.userId, message.conversationId)) continue
			try {
				// oxlint-disable-next-line no-await-in-loop -- a conversation is at most twenty people.
				const [before] = await this.database.read((db) =>
					db
						.select({ value: count() })
						.from(messages)
						.where(
							and(
								eq(messages.conversationId, message.conversationId),
								gt(messages.seq, member.lastReadSeq),
								lt(messages.seq, message.seq),
								ne(messages.authorId, member.userId),
							),
						),
				)
				if ((before?.value ?? 0) > 0) continue
				const detail = noticeDetail('notice.message', { actor: author.displayName })
				// oxlint-disable-next-line no-await-in-loop -- see above.
				await this.core.deliverNotification({
					id: messageNoticeId(message.conversationId, member.userId, member.lastReadSeq),
					recipientId: member.userId,
					kind: 'message.received',
					title: detail.title,
					titleKey: detail.key,
					titleParams: detail.params,
					body: Array.from(message.body).slice(0, 120).join(''),
					path: `/messages/${message.conversationId}`,
					actor: author,
					createdAt: message.createdAt.toISOString(),
				})
			} catch (error) {
				// The message is saved; a notice that cannot go out is not worth failing it for.
				this.ctx.logger.error('could not send the message notice', {
					error,
					recipientId: member.userId,
				})
			}
		}
	}

	private async removeUser(userId: string, ghostId: string): Promise<void> {
		await this.database.transaction(async (tx) => {
			const groups = await tx
				.select({ id: members.conversationId })
				.from(members)
				.innerJoin(conversations, eq(conversations.id, members.conversationId))
				.where(and(eq(members.userId, userId), eq(conversations.kind, 'group')))
			await tx.delete(members).where(eq(members.userId, userId))
			for (const group of groups) {
				// oxlint-disable-next-line no-await-in-loop -- a member is in few groups.
				await this.settleGroup(tx, group.id, userId)
			}
			// What they wrote stays, under Ghost, like their posts.
			await tx.update(messages).set({ authorId: ghostId }).where(eq(messages.authorId, userId))
			await tx.delete(messageSettings).where(eq(messageSettings.userId, userId))
		})
	}
}
