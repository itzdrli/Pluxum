import { failure } from '@pluxum/domain'
import type { Principal } from '@pluxum/domain'
import { ForumApiPlugin } from '@pluxum/api'
import { ForumCorePlugin, type ForumResult } from '@pluxum/core'
import { BasePlugin, Plugin } from '@pluxel/core'
import { Result } from '@pluxel/core/better-result'
import { Database, type PluginDatabaseHandle } from '@pluxel/services/database'
import { and, count, eq, inArray, sql } from 'drizzle-orm'
import { Type, type Static } from 'typebox'
import * as v from 'valibot'
import * as f from 'valibot-form'
import { reactions, ReactionsDatabase } from './database'

/** The extension's ID: the key of its data in a post's `ext` and its segment of the ext ingress. */
export const REACTIONS_EXT_ID = 'forum-reactions'

/** The reactions there are: a like, and 「有用」 for a reply that helped. */
export const REACTION_KINDS = ['like', 'useful'] as const
export type ReactionKind = (typeof REACTION_KINDS)[number]

const weight = (title: string, description: string, fallback: number) =>
	v.optional(
		v.pipe(
			v.number(),
			v.integer(),
			v.minValue(0),
			v.maxValue(20),
			f.formMeta({ title, description }),
			f.numberMeta({ step: 1 }),
		),
		fallback,
	)

export const ForumReactionsConfig = v.object({
	likeWeight: weight(
		'点赞的热度',
		'每个点赞给主题加的热度分（一条回复算 1 分）。改动只影响之后的点赞和取消。',
		1,
	),
	usefulWeight: weight(
		'「有用」的热度',
		'每个「有用」给主题加的热度分，通常比点赞高。改动只影响之后的回应和取消。',
		3,
	),
	/** Slugs of the categories whose topics offer 「有用」; everywhere else there is the like alone. */
	usefulCategories: v.optional(
		v.pipe(
			v.array(v.pipe(v.string(), v.trim(), v.toLowerCase(), v.minLength(1), v.maxLength(64))),
			f.formMeta({
				title: '开启「有用」的版块',
				description: '填版块标识（slug）。不在列表里的版块只有点赞。',
			}),
			f.arrayMeta({ itemLabel: '版块标识', addLabel: '添加版块', emptyHint: '所有版块都只有点赞' }),
		),
		[],
	),
})
export type ForumReactionsConfig = v.InferOutput<typeof ForumReactionsConfig>

const Tally = Type.Object({
	/** How many people gave this reaction. */
	count: Type.Integer({ minimum: 0 }),
	/** Whether the viewer is one of them. */
	reacted: Type.Boolean(),
})
type Tally = Static<typeof Tally>

/**
 * What a post's `ext['forum-reactions']` holds, and what the `react` action answers: the likes at
 * the top level (the shape from before there was a second reaction), 「有用」 under `useful`.
 */
export const ReactionSummary = Type.Object({
	count: Type.Integer({ minimum: 0 }),
	reacted: Type.Boolean(),
	useful: Tally,
})
export type ReactionSummary = Static<typeof ReactionSummary>

const ReactInput = Type.Object({
	postId: Type.String({ maxLength: 64 }),
	/** Which reaction; a like when left out. */
	kind: Type.Optional(Type.Union([Type.Literal('like'), Type.Literal('useful')])),
	/** The state to end in, not a toggle: repeating the call changes nothing. */
	on: Type.Boolean(),
})

/** What a thread's `ext['forum-reactions']` holds: whether its posts offer 「有用」. */
export const ThreadReactions = Type.Object({ useful: Type.Boolean() })
export type ThreadReactions = Static<typeof ThreadReactions>

const none = (): ReactionSummary => ({
	count: 0,
	reacted: false,
	useful: { count: 0, reacted: false },
})

/**
 * Likes and 「有用」 on posts, as an extension of the forum: it keeps its own table, attaches a
 * summary to every post DTO, fills the `post.footer` slot of the frontend and serves one action
 * behind the ext ingress. Both count towards the thread's place in 「热门」, each with its own
 * weight (config). Stopping it removes all of that; the reactions stay stored and return with it.
 */
// PGlite compiles its WASM module on first use, which can exceed the default start timeout.
@Plugin({ displayName: 'Forum Reactions', startTimeoutMs: 30_000 })
export class ForumReactionsPlugin extends BasePlugin {
	private readonly config = this.configs.use(ForumReactionsConfig)
	private database!: PluginDatabaseHandle<typeof ReactionsDatabase>

	constructor(
		private readonly core: ForumCorePlugin,
		private readonly api: ForumApiPlugin,
	) {
		super()
	}

