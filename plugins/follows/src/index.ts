import { createHash } from 'node:crypto'
import { isEntityId, type Principal } from '@pluxum/domain'
import { ForumApiPlugin } from '@pluxum/api'
import { ForumCorePlugin, type Followed, type ForumResult } from '@pluxum/core'
import { BasePlugin, Plugin } from '@pluxel/core'
import { Result } from '@pluxel/core/better-result'
import { Database, type PluginDatabaseHandle } from '@pluxel/services/database'
import { and, count, desc, eq, inArray } from 'drizzle-orm'
import { Type, type Static } from 'typebox'
import { follows, FollowsDatabase, followSettings } from './database'

/** The extension's ID: the key of its data in a user's `ext` and its segment of the ext ingress. */
export const FOLLOWS_EXT_ID = 'forum-follows'
export const FOLLOW_GRAPH_ID = 'forum-follows.graph'

/** The graph hands the core at most this many targets per reader, newest follows first. */
export const FOLLOWING_LIMIT = 2000

const TargetKind = Type.Union([Type.Literal('user'), Type.Literal('category')])
export type TargetKind = Static<typeof TargetKind>

/** What a user's `ext['forum-follows']` holds. */
export const UserFollowSummary = Type.Object({
	/** How many people follow them. */
	followers: Type.Integer({ minimum: 0 }),
	/** How many people they follow. */
	following: Type.Integer({ minimum: 0 }),
	/** Whether the viewer follows them. */
	followed: Type.Boolean(),
})
export type UserFollowSummary = Static<typeof UserFollowSummary>

/** One person or category as the viewer sees it: what `follow` and `state` answer. */
export const FollowState = Type.Object({
	kind: TargetKind,
	id: Type.String(),
	followed: Type.Boolean(),
	followers: Type.Integer({ minimum: 0 }),
})
export type FollowState = Static<typeof FollowState>

export const FollowPreference = Type.Object({
	/** Whether someone following you sends a notice. */
	notify: Type.Boolean(),
})
export type FollowPreference = Static<typeof FollowPreference>

const TargetInput = Type.Object({ kind: TargetKind, id: Type.String({ maxLength: 64 }) })
const FollowInput = Type.Object({
	kind: TargetKind,
	id: Type.String({ maxLength: 64 }),
	/** The state to end in, not a toggle: repeating the call changes nothing. */
	on: Type.Boolean(),
})

/** A UUID (version 8, name-based) for the notice of one person following another. */
export function followNoticeId(followerId: string, targetId: string): string {
	const hex = createHash('sha256').update(`follow:${followerId}:${targetId}`).digest('hex')
	const variant = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16)
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/**
 * Following people and categories, as an extension of the forum. It keeps the follows in its own
 * table and contributes:
 * - the core's `followGraph` slot (`forum-follows.graph`), which makes the home page's 「关注」
 *   feed exist;
 * - `entityExtensions` on users: follower and following counts, and whether the viewer follows;
 * - `uiSlots`: the follow button in `user.header` and `category.header`, and the notice setting
 *   in `user.profile.tabs`;
 * - `extActions` `follow`, `state`, `settings` and `preference` under `/api/forum/ext/forum-follows`;
 * - a `user.followed` notice to whoever gains a follower (once per pair: following again after
 *   unfollowing does not repeat it), unless they switched it off.
 *
 * Stopping it removes all of that, and the home page goes back to 「热门」 and 「最新」; the follows
 * stay stored and return with it.
 */
// PGlite compiles its WASM module on first use, which can exceed the default start timeout.
@Plugin({ displayName: 'Forum Follows', startTimeoutMs: 30_000 })
export class ForumFollowsPlugin extends BasePlugin {
	private database!: PluginDatabaseHandle<typeof FollowsDatabase>

	constructor(
		private readonly core: ForumCorePlugin,
		private readonly api: ForumApiPlugin,
	) {
		super()
	}

