import { failure } from '@pluxum/domain'
import type { Principal } from '@pluxum/domain'
import { ForumApiPlugin } from '@pluxum/api'
import { ForumCorePlugin, type ForumResult } from '@pluxum/core'
import { BasePlugin, Plugin } from '@pluxel/core'
import { Result } from '@pluxel/core/better-result'
import { Database, type PluginDatabaseHandle } from '@pluxel/services/database'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { Type, type Static } from 'typebox'
import { readerBaselines, ReadsDatabase, threadReads } from './database'

/** The extension's ID: the key of its data in a thread's `ext` and its segment of the ext ingress. */
export const READS_EXT_ID = 'forum-reads'

/**
 * What a thread's `ext['forum-reads']` holds: the moment the viewer has read up to. The thread is
 * unread for them when its `lastPostAt` is later. Guests get nothing.
 */
export const ReadState = Type.Object({
	readThrough: Type.String({ format: 'date-time' }),
})
export type ReadState = Static<typeof ReadState>

const MarkInput = Type.Object({ threadId: Type.String({ maxLength: 64 }) })

/**
 * Unread markers on threads, as an extension of the forum: it keeps its own tables, attaches the
 * viewer's read position to every thread DTO, fills the `thread.view` slot of the frontend (which
 * reports a thread read once its last page is on screen) and serves one action behind the ext
 * ingress. Stopping it removes all three; the positions stay stored and return with it.
 */
// PGlite compiles its WASM module on first use, which can exceed the default start timeout.
@Plugin({ displayName: 'Forum Reads', startTimeoutMs: 30_000 })
export class ForumReadsPlugin extends BasePlugin {
	private database!: PluginDatabaseHandle<typeof ReadsDatabase>

	constructor(
		private readonly core: ForumCorePlugin,
		private readonly api: ForumApiPlugin,
	) {
		super()
	}

	protected override async init(): Promise<void> {
		this.database = await this.ctx.require(Database).use(ReadsDatabase)
		this.ctx.effects.defer(
			this.core.registerUserRemoval({
				id: `${READS_EXT_ID}.removal`,
				remove: ({ userId }) =>
					this.database.transaction(async (tx) => {
						await tx.delete(threadReads).where(eq(threadReads.userId, userId))
						await tx.delete(readerBaselines).where(eq(readerBaselines.userId, userId))
					}),
			}),
		)
		this.ctx.effects.defer(
			this.core.registerEntityExtension({
				id: READS_EXT_ID,
				entity: 'thread',
				load: (threadIds, viewer) => this.states(threadIds, viewer),
			}),
		)
		this.ctx.effects.defer(this.core.registerUiSlots({ id: READS_EXT_ID, slots: ['thread.view'] }))
		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: READS_EXT_ID,
				action: 'mark',
				method: 'POST',
				login: true,
				input: MarkInput,
				output: ReadState,
				handle: ({ principal, input }) => this.mark(principal, input.threadId),
			}),
		)
	}

	/**
	 * The viewer's read position on every given thread, in two queries. A thread they never read
	 * is read up to the moment they first looked at a list, so a new member does not meet a
	 * forum of bold titles. Guests have no position.
	 */
	async states(threadIds: readonly string[], viewer: Principal): Promise<Map<string, ReadState>> {
		const states = new Map<string, ReadState>()
		const userId = viewer.userId
		if (userId === null || threadIds.length === 0) return states
		const baseline = await this.baselineOf(userId)
		const rows = await this.database.read((db) =>
			db
				.select({ threadId: threadReads.threadId, readAt: threadReads.readAt })
				.from(threadReads)
				.where(and(eq(threadReads.userId, userId), inArray(threadReads.threadId, [...threadIds]))),
		)
		const readAt = new Map(rows.map((row) => [row.threadId, row.readAt]))
		for (const threadId of threadIds) {
			const at = readAt.get(threadId)
			const through = at !== undefined && at > baseline ? at : baseline
			states.set(threadId, { readThrough: through.toISOString() })
		}
		return states
	}

	/** The member's baseline, created on their first look. */
	private async baselineOf(userId: string): Promise<Date> {
		return this.database.transaction(async (tx) => {
			await tx.insert(readerBaselines).values({ userId }).onConflictDoNothing()
			const [row] = await tx
				.select({ since: readerBaselines.since })
				.from(readerBaselines)
				.where(eq(readerBaselines.userId, userId))
			return row?.since ?? new Date()
		})
	}

	/**
	 * Records that the principal has read a thread up to now and returns the new position. The
	 * core decides whether the thread can be seen; the write only ever moves the position forward,
	 * so a retry or an out-of-order call is safe.
	 */
	async mark(principal: Principal, threadId: string): Promise<ForumResult<ReadState>> {
		const userId = principal.userId
		if (userId === null) return Result.err(failure('unauthenticated', 'auth.required'))
		const located = await this.core.locateThread(principal, threadId)
		if (located.isErr()) return Result.err(located.error)
		const [row] = await this.database.transaction((tx) =>
			tx
				.insert(threadReads)
				.values({ userId, threadId: located.value.threadId })
				.onConflictDoUpdate({
					target: [threadReads.userId, threadReads.threadId],
					set: { readAt: sql`greatest(${threadReads.readAt}, now())` },
				})
				.returning({ readAt: threadReads.readAt }),
		)
		return Result.ok({ readThrough: (row?.readAt ?? new Date()).toISOString() })
	}
}
