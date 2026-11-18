import {
	ForumCorePlugin,
	type IndexablePost,
	type PostAfterWriteEvent,
	type SearchProviderHit,
	type SearchProviderQuery,
	type SearchProviderResult,
} from '@pluxum/core'
import { BasePlugin, Plugin } from '@pluxel/core'
import { Database, type PluginDatabaseHandle } from '@pluxel/services/database'
import { and, count, desc, eq, gt, inArray, lte, notInArray, sql, type SQL } from 'drizzle-orm'
import * as v from 'valibot'
import * as f from 'valibot-form'
import { SearchDatabase, searchDocuments } from './database'
import { SearchWorkbench, type SearchIndexStatus } from './workbench'
import {
	buildSnippetHtml,
	createSearchTokenizer,
	stripMarkup,
	type SearchTokenizer,
} from './tokenize'

export {
	buildSnippetHtml,
	createSearchTokenizer,
	escapeHtml,
	normalizeForSearch,
	stripMarkup,
	type SearchTokenizer,
} from './tokenize'

export const SEARCH_PROVIDER_ID = 'forum-search.pg'
export const SEARCH_POST_HOOK_ID = 'forum-search.indexer'

const BACKFILL_BATCH_SIZE = 200

export const ForumSearchConfig = v.object({
	/** Domain or community words added to Jieba's dictionary; changing them re-indexes every post. */
	customWords: v.optional(
		v.pipe(
			v.array(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(64))),
			f.formMeta({
				title: '自定义词',
				description: '分词时当作一个整体的词，例如产品名。保存后会重建索引。',
			}),
			f.arrayMeta({ itemLabel: '词', addLabel: '添加词', emptyHint: '未添加自定义词' }),
		),
		[],
	),
	/** Length of the excerpt shown under each search hit, in characters. */
	snippetChars: v.optional(
		v.pipe(
			v.number(),
			v.integer(),
			v.minValue(40),
			v.maxValue(600),
			f.formMeta({ title: '摘要长度', description: '搜索结果中每条摘要最多显示的字数。' }),
			f.numberMeta({ step: 20 }),
		),
		160,
	),
})
export type ForumSearchConfig = v.InferOutput<typeof ForumSearchConfig>

type PreparedDocument = Readonly<{
	postId: string
	threadId: string
	categoryId: string
	authorId: string
	opening: boolean
	title: string
	plainBody: string
	titleTokens: string
	bodyTokens: string
	createdAt: Date
}>

type ActiveBackfillState = {
	readonly touchedPosts: Set<string>
	readonly deletedPosts: Set<string>
	readonly deletedThreads: Set<string>
}

function sameWords(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((word, index) => word === b[index])
}

function vectorExpression(titleTokens: string, bodyTokens: string): SQL {
	return sql`setweight(to_tsvector('simple', ${titleTokens}), 'A') || setweight(to_tsvector('simple', ${bodyTokens}), 'B')`
}

/**
 * Full-text search backed by `@node-rs/jieba` segmentation in Node and PostgreSQL's built-in
 * `'simple'` `tsvector` + GIN index (identical behaviour on PGlite and native PostgreSQL).
 *
 * Stopping this plugin withdraws both the `postHooks` listener and the `searchProviders` backend:
 * `/api/forum/meta` reports `search.available: false` and `/api/forum/search` answers 503.
 */
@Plugin({ displayName: 'Forum Search', startTimeoutMs: 60_000 })
export class ForumSearchPlugin extends BasePlugin {
	private readonly config = this.configs.use(ForumSearchConfig)
	private database!: PluginDatabaseHandle<typeof SearchDatabase>
	private tokenizer!: SearchTokenizer
	private activeBackfill: ActiveBackfillState | null = null
	private rebuildInFlight: Promise<number> | null = null
	private lastRebuild: SearchIndexStatus['lastRebuild'] = null

	constructor(private readonly core: ForumCorePlugin) {
		super()
	}

