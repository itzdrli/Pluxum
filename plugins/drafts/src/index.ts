import { failure, isEntityId, type Principal } from '@pluxum/domain'
import { ForumApiPlugin } from '@pluxum/api'
import { ForumCorePlugin, type ForumResult, type PostAfterWriteEvent } from '@pluxum/core'
import { BasePlugin, Plugin } from '@pluxel/core'
import { Result } from '@pluxel/core/better-result'
import { Database, type PluginDatabaseHandle } from '@pluxel/services/database'
import { and, desc, eq, inArray, notInArray } from 'drizzle-orm'
import { Type, type Static } from 'typebox'
import { drafts, DraftsDatabase } from './database'

/** The extension's ID: its segment of the ext ingress. */
export const DRAFTS_EXT_ID = 'forum-drafts'

/** A member keeps at most this many drafts; saving one more drops the longest untouched. */
export const DRAFTS_PER_USER = 50

/** Room for a post at the core's limit and some more, so a long draft can still be trimmed later. */
export const DRAFT_BODY_MAX = 40_000

/**
 * Where a draft is written: `topic` and `topic:title` (a new topic), `note` (a new note),
 * `reply:<threadId>` (the thread's reply box) and `reply:<threadId>:<postId>` (answering inside
 * a floor). Clients may use other keys of the same shape; only these are cleared when the post
 * goes out.
 */
const DraftKey = Type.String({ maxLength: 120, pattern: '^[a-z]+(:[A-Za-z0-9_-]{1,64}){0,3}$' })

export const DraftState = Type.Object({
	key: Type.String(),
	body: Type.String(),
	/** When it was last saved; null when there is none. */
	updatedAt: Type.Union([Type.String(), Type.Null()]),
})
export type DraftState = Static<typeof DraftState>

const SaveInput = Type.Object({
	key: DraftKey,
	/** Blank text removes the draft. */
	body: Type.String({ maxLength: DRAFT_BODY_MAX }),
})

/** The draft keys a committed write uses up for its author. */
export function spentKeys(event: PostAfterWriteEvent): string[] {
	if (event.kind === 'thread.created') {
		return event.threadKind === 'note' ? ['note'] : ['topic', 'topic:title']
	}
	if (event.kind === 'post.created') {
		return [
			event.parentId === null
				? `reply:${event.threadId}`
				: `reply:${event.threadId}:${event.parentId}`,
		]
	}
	return []
}

/**
 * Drafts kept on the server, so writing started on one device continues on another. Clients save
 * the text of a box as it is typed (`save`) and read it back when the box opens (`get`); a thread
 * or reply going out clears its draft. Contributes:
 * - `extActions` `get` and `save` under `/api/forum/ext/forum-drafts`;
 * - a post hook that clears the drafts a committed thread or reply used up.
 *
 * Stopping it leaves writing as it was before: nothing is saved, and boxes open empty.
 */
// PGlite compiles its WASM module on first use, which can exceed the default start timeout.
@Plugin({ displayName: 'Pluxum Drafts', startTimeoutMs: 30_000 })
export class ForumDraftsPlugin extends BasePlugin {
	private database!: PluginDatabaseHandle<typeof DraftsDatabase>

	constructor(
		private readonly core: ForumCorePlugin,
		private readonly api: ForumApiPlugin,
	) {
		super()
	}

	protected override async init(): Promise<void> {
		this.database = await this.ctx.require(Database).use(DraftsDatabase)
		this.ctx.effects.defer(
			this.core.registerUserRemoval({
				id: `${DRAFTS_EXT_ID}.removal`,
				remove: ({ userId }) =>
					this.database.transaction(async (tx) => {
						await tx.delete(drafts).where(eq(drafts.userId, userId))
					}),
			}),
		)
		this.ctx.effects.defer(
			this.core.registerPostHook({
				id: `${DRAFTS_EXT_ID}.spent`,
				afterWrite: (event) => this.clearSpent(event),
			}),
		)
		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: DRAFTS_EXT_ID,
				action: 'get',
				method: 'GET',
				login: true,
				input: Type.Object({ key: DraftKey }),
				output: DraftState,
				handle: ({ principal, input }) => this.get(principal, input.key),
			}),
		)
		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: DRAFTS_EXT_ID,
				action: 'save',
				method: 'POST',
				login: true,
				input: SaveInput,
				output: DraftState,
				handle: ({ principal, input }) => this.save(principal, input.key, input.body),
			}),
		)
	}

	async get(principal: Principal, key: string): Promise<ForumResult<DraftState>> {
		const userId = principal.userId
		if (userId === null) return Result.err(failure('unauthenticated', 'auth.required'))
		const [row] = await this.database.read((db) =>
			db
				.select({ body: drafts.body, updatedAt: drafts.updatedAt })
				.from(drafts)
				.where(and(eq(drafts.userId, userId), eq(drafts.key, key))),
		)
		return Result.ok({
			key,
			body: row?.body ?? '',
			updatedAt: row?.updatedAt.toISOString() ?? null,
		})
	}

	/** Saves the text of a box, or removes the draft when the text is blank. */
	async save(principal: Principal, key: string, body: string): Promise<ForumResult<DraftState>> {
		const userId = principal.userId
		if (userId === null) return Result.err(failure('unauthenticated', 'auth.required'))
		if (body.trim() === '') {
			await this.database.transaction((tx) =>
				tx.delete(drafts).where(and(eq(drafts.userId, userId), eq(drafts.key, key))),
			)
			return Result.ok({ key, body: '', updatedAt: null })
		}
		const updatedAt = await this.database.transaction(async (tx) => {
			const now = new Date()
			await tx
				.insert(drafts)
				.values({ userId, key, body, updatedAt: now })
				.onConflictDoUpdate({ target: [drafts.userId, drafts.key], set: { body, updatedAt: now } })
			// Over the limit: keep the newest ones.
			const kept = tx
				.select({ key: drafts.key })
				.from(drafts)
				.where(eq(drafts.userId, userId))
				.orderBy(desc(drafts.updatedAt))
				.limit(DRAFTS_PER_USER)
			await tx.delete(drafts).where(and(eq(drafts.userId, userId), notInArray(drafts.key, kept)))
			return now
		})
		return Result.ok({ key, body, updatedAt: updatedAt.toISOString() })
	}

	private async clearSpent(event: PostAfterWriteEvent): Promise<void> {
		const keys = spentKeys(event)
		const userId = event.principal.userId
		if (keys.length === 0 || userId === null || !isEntityId(userId)) return
		await this.database.transaction((tx) =>
			tx.delete(drafts).where(and(eq(drafts.userId, userId), inArray(drafts.key, keys))),
		)
	}
}
