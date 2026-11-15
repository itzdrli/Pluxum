import type { Principal } from '@pluxum/domain'
import { ForumApiPlugin } from '@pluxum/api'
import { ForumCorePlugin, type ForumResult } from '@pluxum/core'
import { BasePlugin, Plugin } from '@pluxel/core'
import { Result } from '@pluxel/core/better-result'
import { Database, type PluginDatabaseHandle } from '@pluxel/services/database'
import { and, count, eq, inArray, sql } from 'drizzle-orm'
import { Type, type Static } from 'typebox'
import { reactions, ReactionsDatabase } from './database'

/** The extension's ID: the key of its data in a post's `ext` and its segment of the ext ingress. */
export const REACTIONS_EXT_ID = 'forum-reactions'

const LIKE = 'like'

/** What a post's `ext['forum-reactions']` holds, and what the `react` action answers. */
export const ReactionSummary = Type.Object({
	/** How many people like the post. */
	count: Type.Integer({ minimum: 0 }),
	/** Whether the viewer is one of them. */
	reacted: Type.Boolean(),
})
export type ReactionSummary = Static<typeof ReactionSummary>

const ReactInput = Type.Object({
	postId: Type.String({ maxLength: 64 }),
	/** The state to end in, not a toggle: repeating the call changes nothing. */
	on: Type.Boolean(),
})

/**
 * Likes on posts, as an extension of the forum: it keeps its own table, attaches a summary to
 * every post DTO, fills the `post.footer` slot of the frontend and serves one action behind the
 * ext ingress. Stopping it removes all three; the likes stay stored and return with it.
 */
// PGlite compiles its WASM module on first use, which can exceed the default start timeout.
@Plugin({ displayName: 'Forum Reactions', startTimeoutMs: 30_000 })
export class ForumReactionsPlugin extends BasePlugin {
	private database!: PluginDatabaseHandle<typeof ReactionsDatabase>

	constructor(
		private readonly core: ForumCorePlugin,
		private readonly api: ForumApiPlugin,
	) {
		super()
	}

	protected override async init(): Promise<void> {
		this.database = await this.ctx.require(Database).use(ReactionsDatabase)
		this.ctx.effects.defer(
			this.core.registerEntityExtension({
				id: REACTIONS_EXT_ID,
				entity: 'post',
				load: (postIds, viewer) => this.summaries(postIds, viewer),
			}),
		)
		this.ctx.effects.defer(
			this.core.registerUiSlots({ id: REACTIONS_EXT_ID, slots: ['post.footer'] }),
		)
		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: REACTIONS_EXT_ID,
				action: 'react',
				method: 'POST',
				login: true,
				input: ReactInput,
				output: ReactionSummary,
				handle: ({ principal, input }) => this.react(principal, input.postId, input.on),
			}),
		)
	}

	/** The like summary of every given post as the viewer sees it, in one query. */
	async summaries(
		postIds: readonly string[],
		viewer: Principal,
	): Promise<Map<string, ReactionSummary>> {
		const summaries = new Map<string, ReactionSummary>(
			postIds.map((postId) => [postId, { count: 0, reacted: false }]),
		)
		if (postIds.length === 0) return summaries
		const mine =
			viewer.userId === null
				? sql<boolean>`false`
				: sql<boolean>`coalesce(bool_or(${reactions.userId} = ${viewer.userId}), false)`
		const rows = await this.database.read((db) =>
			db
				.select({ postId: reactions.postId, count: count(), reacted: mine })
				.from(reactions)
				.where(and(inArray(reactions.postId, [...postIds]), eq(reactions.kind, LIKE)))
				.groupBy(reactions.postId),
		)
		for (const row of rows) {
			summaries.set(row.postId, { count: row.count, reacted: row.reacted })
		}
		return summaries
	}

	/**
	 * Sets whether the principal likes a post and returns the post's new summary. The core decides
	 * whether the post can be seen and reacted to; the write itself is idempotent, so a retry
	 * after a lost answer is safe.
	 */
	async react(
		principal: Principal,
		postId: string,
		on: boolean,
	): Promise<ForumResult<ReactionSummary>> {
		const userId = principal.userId
		if (userId === null) return Result.err({ code: 'unauthenticated', message: '请先登录' })
		const located = await this.core.locatePost(principal, postId)
		if (located.isErr()) return Result.err(located.error)
		if (!this.core.can(principal, 'post.react', located.value.resource)) {
			return Result.err({ code: 'forbidden', message: '没有权限执行此操作' })
		}
		const key = and(
			eq(reactions.postId, located.value.postId),
			eq(reactions.userId, userId),
			eq(reactions.kind, LIKE),
		)
		const total = await this.database.transaction(async (tx) => {
			if (on) {
				await tx
					.insert(reactions)
					.values({ postId: located.value.postId, userId, kind: LIKE })
					.onConflictDoNothing()
			} else {
				await tx.delete(reactions).where(key)
			}
			const [row] = await tx
				.select({ value: count() })
				.from(reactions)
				.where(and(eq(reactions.postId, located.value.postId), eq(reactions.kind, LIKE)))
			return row?.value ?? 0
		})
		return Result.ok({ count: total, reacted: on })
	}
}