	protected override async init(signal: AbortSignal): Promise<void> {
		this.tokenizer = createSearchTokenizer(this.config.customWords)
		this.database = await this.ctx.require(Database).use(SearchDatabase)
		this.ctx.effects.defer(
			this.core.registerPaletteCommands({
				id: 'forum-search',
				commands: [{ id: 'page', label: '搜索', keywords: ['查找', 'search'], href: '/search' }],
			}),
		)

		// New custom words change how every post is segmented: swap the tokenizer at once, then
		// re-index in the background so searches keep answering while it runs.
		this.configs.onUpdate(this.config, ({ applied, desired, signal: updateSignal }) => {
			if (sameWords(applied.customWords, desired.customWords)) return
			this.tokenizer = createSearchTokenizer(desired.customWords)
			// A rebuild already running may have used the old words for some posts: run another after it.
			const previous = this.rebuildInFlight ?? Promise.resolve(0)
			void previous
				.catch(() => 0)
				.then(() => this.rebuildIndex(updateSignal))
				.then(
					(indexed) =>
						this.ctx.logger.info('search index rebuilt for new custom words', { indexed }),
					(error: unknown) => {
						if (!updateSignal.aborted) this.ctx.logger.error('search re-index failed', { error })
					},
				)
		})

		const stopController = new AbortController()
		const abortFromStartup = () => stopController.abort()
		signal.addEventListener('abort', abortFromStartup, { once: true })
		this.ctx.effects.defer(async () => {
			stopController.abort()
			if (this.rebuildInFlight !== null) {
				await this.rebuildInFlight.catch(() => {})
			}
		})

		// A rebuild started from Workbench runs to the end even if the tab closes; stopping the plugin aborts it.
		this.ctx.workbench?.publish(SearchWorkbench, {
			index: () => this.indexContent(stopController.signal),
		})

		// Register the incremental hook before backfilling so concurrent writes are never missed.
		this.ctx.effects.defer(
			this.core.registerPostHook({
				id: SEARCH_POST_HOOK_ID,
				afterWrite: (event) => this.onPostAfterWrite(event),
			}),
		)

		try {
			await this.rebuildIndex(stopController.signal)
		} finally {
			signal.removeEventListener('abort', abortFromStartup)
		}

		this.ctx.effects.defer(
			this.core.registerSearchProvider({
				id: SEARCH_PROVIDER_ID,
				search: (query) => this.searchPosts(query),
			}),
		)
	}

	/**
	 * Scans visible posts from `forum-core` in batches, upserting current documents and pruning rows
	 * that were deleted while this plugin was stopped. Returns the number of indexed posts.
	 */
	async rebuildIndex(signal?: AbortSignal): Promise<number> {
		if (this.rebuildInFlight !== null) return this.rebuildInFlight
		const run = this.runBackfill(signal).finally(() => {
			if (this.rebuildInFlight === run) this.rebuildInFlight = null
		})
		this.rebuildInFlight = run
		return run
	}

	private async runBackfill(signal?: AbortSignal): Promise<number> {
		const started = Date.now()
		try {
			const indexed = await this.backfill(signal)
			this.recordRebuild(started, 'succeeded', indexed)
			return indexed
		} catch (error) {
			this.recordRebuild(started, 'failed', null)
			throw error
		}
	}

	private recordRebuild(started: number, outcome: 'succeeded' | 'failed', indexed: number | null) {
		this.lastRebuild = {
			finishedAt: new Date().toISOString(),
			outcome,
			indexed,
			durationMs: Date.now() - started,
		}
	}

	private async backfill(signal?: AbortSignal): Promise<number> {
		const state: ActiveBackfillState = {
			touchedPosts: new Set(),
			deletedPosts: new Set(),
			deletedThreads: new Set(),
		}
		this.activeBackfill = state
		try {
			return await this.backfillBatch(undefined, state, signal)
		} finally {
			if (this.activeBackfill === state) this.activeBackfill = null
		}
	}

	private async backfillBatch(
		cursor: string | undefined,
		state: ActiveBackfillState,
		signal?: AbortSignal,
	): Promise<number> {
		signal?.throwIfAborted()
		const batch = await this.core.listIndexablePosts({
			afterPostId: cursor,
			limit: BACKFILL_BATCH_SIZE,
		})
		signal?.throwIfAborted()

		const isLastBatch = batch.length < BACKFILL_BATCH_SIZE
		const lastPostId = batch.at(-1)?.postId
		const rangeConditions: SQL[] = []
		if (cursor !== undefined) {
			rangeConditions.push(gt(searchDocuments.postId, cursor))
		}
		if (!isLastBatch && lastPostId !== undefined) {
			rangeConditions.push(lte(searchDocuments.postId, lastPostId))
		}

		const keepIds = new Set<string>(state.touchedPosts)
		for (const item of batch) {
			if (!state.deletedPosts.has(item.postId) && !state.deletedThreads.has(item.threadId)) {
				keepIds.add(item.postId)
			}
		}

		const toUpsert = batch
			.filter(
				(item) =>
					!state.deletedPosts.has(item.postId) &&
					!state.deletedThreads.has(item.threadId) &&
					!state.touchedPosts.has(item.postId),
			)
			.map((item) => this.prepareIndexable(item))

		await this.database.transaction(async (tx) => {
			const staleWhere =
				keepIds.size > 0
					? and(...rangeConditions, notInArray(searchDocuments.postId, [...keepIds]))
					: rangeConditions.length > 0
						? and(...rangeConditions)
						: undefined
			if (staleWhere !== undefined) {
				await tx.delete(searchDocuments).where(staleWhere)
			} else if (keepIds.size === 0) {
				await tx.delete(searchDocuments)
			}

			if (toUpsert.length > 0) {
				await this.upsertDocuments(tx, toUpsert)
			}
		})

		if (isLastBatch || lastPostId === undefined) return toUpsert.length
		return toUpsert.length + (await this.backfillBatch(lastPostId, state, signal))
	}

