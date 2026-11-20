import { createHash } from 'node:crypto'
import {
	failure,
	isEntityId,
	noticeDetail,
	type ForumNotification,
	type NoticeDetail,
	type Principal,
	type UserDto,
} from '@pluxum/domain'
import { ForumApiPlugin } from '@pluxum/api'
import { ForumCorePlugin, type ForumResult, type PostAfterWriteEvent } from '@pluxum/core'
import { BasePlugin, Plugin } from '@pluxel/core'
import { Result } from '@pluxel/core/better-result'
import { Database, type PluginDatabaseHandle } from '@pluxel/services/database'
import { and, eq, inArray } from 'drizzle-orm'
import { Type, type Static } from 'typebox'
import { solutions, SolvedDatabase } from './database'
import { excerptOf } from './excerpt'

export { excerptOf, EXCERPT_CHARS } from './excerpt'

/** The extension's ID: the key of its data in `ext` and its segment of the ext ingress. */
export const SOLVED_EXT_ID = 'forum-solved'
export const SOLVED_POST_HOOK_ID = 'forum-solved.sync'

const Author = Type.Object({ id: Type.String(), handle: Type.String(), displayName: Type.String() })

/** What a solved thread's `ext['forum-solved']` holds; unsolved threads have none. */
export const ThreadSolution = Type.Object({
	postId: Type.String(),
	/** The answer's floor number. */
	floor: Type.Integer({ minimum: 2 }),
	/** Its opening words, as plain text. */
	excerpt: Type.String(),
	author: Type.Union([Author, Type.Null()]),
	acceptedAt: Type.String(),
})
export type ThreadSolution = Static<typeof ThreadSolution>

/** What the accepted post's `ext['forum-solved']` holds; other posts have none. */
export type PostSolution = Readonly<{ accepted: true }>

/** What `accept` answers: the thread's answer after the call, or null for none. */
export const AcceptResult = Type.Object({
	threadId: Type.String(),
	postId: Type.Union([Type.String(), Type.Null()]),
})
export type AcceptResult = Static<typeof AcceptResult>

const AcceptInput = Type.Object({
	postId: Type.String({ maxLength: 64 }),
	/** The state to end in, not a toggle: repeating the call changes nothing. */
	on: Type.Boolean(),
})

/** A UUID (version 8, name-based) for the notice that one post was accepted. */
export function acceptNoticeId(postId: string): string {
	const hex = createHash('sha256').update(`accepted:${postId}`).digest('hex')
	const variant = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16)
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/**
 * Accepted answers (「采纳答案」), as an extension of the forum. The thread's author or a moderator
 * accepts one reply of a topic; notes have none. It keeps one row per solved thread and contributes:
 * - `entityExtensions`: a thread's answer (floor, author, opening words), and `accepted` on the post;
 * - `uiSlots`: the 「采纳为答案」 item in a post's menu (`post.actions`), the 「已采纳」 mark under
 *   the answer (`post.footer`), the answer pinned under the opening post (`post.after`) and the
 *   「已解决」 badge in thread lists (`thread.badges`);
 * - `extActions` `POST /api/forum/ext/forum-solved/accept`;
 * - a `post.accepted` notice to the answer's author;
 * - `postHooks` (`forum-solved.sync`) keeping the copied words fresh and dropping the answer when
 *   its post or thread is deleted.
 *
 * Stopping it removes all of that; the answers stay stored and return with it.
 */
// PGlite compiles its WASM module on first use, which can exceed the default start timeout.
@Plugin({ displayName: 'Forum Solved', startTimeoutMs: 30_000 })
export class ForumSolvedPlugin extends BasePlugin {
	private database!: PluginDatabaseHandle<typeof SolvedDatabase>

	constructor(
		private readonly core: ForumCorePlugin,
		private readonly api: ForumApiPlugin,
	) {
		super()
	}