	protected override async init(): Promise<void> {
		this.database = await this.ctx.require(Database).use(FollowsDatabase)
		this.ctx.effects.defer(
			this.core.registerFollowGraph({
				id: FOLLOW_GRAPH_ID,
				following: (userId) => this.following(userId),
			}),
		)
		this.ctx.effects.defer(
			this.core.registerEntityExtension({
				id: FOLLOWS_EXT_ID,
				entity: 'user',
				load: (userIds, viewer) => this.summaries(userIds, viewer),
			}),
		)
		this.ctx.effects.defer(
			this.core.registerUiSlots({
				id: FOLLOWS_EXT_ID,
				slots: ['user.header', 'category.header', 'user.profile.tabs'],
			}),
		)
		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: FOLLOWS_EXT_ID,
				action: 'follow',
				method: 'POST',
				login: true,
				input: FollowInput,
				output: FollowState,
				handle: ({ principal, input }) => this.follow(principal, input.kind, input.id, input.on),
			}),
		)
		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: FOLLOWS_EXT_ID,
				action: 'state',
				method: 'GET',
				login: false,
				input: TargetInput,
				output: FollowState,
				handle: ({ principal, input }) => this.state(principal, input.kind, input.id),
			}),
		)
		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: FOLLOWS_EXT_ID,
				action: 'settings',
				method: 'GET',
				login: true,
				input: Type.Object({}),
				output: FollowPreference,
				handle: async ({ principal }) =>
					Result.ok({ notify: await this.notifies(principal.userId ?? '') }),
			}),
		)
		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: FOLLOWS_EXT_ID,
				action: 'preference',
				method: 'POST',
				login: true,
				input: FollowPreference,
				output: FollowPreference,
				handle: ({ principal, input }) => this.setPreference(principal, input.notify),
			}),
		)
	}

	/** Whom `userId` follows, for the core's 「关注」 feed. */
	async following(userId: string): Promise<Followed> {
		const rows = await this.database.read((db) =>
			db
				.select({ kind: follows.targetKind, id: follows.targetId })
				.from(follows)
				.where(eq(follows.followerId, userId))
				.orderBy(desc(follows.createdAt))
				.limit(FOLLOWING_LIMIT),
		)
		return {
			userIds: rows.filter((row) => row.kind === 'user').map((row) => row.id),
			categoryIds: rows.filter((row) => row.kind === 'category').map((row) => row.id),
		}
	}

	/** Follow counts of every given user, and whether the viewer follows each, in three queries. */
	async summaries(
		userIds: readonly string[],
		viewer: Principal,
	): Promise<Map<string, UserFollowSummary>> {
		const ids = userIds.filter(isEntityId)
		const summaries = new Map<string, UserFollowSummary>(
			ids.map((id) => [id, { followers: 0, following: 0, followed: false }]),
		)
		if (ids.length === 0) return summaries
		const [followers, following, mine] = await this.database.read((db) =>
			Promise.all([
				db
					.select({ id: follows.targetId, value: count() })
					.from(follows)
					.where(and(eq(follows.targetKind, 'user'), inArray(follows.targetId, ids)))
					.groupBy(follows.targetId),
				db
					.select({ id: follows.followerId, value: count() })
					.from(follows)
					.where(and(eq(follows.targetKind, 'user'), inArray(follows.followerId, ids)))
					.groupBy(follows.followerId),
				viewer.userId === null
					? Promise.resolve([])
					: db
							.select({ id: follows.targetId })
							.from(follows)
							.where(
								and(
									eq(follows.followerId, viewer.userId),
									eq(follows.targetKind, 'user'),
									inArray(follows.targetId, ids),
								),
							),
			]),
		)
		const patch = (id: string, change: Partial<UserFollowSummary>) => {
			const current = summaries.get(id)
			if (current) summaries.set(id, { ...current, ...change })
		}
		for (const row of followers) patch(row.id, { followers: row.value })
		for (const row of following) patch(row.id, { following: row.value })
		for (const row of mine) patch(row.id, { followed: true })
		return summaries
	}

	/** Whether the viewer follows a person or category, and how many people do. */
	async state(
		principal: Principal,
		kind: TargetKind,
		ref: string,
	): Promise<ForumResult<FollowState>> {
		const target = await this.target(principal, kind, ref)
		if (target.isErr()) return Result.err(target.error)
		return Result.ok(await this.stateOf(principal.userId, kind, target.value))
	}

	/**
	 * Sets whether the principal follows a person or a category the principal may see, and returns
	 * the new state. Idempotent, so a retry after a lost answer is safe.
	 */
	async follow(
		principal: Principal,
		kind: TargetKind,
		ref: string,
		on: boolean,
	): Promise<ForumResult<FollowState>> {
		const followerId = principal.userId
		if (followerId === null) return Result.err({ code: 'unauthenticated', message: '请先登录' })
		const target = await this.target(principal, kind, ref)
		if (target.isErr()) return Result.err(target.error)
		const targetId = target.value
		if (kind === 'user' && targetId === followerId) {
			return Result.err({ code: 'invalid', message: '不能关注自己' })
		}
		const key = and(
			eq(follows.followerId, followerId),
			eq(follows.targetKind, kind),
			eq(follows.targetId, targetId),
		)
		const changed = await this.database.transaction(async (tx) => {
			const touched = on
				? await tx
						.insert(follows)
						.values({ followerId, targetKind: kind, targetId })
						.onConflictDoNothing()
						.returning({ id: follows.targetId })
				: await tx.delete(follows).where(key).returning({ id: follows.targetId })
			return touched.length > 0
		})
		if (changed && on && kind === 'user') await this.notifyFollowed(followerId, targetId)
		return Result.ok(await this.stateOf(followerId, kind, targetId))
	}

	/** Whether `userId` hears about new followers. */
	async notifies(userId: string): Promise<boolean> {
		if (!isEntityId(userId)) return true
		const [row] = await this.database.read((db) =>
			db
				.select({ notify: followSettings.notify })
				.from(followSettings)
				.where(eq(followSettings.userId, userId)),
		)
		return row?.notify ?? true
	}

	async setPreference(
		principal: Principal,
		notify: boolean,
	): Promise<ForumResult<FollowPreference>> {
		const userId = principal.userId
		if (userId === null) return Result.err({ code: 'unauthenticated', message: '请先登录' })
		await this.database.transaction((tx) =>
			tx
				.insert(followSettings)
				.values({ userId, notify })
				.onConflictDoUpdate({
					target: followSettings.userId,
					set: { notify, updatedAt: new Date() },
				}),
		)
		return Result.ok({ notify })
	}

	/** The stable ID of a person (by ID or handle) or of a category the principal may see. */
	private async target(
		principal: Principal,
		kind: TargetKind,
		ref: string,
	): Promise<ForumResult<string>> {
		if (kind === 'user') {
			const found = await this.core.getUser(ref, principal)
			return found.isOk() ? Result.ok(found.value.id) : Result.err(found.error)
		}
		const visible = await this.core.listCategories(principal)
		const category = visible.find((entry) => entry.id === ref || entry.slug === ref)
		return category
			? Result.ok(category.id)
			: Result.err({ code: 'not_found', message: '版块不存在' })
	}

	private async stateOf(
		viewerId: string | null,
		kind: TargetKind,
		targetId: string,
	): Promise<FollowState> {
		const target = and(eq(follows.targetKind, kind), eq(follows.targetId, targetId))
		const [[total], mine] = await this.database.read((db) =>
			Promise.all([
				db.select({ value: count() }).from(follows).where(target),
				viewerId === null
					? Promise.resolve([])
					: db
							.select({ id: follows.targetId })
							.from(follows)
							.where(and(target, eq(follows.followerId, viewerId))),
			]),
		)
		return { kind, id: targetId, followed: mine.length > 0, followers: total?.value ?? 0 }
	}

	private async notifyFollowed(followerId: string, targetId: string): Promise<void> {
		try {
			if (!(await this.notifies(targetId))) return
			const actor = await this.core.getUser(followerId)
			if (actor.isErr()) return
			await this.core.deliverNotification({
				// One notice per pair, so unfollowing and following again does not repeat it.
				id: followNoticeId(followerId, targetId),
				recipientId: targetId,
				kind: 'user.followed',
				title: `${actor.value.displayName} 关注了你`,
				path: `/u/${actor.value.handle}`,
				actor: actor.value,
				createdAt: new Date().toISOString(),
			})
		} catch (error) {
			// The follow itself is saved; a notice that cannot go out is not worth failing it for.
			this.ctx.logger.error('could not send the follow notice', { error, followerId, targetId })
		}
	}
}