	protected override async init(): Promise<void> {
		this.database = await this.ctx.require(Database).use(ReactionsDatabase)
		// Reactions stay counted, as Ghost's. One Ghost already gave on the same post is dropped.
		this.ctx.effects.defer(
			this.core.registerUserRemoval({
				id: `${REACTIONS_EXT_ID}.removal`,
				remove: ({ userId, ghostId }) =>
					this.database.transaction(async (tx) => {
						const mine = await tx
							.select({ postId: reactions.postId })
							.from(reactions)
							.where(eq(reactions.userId, userId))
						const clashes =
							mine.length === 0
								? []
								: await tx
										.select({ postId: reactions.postId, kind: reactions.kind })
										.from(reactions)
										.where(
											and(
												eq(reactions.userId, ghostId),
												inArray(
													reactions.postId,
													mine.map((row) => row.postId),
												),
											),
										)
						for (const clash of clashes) {
							// oxlint-disable-next-line no-await-in-loop -- rare, and inside one transaction.
							await tx
								.delete(reactions)
								.where(
									and(
										eq(reactions.userId, userId),
										eq(reactions.postId, clash.postId),
										eq(reactions.kind, clash.kind),
									),
								)
						}
						await tx.update(reactions).set({ userId: ghostId }).where(eq(reactions.userId, userId))
					}),
			}),
		)
		// Weights are read per reaction; a saved change applies as is.
		this.configs.onUpdate(this.config, () => {})
		this.ctx.effects.defer(
			this.core.registerEntityExtension({
				id: REACTIONS_EXT_ID,
				entity: 'post',
				load: (postIds, viewer) => this.summaries(postIds, viewer),
			}),
		)
		this.ctx.effects.defer(
			this.core.registerEntityExtension({
				id: REACTIONS_EXT_ID,
				entity: 'thread',
				load: (threadIds) => this.threadSettings(threadIds),
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
				handle: ({ principal, input }) =>
					this.react(principal, input.postId, input.on, input.kind ?? 'like'),
			}),
		)
	}

	/** Whether 「有用」 is on in a category, by its slug. */
	usefulIn(categorySlug: string): boolean {
		return this.config.usefulCategories.includes(categorySlug.toLowerCase())
	}

	/** For every given thread, whether its posts offer 「有用」 (its category is listed), in one query. */
	async threadSettings(threadIds: readonly string[]): Promise<Map<string, ThreadReactions>> {
		const slugs = await this.core.threadCategorySlugs(threadIds)
		return new Map(
			[...slugs].map(([threadId, slug]) => [threadId, { useful: this.usefulIn(slug) }]),
		)
	}

	/** The reaction summary of every given post as the viewer sees it, in one query. */
	async summaries(
		postIds: readonly string[],
		viewer: Principal,
	): Promise<Map<string, ReactionSummary>> {
		const summaries = new Map<string, ReactionSummary>(postIds.map((postId) => [postId, none()]))
		if (postIds.length === 0) return summaries
		const mine =
			viewer.userId === null
				? sql<boolean>`false`
				: sql<boolean>`coalesce(bool_or(${reactions.userId} = ${viewer.userId}), false)`
		const rows = await this.database.read((db) =>
			db
				.select({ postId: reactions.postId, kind: reactions.kind, count: count(), reacted: mine })
				.from(reactions)
				.where(
					and(inArray(reactions.postId, [...postIds]), inArray(reactions.kind, REACTION_KINDS)),
				)
				.groupBy(reactions.postId, reactions.kind),
		)
		for (const row of rows) {
			const current = summaries.get(row.postId) ?? none()
			const tally: Tally = { count: row.count, reacted: row.reacted }
			summaries.set(
				row.postId,
				row.kind === 'useful' ? { ...current, useful: tally } : { ...current, ...tally },
			)
		}
		return summaries
	}

	/**
	 * Sets whether the principal gives a post a reaction (a like by default) and returns the post's
	 * new summary. The core decides whether the post can be seen and reacted to; the write itself
	 * is idempotent, so a retry after a lost answer is safe.
	 */
	async react(
		principal: Principal,
		postId: string,
		on: boolean,
		kind: ReactionKind = 'like',
	): Promise<ForumResult<ReactionSummary>> {
		const userId = principal.userId
		if (userId === null) return Result.err(failure('unauthenticated', 'auth.required'))
		const located = await this.core.locatePost(principal, postId)
		if (located.isErr()) return Result.err(located.error)
		if (!this.core.can(principal, 'post.react', located.value.resource)) {
			return Result.err(failure('forbidden', 'permission.denied'))
		}
		// 「有用」 only where it is on; withdrawing one given before it was turned off still works.
		if (kind === 'useful' && on) {
			const slug = (await this.core.threadCategorySlugs([located.value.threadId])).get(
				located.value.threadId,
			)
			if (slug === undefined || !this.usefulIn(slug)) {
				return Result.err(failure('forbidden', 'reactions.useful_off'))
			}
		}
		const key = and(
			eq(reactions.postId, located.value.postId),
			eq(reactions.userId, userId),
			eq(reactions.kind, kind),
		)
		const changed = await this.database.transaction(async (tx) => {
			const touched = on
				? await tx
						.insert(reactions)
						.values({ postId: located.value.postId, userId, kind })
						.onConflictDoNothing()
						.returning({ postId: reactions.postId })
				: await tx.delete(reactions).where(key).returning({ postId: reactions.postId })
			return touched.length > 0
		})
		// Reactions count towards the thread's place in "hot"; a repeated call changes nothing.
		const points = kind === 'useful' ? this.config.usefulWeight : this.config.likeWeight
		if (changed && points > 0) {
			await this.core.adjustEngagement(located.value.threadId, on ? points : -points)
		}
		const summary = (await this.summaries([located.value.postId], principal)).get(
			located.value.postId,
		)
		return Result.ok(summary ?? none())
	}
}