	protected override async init(): Promise<void> {
		this.database = await this.ctx.require(Database).use(SolvedDatabase)
		this.ctx.effects.defer(
			this.core.registerEntityExtension({
				id: SOLVED_EXT_ID,
				entity: 'thread',
				load: (threadIds) => this.threadSolutions(threadIds),
			}),
		)
		this.ctx.effects.defer(
			this.core.registerEntityExtension({
				id: SOLVED_EXT_ID,
				entity: 'post',
				load: (postIds) => this.acceptedPosts(postIds),
			}),
		)
		this.ctx.effects.defer(
			this.core.registerUiSlots({
				id: SOLVED_EXT_ID,
				slots: ['post.actions', 'post.footer', 'post.after', 'thread.badges'],
			}),
		)
		this.ctx.effects.defer(
			this.core.registerPostHook({
				id: SOLVED_POST_HOOK_ID,
				afterWrite: (event) => this.sync(event),
			}),
		)
		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: SOLVED_EXT_ID,
				action: 'accept',
				method: 'POST',
				login: true,
				input: AcceptInput,
				output: AcceptResult,
				handle: ({ principal, input }) => this.accept(principal, input.postId, input.on),
			}),
		)
	}

	/** The answer of every given thread that has one, in one query plus one lookup per author. */
	async threadSolutions(threadIds: readonly string[]): Promise<Map<string, ThreadSolution>> {
		const ids = threadIds.filter(isEntityId)
		const found = new Map<string, ThreadSolution>()
		if (ids.length === 0) return found
		const rows = await this.database.read((db) =>
			db.select().from(solutions).where(inArray(solutions.threadId, ids)),
		)
		const authors = new Map<string, UserDto | null>()
		await Promise.all(
			[...new Set(rows.map((row) => row.answerAuthorId))].map(async (id) => {
				const user = await this.core.getUser(id)
				authors.set(
					id,
					user.isOk()
						? { id: user.value.id, handle: user.value.handle, displayName: user.value.displayName }
						: null,
				)
			}),
		)
		for (const row of rows) {
			found.set(row.threadId, {
				postId: row.postId,
				floor: row.postNumber,
				excerpt: row.excerpt,
				author: authors.get(row.answerAuthorId) ?? null,
				acceptedAt: row.acceptedAt.toISOString(),
			})
		}
		return found
	}

	/** Which of the given posts are accepted answers. */
	async acceptedPosts(postIds: readonly string[]): Promise<Map<string, PostSolution>> {
		const ids = postIds.filter(isEntityId)
		if (ids.length === 0) return new Map()
		const rows = await this.database.read((db) =>
			db.select({ postId: solutions.postId }).from(solutions).where(inArray(solutions.postId, ids)),
		)
		return new Map(rows.map((row) => [row.postId, { accepted: true }]))
	}

	/**
	 * Makes a reply the accepted answer of its topic (replacing any other), or withdraws it. Only
	 * the topic's author and moderators may; the opening post and notes cannot be accepted.
	 */
	async accept(
		principal: Principal,
		postId: string,
		on: boolean,
	): Promise<ForumResult<AcceptResult>> {
		const userId = principal.userId
		if (userId === null) return Result.err(failure('unauthenticated', 'auth.required'))
		const located = await this.core.locatePost(principal, postId)
		if (located.isErr()) return Result.err(located.error)
		const post = located.value
		const thread = await this.core.locateThread(principal, post.threadId)
		if (thread.isErr()) return Result.err(thread.error)
		const mayAccept =
			post.threadAuthorId === userId ||
			this.core.can(principal, 'thread.moderate', thread.value.resource)
		if (!mayAccept) {
			return Result.err(failure('forbidden', 'solved.not_allowed'))
		}
		if (post.threadKind === 'note') {
			return Result.err(failure('invalid', 'solved.note'))
		}
		if (post.postNumber === 1) {
			return Result.err(failure('invalid', 'solved.opening'))
		}
		if (!on) {
			const [current] = await this.database.transaction((tx) =>
				tx
					.delete(solutions)
					.where(and(eq(solutions.threadId, post.threadId), eq(solutions.postId, post.postId)))
					.returning({ postId: solutions.postId }),
			)
			// Withdrawing a post that was not the answer leaves the real answer in place.
			return Result.ok({
				threadId: post.threadId,
				postId: current ? null : await this.answerOf(post.threadId),
			})
		}
		const values = {
			postId: post.postId,
			postNumber: post.postNumber,
			answerAuthorId: post.authorId,
			excerpt: excerptOf(post.body),
			acceptedBy: userId,
			acceptedAt: new Date(),
		}
		const [previous] = await this.database.transaction(async (tx) => {
			const before = await tx
				.select({ postId: solutions.postId })
				.from(solutions)
				.where(eq(solutions.threadId, post.threadId))
			await tx
				.insert(solutions)
				.values({ threadId: post.threadId, ...values })
				.onConflictDoUpdate({ target: solutions.threadId, set: values })
			return before
		})
		if (previous?.postId !== post.postId && post.authorId !== userId) {
			await this.notifyAccepted(userId, post.authorId, post.postId, post.threadId, {
				threadRef: post.threadRef,
				floor: post.postNumber,
				excerpt: values.excerpt,
			})
		}
		return Result.ok({ threadId: post.threadId, postId: post.postId })
	}

	private async answerOf(threadId: string): Promise<string | null> {
		const [row] = await this.database.read((db) =>
			db
				.select({ postId: solutions.postId })
				.from(solutions)
				.where(eq(solutions.threadId, threadId)),
		)
		return row?.postId ?? null
	}

	/** Keeps the copied words in step with edits and forgets answers whose post or thread is gone. */
	private async sync(event: PostAfterWriteEvent): Promise<void> {
		switch (event.kind) {
			case 'post.updated':
				await this.database.transaction((tx) =>
					tx
						.update(solutions)
						.set({ excerpt: excerptOf(event.body) })
						.where(eq(solutions.postId, event.postId)),
				)
				return
			case 'post.deleted':
				await this.database.transaction((tx) =>
					tx.delete(solutions).where(eq(solutions.postId, event.postId)),
				)
				return
			case 'thread.deleted':
				await this.database.transaction((tx) =>
					tx.delete(solutions).where(eq(solutions.threadId, event.threadId)),
				)
				return
			default:
		}
	}

	private async notifyAccepted(
		actorId: string,
		recipientId: string,
		postId: string,
		threadId: string,
		place: Readonly<{ threadRef: string; floor: number; excerpt: string }>,
	): Promise<void> {
		try {
			const actor = await this.core.getUser(actorId)
			if (actor.isErr()) return
			await this.core.deliverNotification({
				// One notice per answer, so withdrawing and accepting again does not repeat it.
				id: acceptNoticeId(postId),
				recipientId,
				kind: 'post.accepted',
				...noticeFields(noticeDetail('notice.accepted', { actor: actor.value.displayName })),
				...(place.excerpt === '' ? {} : { body: place.excerpt }),
				path: `/t/${place.threadRef}/${place.floor}`,
				threadId,
				postId,
				actor: actor.value,
				createdAt: new Date().toISOString(),
			})
		} catch (error) {
			// The answer is saved; a notice that cannot go out is not worth failing it for.
			this.ctx.logger.error('could not send the accepted notice', { error, postId })
		}
	}
}

/** The fields of a notification that say its title. */
function noticeFields(
	detail: NoticeDetail,
): Pick<ForumNotification, 'title' | 'titleKey' | 'titleParams'> {
	return { title: detail.title, titleKey: detail.key, titleParams: detail.params }
}