	/** The Workbench "索引" tab: index status, a rebuild button and a segmentation tester. */
	private indexContent(stopSignal: AbortSignal) {
		return {
			load: () => this.indexStatus(),
			actions: {
				rebuild: async () => {
					const indexed = await this.rebuildIndex(stopSignal)
					return { ok: true, message: `索引已重建，写入 ${indexed} 条` }
				},
				segment: ({ text }: { text: string }) => {
					const terms = this.tokenizer.tokenizeForQuery(text)
					return { ok: true, message: terms.length > 0 ? terms.join(' / ') : '没有可搜索的词' }
				},
			},
		}
	}

	private async indexStatus(): Promise<{ status: SearchIndexStatus }> {
		const [row] = await this.database.read((db) =>
			db.select({ value: count() }).from(searchDocuments),
		)
		return {
			status: {
				documents: row?.value ?? 0,
				customWords: this.config.customWords.length,
				rebuild: this.rebuildInFlight === null ? 'idle' : 'running',
				lastRebuild: this.lastRebuild,
			},
		}
	}

	private prepareDocument(input: {
		postId: string
		threadId: string
		categoryId: string
		authorId: string
		opening: boolean
		title: string
		body: string
		createdAt: string
	}): PreparedDocument {
		const cleanTitle = stripMarkup(input.title) || input.title.trim()
		const plainBody = stripMarkup(input.body)
		const titleTokens = input.opening ? this.tokenizer.tokenizeForIndex(cleanTitle) : ''
		const bodyTokens = this.tokenizer.tokenizeForIndex(plainBody)
		return {
			postId: input.postId,
			threadId: input.threadId,
			categoryId: input.categoryId,
			authorId: input.authorId,
			opening: input.opening,
			title: input.title,
			plainBody,
			titleTokens,
			bodyTokens,
			createdAt: new Date(input.createdAt),
		}
	}

	private prepareIndexable(item: IndexablePost): PreparedDocument {
		return this.prepareDocument({
			postId: item.postId,
			threadId: item.threadId,
			categoryId: item.categoryId,
			authorId: item.authorId,
			opening: item.opening,
			title: item.threadTitle,
			body: item.body,
			createdAt: item.createdAt,
		})
	}

	private async upsertDocuments(
		tx: Parameters<Parameters<PluginDatabaseHandle<typeof SearchDatabase>['transaction']>[0]>[0],
		docs: readonly PreparedDocument[],
	): Promise<void> {
		if (docs.length === 0) return
		await tx
			.insert(searchDocuments)
			.values(
				docs.map((doc) => ({
					postId: doc.postId,
					threadId: doc.threadId,
					categoryId: doc.categoryId,
					authorId: doc.authorId,
					opening: doc.opening,
					title: doc.title,
					plainBody: doc.plainBody,
					titleTokens: doc.titleTokens,
					bodyTokens: doc.bodyTokens,
					searchVector: vectorExpression(doc.titleTokens, doc.bodyTokens),
					createdAt: doc.createdAt,
				})),
			)
			.onConflictDoUpdate({
				target: searchDocuments.postId,
				set: {
					threadId: sql`excluded.thread_id`,
					categoryId: sql`excluded.category_id`,
					authorId: sql`excluded.author_id`,
					opening: sql`excluded.opening`,
					title: sql`excluded.title`,
					plainBody: sql`excluded.plain_body`,
					titleTokens: sql`excluded.title_tokens`,
					bodyTokens: sql`excluded.body_tokens`,
					searchVector: sql`excluded.search_vector`,
					createdAt: sql`excluded.created_at`,
				},
			})
	}

	private async onPostAfterWrite(event: PostAfterWriteEvent): Promise<void> {
		const backfill = this.activeBackfill
		switch (event.kind) {
			case 'thread.created': {
				backfill?.deletedPosts.delete(event.postId)
				backfill?.deletedThreads.delete(event.threadId)
				backfill?.touchedPosts.add(event.postId)
				const doc = this.prepareDocument({
					postId: event.postId,
					threadId: event.threadId,
					categoryId: event.categoryId,
					authorId: event.authorId,
					opening: true,
					title: event.title,
					body: event.body,
					createdAt: event.createdAt,
				})
				await this.database.transaction((tx) => this.upsertDocuments(tx, [doc]))
				return
			}
			case 'thread.updated': {
				backfill?.touchedPosts.add(event.postId)
				const openingDoc = this.prepareDocument({
					postId: event.postId,
					threadId: event.threadId,
					categoryId: event.categoryId,
					authorId: event.authorId,
					opening: true,
					title: event.title,
					body: event.body,
					createdAt: event.createdAt,
				})
				await this.database.transaction(async (tx) => {
					await this.upsertDocuments(tx, [openingDoc])
					await tx
						.update(searchDocuments)
						.set({ title: event.title, categoryId: event.categoryId })
						.where(
							and(eq(searchDocuments.threadId, event.threadId), eq(searchDocuments.opening, false)),
						)
				})
				return
			}
			case 'thread.deleted': {
				backfill?.deletedThreads.add(event.threadId)
				await this.database.transaction((tx) =>
					tx.delete(searchDocuments).where(eq(searchDocuments.threadId, event.threadId)),
				)
				return
			}
			case 'post.created': {
				backfill?.deletedPosts.delete(event.postId)
				backfill?.touchedPosts.add(event.postId)
				const doc = this.prepareDocument({
					postId: event.postId,
					threadId: event.threadId,
					categoryId: event.categoryId,
					authorId: event.authorId,
					opening: false,
					title: event.threadTitle,
					body: event.body,
					createdAt: event.createdAt,
				})
				await this.database.transaction((tx) => this.upsertDocuments(tx, [doc]))
				return
			}
			case 'post.updated': {
				backfill?.touchedPosts.add(event.postId)
				const doc = this.prepareDocument({
					postId: event.postId,
					threadId: event.threadId,
					categoryId: event.categoryId,
					authorId: event.authorId,
					opening: event.opening,
					title: event.threadTitle,
					body: event.body,
					createdAt: event.createdAt,
				})
				await this.database.transaction((tx) => this.upsertDocuments(tx, [doc]))
				return
			}
			case 'post.deleted': {
				backfill?.deletedPosts.add(event.postId)
				backfill?.touchedPosts.delete(event.postId)
				await this.database.transaction((tx) =>
					tx.delete(searchDocuments).where(eq(searchDocuments.postId, event.postId)),
				)
				return
			}
		}
	}

	private async searchPosts(query: SearchProviderQuery): Promise<SearchProviderResult> {
		if (query.categoryIds.length === 0) {
			return { items: [], total: 0 }
		}
		const queryTerms = this.tokenizer.tokenizeForQuery(query.query)
		if (queryTerms.length === 0) {
			return { items: [], total: 0 }
		}

		const tsquery = sql`plainto_tsquery('simple', ${queryTerms.join(' ')})`
		const conditions: SQL[] = [
			sql`${searchDocuments.searchVector} @@ ${tsquery}`,
			inArray(searchDocuments.categoryId, [...query.categoryIds]),
		]
		if (query.authorId !== undefined) {
			conditions.push(eq(searchDocuments.authorId, query.authorId))
		}
		if (query.threadsOnly) {
			conditions.push(eq(searchDocuments.opening, true))
		}
		const whereClause = and(...conditions)
		const rank = sql<number>`ts_rank_cd(${searchDocuments.searchVector}, ${tsquery})`

		const { rows, total } = await this.database.read(async (db) => {
			const [totalRow] = await db
				.select({ value: count() })
				.from(searchDocuments)
				.where(whereClause)
			const totalCount = totalRow?.value ?? 0
			if (totalCount === 0) {
				return { rows: [], total: 0 }
			}
			const matchedRows = await db
				.select({
					postId: searchDocuments.postId,
					threadId: searchDocuments.threadId,
					categoryId: searchDocuments.categoryId,
					authorId: searchDocuments.authorId,
					opening: searchDocuments.opening,
					title: searchDocuments.title,
					plainBody: searchDocuments.plainBody,
					createdAt: searchDocuments.createdAt,
				})
				.from(searchDocuments)
				.where(whereClause)
				.orderBy(desc(rank), desc(searchDocuments.createdAt), desc(searchDocuments.postId))
				.limit(query.pageSize)
				.offset((query.page - 1) * query.pageSize)
			return { rows: matchedRows, total: totalCount }
		})

		const items: SearchProviderHit[] = rows.map((row) => ({
			postId: row.postId,
			threadId: row.threadId,
			categoryId: row.categoryId,
			authorId: row.authorId,
			opening: row.opening,
			title: row.title,
			snippetHtml: buildSnippetHtml(row.plainBody, queryTerms, this.config.snippetChars),
			createdAt: row.createdAt.toISOString(),
		}))
		return { items, total }
	}
}
