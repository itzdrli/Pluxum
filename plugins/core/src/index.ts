import {
	placeholderUser,
	errorDetail,
	failure,
	failureOf,
	type EntityName,
	type ErrorArgs,
	type ErrorDetail,
	type ErrorKey,
	bodyLength,
	defaultRolePolicy,
	deriveHandleBase,
	evaluatePolicies,
	formatThreadRef,
	GUEST,
	isAssignableRole,
	isEntityId,
	normalizePage,
	parseThreadRef,
	parseUserRef,
	ROLES,
	slugify,
	slugifyAsciiTitle,
	validateCategoryDescription,
	validateCategoryName,
	validateDisplayName,
	validateHandle,
	validatePostBody,
	validateSearchQuery,
	validateSlug,
	validateThreadTitle,
	type AssignableRole,
	type BodyFormat,
	type CategoryDto,
	type CategoryKind,
	type CategorySummaryDto,
	type FloorLocationDto,
	type CommunityDto,
	type PaletteCommandDto,
	type CategoryThreadsDto,
	type ForumAction,
	type ForumError,
	type ForumErrorCode,
	type ForumNotification,
	type ForumResource,
	type PageDto,
	type PageRequest,
	type PostDto,
	type PreviewDto,
	type Principal,
	type RecentThreadDto,
	type RecentThreadsDto,
	type Role,
	type SearchHitDto,
	type SearchPageDto,
	type SearchRequest,
	type ThreadDetailDto,
	type ThreadDto,
	type ThreadKind,
	type UiSlotDto,
	type FooterDto,
	type SiteDto,
	type UserDto,
	type UserProfileDto,
} from '@pluxum/domain'
import { BasePlugin, Plugin } from '@pluxel/core'
import { Result } from '@pluxel/core/better-result'
import {
	Database,
	type PluginDatabaseClient,
	type PluginDatabaseHandle,
} from '@pluxel/services/database'
import {
	and,
	asc,
	count,
	desc,
	eq,
	gt,
	gte,
	ilike,
	inArray,
	isNull,
	lte,
	or,
	sql,
	type SQL,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
	categories,
	ForumDatabase,
	postRevisions,
	posts,
	threads,
	userRoles,
	users,
} from './database'
import {
	ContentRendererRegistry,
	type ContentRendererContribution,
	type RenderedBody,
} from './content'
import {
	EntityExtensionRegistry,
	UiSlotRegistry,
	type EntityExtensionContribution,
	type ExtendableEntity,
	type UiSlotContribution,
} from './extensions'
import {
	PostHookRegistry,
	type PostAdmitEvent,
	type PostAfterWriteEvent,
	type PostBeforeWriteEvent,
	type PostHookContribution,
} from './hooks'
import { digest, ForumCacheRegistry, type ForumCacheContribution } from './cache'
import { FollowGraphRegistry, type FollowGraphContribution } from './follow-graph'
import {
	isCategoryListing,
	isCommunityListing,
	isThreadListing,
	type CategoryListing,
	type CommunityListing,
	type OpeningSource,
	type ThreadListing,
} from './listings'
import { ForumAdminTarget } from './admin-target'
import { ForumCoreConfig } from './config'
import { FooterLinkRegistry, type FooterLinkContribution } from './footer'
import { PaletteCommandRegistry, type PaletteCommandContribution } from './palette'
import { ForumCoreWorkbench } from './workbench'
import { NotificationChannelRegistry, type NotificationChannelContribution } from './notifications'
import { PolicyRegistry, type PermissionPolicyContribution } from './policies'
import {
	sanitizeSearchSnippet,
	SearchProviderRegistry,
	type SearchProviderContribution,
} from './search'

export type { ContentRendererContribution } from './content'
export { ForumCoreConfig } from './config'
export {
	FOOTER_GROUP_MAX,
	FOOTER_LABEL_MAX,
	FOOTER_LINKS_MAX,
	FOOTER_NOTE_MAX,
	FOOTER_NOTES_MAX,
	isFooterHref,
} from './footer'

/** A page of accounts for admin tooling (`listUsers`). */
export type UserListDto = Readonly<{
	items: ReadonlyArray<
		Readonly<{
			id: string
			handle: string
			displayName: string
			number: number
			createdAt: string
			roles: AssignableRole[]
		}>
	>
	total: number
	page: number
	pageSize: number
}>
export type { FooterLinkContribution } from './footer'
export type { PaletteCommandContribution, PaletteCommandInput } from './palette'
export type {
	EntityExtensionContribution,
	ExtendableEntity,
	UiSlotContribution,
} from './extensions'
export { answeredAuthorOf, threadPlace } from './hooks'
export type {
	PostAdmitEvent,
	PostAdmitRejection,
	PostAfterWriteEvent,
	PostBeforeWriteEvent,
	PostHookContribution,
	PostHookRejection,
	PostHookRejectionCode,
} from './hooks'
export type { ForumCacheContribution } from './cache'
export type { FollowGraphContribution, Followed } from './follow-graph'
export type { NotificationChannelContribution } from './notifications'
export type { PermissionPolicyContribution } from './policies'
export type {
	SearchProviderContribution,
	SearchProviderHit,
	SearchProviderQuery,
	SearchProviderResult,
} from './search'

/** Every forum operation resolves to its value or an expected, user-presentable failure. */
export type ForumResult<T> = Result<T, ForumError>

/** How the cross-category thread list is ordered; see `listRecentThreads`. */
export type RecentSort = 'active' | 'new' | 'hot'
/** Which threads it lists: everything the viewer may see, or only what they follow. */
export type RecentScope = 'all' | 'following'
export type RecentThreadsFilter = Readonly<{ sort?: RecentSort; scope?: RecentScope }>

/** `hot` only ranks threads with activity this recently, so old long threads do not stay on top. */
const HOT_WINDOW_DAYS = 30

/** The community panel counts posts this recent, and lists this many members in each of its lists. */
const ACTIVE_WINDOW_DAYS = 7
const COMMUNITY_LIST_SIZE = 5
/** Listings past this page are read fresh: few people go there, and keys stay bounded. */
const CACHED_PAGES = 3
/** Replies inside a floor that ride along with it on the thread page; the rest load on request. */
const REPLY_PREVIEW = 3
/** At most this many replies of the floor a link points into are shown along with it. */
const REPLY_EXPAND_MAX = 100

export type CreateCategoryInput = Readonly<{
	name: string
	/** Derived from the name when omitted; required for names without ASCII letters or digits. */
	slug?: string
	description?: string
	position?: number
}>
export type UpdateCategoryInput = Readonly<{
	name?: string
	slug?: string
	description?: string
	position?: number
}>
/** A note goes to a `stream` category with an empty `title`. */
export type CreateThreadInput = Readonly<{ categoryId: string; title: string; body: string }>
/**
 * `categoryId` moves the thread (the author, if they may start threads there, or a moderator).
 * Moving a note to a board turns it into a topic and needs a `title`.
 */
export type UpdateThreadInput = Readonly<{
	title?: string
	pinned?: boolean
	locked?: boolean
	categoryId?: string
}>
/**
 * `parentId`: the post this one answers. Answering a reply inside a floor puts the new reply in
 * the same floor (one level only); answering the opening post is an ordinary reply.
 */
export type CreatePostInput = Readonly<{ threadId: string; body: string; parentId?: string }>
/** `expandFloor`: a top-level floor on the page whose replies are all included (a link into it). */
export type ThreadPageRequest = PageRequest & Readonly<{ expandFloor?: number }>
export type ProfilePageRequest = PageRequest & Readonly<{ kind?: ThreadKind }>
export type UpdatePostInput = Readonly<{ body: string }>
export type EnsureUserInput = Readonly<{
	subject: string
	displayName: string
	handleHint?: string
}>

export type UpdateProfileInput = Readonly<{ displayName?: string; handle?: string }>

/**
 * A post that exists and that the asking principal may see, as extension plugins need it: the
 * stable IDs to key their own rows by, and the facts permission checks take.
 */
export type PostLocation = Readonly<{
	postId: string
	threadId: string
	/** Canonical URL segment of the thread (`1001` or `1001-ascii-slug`). */
	threadRef: string
	/** 1-based floor number of the post inside its thread. */
	postNumber: number
	/** Whether it sits in a topic or a note. */
	threadKind: ThreadKind
	/** Author of the thread it belongs to. */
	threadAuthorId: string
	authorId: string
	/** Source text as written. */
	body: string
	resource: ForumResource
}>

/** A thread an extension may act on: its stable ID and URL segment, and what permission checks take. */
export type ThreadLocation = Readonly<{
	threadId: string
	threadRef: string
	resource: ForumResource
}>

/** A visible post and its thread facts, for search index backfill. */
export type IndexablePost = Readonly<{
	postId: string
	threadId: string
	categoryId: string
	authorId: string
	opening: boolean
	threadTitle: string
	body: string
	createdAt: string
}>

// The query surface shared by read callbacks and transactions.
type Db = Pick<PluginDatabaseClient<typeof ForumDatabase>, 'select'>

const BUILT_IN_POLICY_ID = 'forum-core.roles'

const fail = <K extends ErrorKey>(
	code: ForumErrorCode,
	key: K,
	...args: ErrorArgs<K>
): Result<never, ForumError> => Result.err(failure(code, key, ...args))
const failDetail = (code: ForumErrorCode, detail: ErrorDetail): Result<never, ForumError> =>
	Result.err(failureOf(code, detail))
const notFound = (entity: EntityName) => fail('not_found', 'entity.not_found', { entity })
const invalid = (detail: ErrorDetail) => failDetail('invalid', detail)
const denied = (principal: Principal) =>
	principal.userId === null
		? fail('unauthenticated', 'auth.required')
		: fail('forbidden', 'permission.denied')

/** Postgres `unique_violation`, possibly wrapped by the query builder in `cause`. */
function isUniqueViolation(error: unknown): boolean {
	for (let current = error, depth = 0; current && depth < 4; depth++) {
		if (typeof current !== 'object') return false
		if ((current as { code?: unknown }).code === '23505') return true
		current = (current as { cause?: unknown }).cause
	}
	return false
}

const author = { id: users.id, handle: users.handle, displayName: users.displayName }
const replyToUsers = alias(users, 'reply_to_users')
const replyTo = {
	id: replyToUsers.id,
	handle: replyToUsers.handle,
	displayName: replyToUsers.displayName,
}

const kindOf = (category: CategoryKind): ThreadKind => (category === 'stream' ? 'note' : 'topic')

/** A user joined through a left join: all null when there is none. */
function userOrNull(
	row: Readonly<{ id: string | null; handle: string | null; displayName: string | null }> | null,
): UserDto | null {
	return row?.id && row.handle !== null && row.displayName !== null
		? { id: row.id, handle: row.handle, displayName: row.displayName }
		: null
}

type CategoryRow = typeof categories.$inferSelect
type ThreadRow = typeof threads.$inferSelect
type PostRow = typeof posts.$inferSelect

function toCategoryDto(row: CategoryRow): CategoryDto {
	return {
		id: row.id,
		slug: row.slug,
		name: row.name,
		description: row.description,
		position: row.position,
		kind: row.kind,
		threadCount: row.threadCount,
		postCount: row.postCount,
	}
}

function toThreadDto(row: ThreadRow, by: UserDto, category: CategoryKind): ThreadDto {
	return {
		id: row.id,
		number: row.number,
		slug: row.slug,
		ref: formatThreadRef(row.number, row.slug),
		categoryId: row.categoryId,
		kind: kindOf(category),
		title: row.title,
		author: { id: by.id, handle: by.handle, displayName: by.displayName },
		createdAt: row.createdAt.toISOString(),
		lastPostAt: row.lastPostAt.toISOString(),
		replyCount: row.replyCount,
		pinned: row.pinned,
		locked: row.locked,
		ext: {},
	}
}

/**
 * The forum's core domain: users and roles, categories, threads and posts, plus the registries
 * through which extension plugins contribute behaviour. It owns no HTTP routes; forum-api is the
 * ingress. Every operation takes the acting principal and enforces permissions itself.
 */
// PGlite compiles its WASM module on first use, which can exceed the default start timeout.
@Plugin({ displayName: 'Forum Core', startTimeoutMs: 30_000 })
export class ForumCorePlugin extends BasePlugin {
	private readonly config = this.configs.use(ForumCoreConfig)
	private database!: PluginDatabaseHandle<typeof ForumDatabase>
	private readonly permissionPolicies = new PolicyRegistry()
	private readonly contentRenderers = new ContentRendererRegistry()
	private readonly entityExtensions = new EntityExtensionRegistry()
	private readonly uiSlotContributions = new UiSlotRegistry()
	private readonly footerLinks = new FooterLinkRegistry()
	private readonly paletteCommands = new PaletteCommandRegistry()
	private readonly postHooks = new PostHookRegistry()
	private readonly notificationChannels = new NotificationChannelRegistry()
	private readonly searchProviders = new SearchProviderRegistry()
	private readonly cache = new ForumCacheRegistry()
	private readonly followGraph = new FollowGraphRegistry()
	/** Bumped whenever the content renderer changes, so cached HTML of the old one is not served. */
	private renderGeneration = 0

	protected override async init(): Promise<void> {
		this.database = await this.ctx.require(Database).use(ForumDatabase)
		this.permissionPolicies.register({ id: BUILT_IN_POLICY_ID, evaluate: defaultRolePolicy })
		// Site and footer settings are read per request; a saved change applies as is.
		this.configs.onUpdate(this.config, () => {})
		// Workbench "论坛管理": categories and account roles, acting as a forum admin.
		this.ctx.workbench?.publish(ForumCoreWorkbench, { admin: () => new ForumAdminTarget(this) })
	}

	// ── Permissions ─────────────────────────────────────────────────────────────────────────

	/**
	 * Adds a policy to the permission chain. Any policy may deny; at least one must allow.
	 * The returned disposer must be handed to the contributor's `ctx.effects` so the policy is
	 * withdrawn when that plugin stops. Throws on an invalid or duplicate ID.
	 */
	registerPermissionPolicy(contribution: PermissionPolicyContribution): () => void {
		return this.permissionPolicies.register(contribution)
	}

	/** IDs of the registered permission policies, in evaluation order. */
	permissionPolicyIds(): string[] {
		return this.permissionPolicies.ids()
	}

	can(principal: Principal, action: ForumAction, resource: ForumResource = {}): boolean {
		return evaluatePolicies(this.permissionPolicies.policies(), { principal, action, resource })
	}

	// ── Content ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Installs the renderer that turns post source into HTML; the core filters its output against
	 * the forum's allowlist. Without one, posts are shown as plain text. The returned disposer must
	 * be handed to the contributor's `ctx.effects`. Throws on an invalid ID or when a renderer is
	 * already installed: one renderer serves the whole forum.
	 */
	registerContentRenderer(contribution: ContentRendererContribution): () => void {
		const dispose = this.contentRenderers.register(contribution)
		this.rendererChanged()
		let disposed = false
		return () => {
			if (disposed) return
			disposed = true
			dispose()
			this.rendererChanged()
		}
	}

	private rendererChanged(): void {
		this.renderGeneration += 1
		this.cache.clearRendered((error, cacheId) =>
			this.ctx.logger.error('cache failed to drop rendered posts', { error, cacheId }),
		)
	}

	// ── Cache ───────────────────────────────────────────────────────────────────────────────

	/**
	 * Installs the cache the core keeps rendered posts and listings in (see `ForumCacheContribution`).
	 * Without one, everything is read fresh. The returned disposer must be handed to the
	 * contributor's `ctx.effects`. Throws on an invalid ID or when a cache is already installed.
	 */
	registerCache(contribution: ForumCacheContribution): () => void {
		return this.cache.register(contribution)
	}

	/** ID of the installed cache, or null while the core reads everything fresh. */
	cacheId(): string | null {
		return this.cache.id()
	}

	// ── Follows ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Installs the follow graph the 「关注」 feed is built from (see `FollowGraphContribution`).
	 * Without one there is no such feed. The returned disposer must be handed to the contributor's
	 * `ctx.effects`. Throws on an invalid ID or when a graph is already installed.
	 */
	registerFollowGraph(contribution: FollowGraphContribution): () => void {
		return this.followGraph.register(contribution)
	}

	/** ID of the installed follow graph, or null while there is none. */
	followGraphId(): string | null {
		return this.followGraph.id()
	}

	/**
	 * Whether the viewer has a 「关注」 feed (a graph is installed and they are signed in) and
	 * whether they follow anything yet.
	 */
	async followingOf(principal: Principal): Promise<Readonly<{ available: boolean; any: boolean }>> {
		if (principal.userId === null || this.followGraph.id() === null) {
			return { available: false, any: false }
		}
		const followed = await this.followedBy(principal.userId)
		return {
			available: true,
			any: followed !== null && followed.userIds.length + followed.categoryIds.length > 0,
		}
	}

	private followedBy(userId: string) {
		return this.followGraph.following(userId, (error, graphId) =>
			this.ctx.logger.error('follow graph failed; the following feed is empty', {
				error,
				graphId,
			}),
		)
	}

	/** Drops every cached listing. Called after each write that changes what a listing shows. */
	private async listingsChanged(): Promise<void> {
		await this.cache.clearListings((error, cacheId) =>
			this.ctx.logger.error('cache failed to drop listings; they may be stale until they expire', {
				error,
				cacheId,
			}),
		)
	}

	private cachedListing<V>(
		key: string,
		load: () => Promise<V>,
		parse: (value: unknown) => value is V,
	): Promise<V> {
		return this.cache.listing(key, load, parse, (error, cacheId) =>
			this.ctx.logger.error('cache failed; reading the listing fresh', { error, cacheId, key }),
		)
	}

	/** ID of the installed content renderer, or null while posts are shown as plain text. */
	contentRendererId(): string | null {
		return this.contentRenderers.id()
	}

	/** How posts are rendered right now: `plain` while no renderer is installed. */
	contentFormat(): BodyFormat {
		return this.contentRenderers.format()
	}

	/** Renders a post body exactly as a saved post would be shown, without saving anything. */
	previewBody(source: string): ForumResult<PreviewDto> {
		const body = validatePostBody(source)
		if (!body.ok) return invalid(body.error)
		const rendered = this.contentRenderers.render(body.value, (error, rendererId) =>
			this.ctx.logger.error('content renderer failed; previewing as plain text', {
				error,
				rendererId,
			}),
		)
		return Result.ok({ bodyHtml: rendered.html, bodyFormat: rendered.format })
	}

	// ── Extensions ──────────────────────────────────────────────────────────────────────────

	/**
	 * Lets an extension plugin attach its own data to every thread or post DTO under `ext[id]`.
	 * The extension keeps that data in its own tables and returns it for a whole page at once.
	 * The returned disposer must be handed to the contributor's `ctx.effects`. Throws on an invalid
	 * ID or when the ID is already registered for the same entity.
	 */
	registerEntityExtension(contribution: EntityExtensionContribution): () => void {
		return this.entityExtensions.register(contribution)
	}

	/** IDs of the extensions that attach data to the given entity. */
	entityExtensionIds(entity: ExtendableEntity): string[] {
		return this.entityExtensions.ids(entity)
	}

	/**
	 * Declares which frontend slots an extension fills while it runs. The returned disposer must be
	 * handed to the contributor's `ctx.effects`. Throws on an invalid or duplicate ID and on an
	 * unknown slot name.
	 */
	registerUiSlots(contribution: UiSlotContribution): () => void {
		return this.uiSlotContributions.register(contribution)
	}

	/** The slots filled by running extensions, in display order. */
	uiSlots(): UiSlotDto[] {
		return this.uiSlotContributions.list()
	}

	/**
	 * Puts links in the site footer while the contributor runs: text links in a titled column
	 * and/or icon links. Plain data, so the plugin needs no frontend code. The returned disposer
	 * must be handed to the contributor's `ctx.effects`. Throws on an invalid or duplicate ID, an
	 * unsafe href (only forum paths and http(s) URLs), an unknown icon or an over-long label.
	 */
	registerFooterLinks(contribution: FooterLinkContribution): () => void {
		return this.footerLinks.register(contribution)
	}

	/**
	 * Puts commands in the command palette while the contributor runs: places to go, as plain
	 * data, so the plugin needs no frontend code. The returned disposer must be handed to the
	 * contributor's `ctx.effects`. Throws on an invalid or duplicate ID, an unsafe href (only
	 * forum paths and http(s) URLs), an unknown role or an over-long text.
	 */
	registerPaletteCommands(contribution: PaletteCommandContribution): () => void {
		return this.paletteCommands.register(contribution)
	}

	/** The palette commands running plugins offer the principal. */
	paletteCommandsFor(principal: Principal): PaletteCommandDto[] {
		return this.paletteCommands.list(principal)
	}

	/** The site's name and blurbs from config. */
	site(): SiteDto {
		return { ...this.config.site }
	}

	/** The footer: what running plugins registered (see `registerFooterLinks`). */
	footer(): FooterDto {
		return {
			...this.footerLinks.list(),
			notes: this.footerLinks.notes(),
			siteLinks: this.footerLinks.siteLinks(),
		}
	}

	/** How long a note's body may be (code points), from config. */
	noteBodyMax(): number {
		return this.config.social.noteBodyMax
	}

	/**
	 * The stream notes are posted to, when the viewer may see it, and whether they may post there.
	 * Null without one.
	 */
	async streamFor(
		principal: Principal,
	): Promise<Readonly<{ category: CategorySummaryDto; canPost: boolean }> | null> {
		const [row] = await this.database.read((db) =>
			db
				.select({ id: categories.id, slug: categories.slug, name: categories.name })
				.from(categories)
				.where(eq(categories.kind, 'stream'))
				.orderBy(asc(categories.position), asc(categories.id))
				.limit(1),
		)
		if (!row || !this.can(principal, 'category.view', { categoryId: row.id })) return null
		return {
			category: row,
			canPost: this.can(principal, 'thread.create', { categoryId: row.id }),
		}
	}

	/**
	 * Privileged, for extensions that count interaction (likes, ...): adds `delta` points to a
	 * thread's engagement, which ranks it in "hot" along with its replies. Never goes below zero.
	 * The cached "hot" pages pick it up with the next write or when they expire.
	 */
	async adjustEngagement(threadId: string, delta: number): Promise<void> {
		if (!isEntityId(threadId) || !Number.isSafeInteger(delta) || delta === 0) return
		await this.database.transaction((tx) =>
			tx
				.update(threads)
				.set({ engagement: sql`greatest(0, ${threads.engagement} + ${delta})` })
				.where(eq(threads.id, threadId)),
		)
	}

	/**
	 * Registers pre-write checks and/or post-write listeners for threads and posts. The returned
	 * disposer must be handed to the contributor's `ctx.effects`. Throws on an invalid or duplicate
	 * ID and when neither `beforeWrite` nor `afterWrite` is given.
	 */
	registerPostHook(contribution: PostHookContribution): () => void {
		return this.postHooks.register(contribution)
	}

	/** IDs of the registered post hooks, in registration order. */
	postHookIds(): string[] {
		return this.postHooks.ids()
	}

	/**
	 * Registers a notification delivery channel (in-app inbox, email bridge, etc.). The returned
	 * disposer must be handed to the contributor's `ctx.effects`. Throws on an invalid or duplicate
	 * ID.
	 */
	registerNotificationChannel(contribution: NotificationChannelContribution): () => void {
		return this.notificationChannels.register(contribution)
	}

	/** IDs of the registered notification channels, in registration order. */
	notificationChannelIds(): string[] {
		return this.notificationChannels.ids()
	}

	/**
	 * Delivers a notification through every running notification channel and returns the IDs of the
	 * channels that succeeded. A channel that fails or times out is logged and does not block the
	 * others.
	 */
	async deliverNotification(notification: ForumNotification): Promise<string[]> {
		return this.notificationChannels.deliver(notification, (error, channelId) =>
			this.ctx.logger.error('notification channel failed', {
				error,
				channelId,
				notificationId: notification.id,
			}),
		)
	}

	/**
	 * Installs the forum's search backend. The returned disposer must be handed to the
	 * contributor's `ctx.effects`. Throws on an invalid ID or when a search provider is already
	 * installed: one search provider serves the whole forum.
	 */
	registerSearchProvider(contribution: SearchProviderContribution): () => void {
		return this.searchProviders.register(contribution)
	}

	/** ID of the installed search provider, or null while search is disabled. */
	searchProviderId(): string | null {
		return this.searchProviders.id()
	}

	/** Whether a search provider is currently installed. */
	searchAvailable(): boolean {
		return this.searchProviders.available()
	}

	/**
	 * Searches visible posts through the installed search provider, narrows the scope to categories
	 * the principal may view, resolves author names and strips unsafe HTML from snippets.
	 */
	async search(principal: Principal, request: SearchRequest): Promise<ForumResult<SearchPageDto>> {
		if (!this.searchProviders.available()) return fail('unavailable', 'search.disabled')
		const query = validateSearchQuery(request.query)
		if (!query.ok) return invalid(query.error)
		if (request.categoryId !== undefined && !isEntityId(request.categoryId)) {
			return notFound('category')
		}
		let resolvedAuthorId: string | undefined
		if (request.authorId !== undefined) {
			const parsedAuthor = parseUserRef(request.authorId)
			if (!parsedAuthor) return notFound('user')
			if (parsedAuthor.kind === 'id') {
				resolvedAuthorId = parsedAuthor.id
			} else {
				const [foundAuthor] = await this.database.read((db) =>
					db.select({ id: users.id }).from(users).where(eq(users.handle, parsedAuthor.handle)),
				)
				if (!foundAuthor) return notFound('user')
				resolvedAuthorId = foundAuthor.id
			}
		}
		const { page, pageSize } = normalizePage(request)
		const visibleCategories = await this.listCategories(principal)
		const visibleIds = new Set(visibleCategories.map((category) => category.id))
		let categoryIds: string[]
		if (request.categoryId !== undefined) {
			if (!visibleIds.has(request.categoryId)) return notFound('category')
			categoryIds = [request.categoryId]
		} else {
			categoryIds = [...visibleIds]
		}
		if (categoryIds.length === 0) {
			return Result.ok({ items: [], page, pageSize, total: 0 })
		}
		const raw = await this.searchProviders.search(
			{
				query: query.value,
				categoryIds,
				authorId: resolvedAuthorId,
				threadsOnly: request.threadsOnly ?? false,
				page,
				pageSize,
			},
			(error, providerId) => this.ctx.logger.error('search provider failed', { error, providerId }),
		)
		if (!raw) return fail('unavailable', 'search.unavailable')
		const hits = raw.items.filter((hit) => visibleIds.has(hit.categoryId))
		const authorIds = [...new Set(hits.map((hit) => hit.authorId).filter(isEntityId))]
		const threadIds = [...new Set(hits.map((hit) => hit.threadId).filter(isEntityId))]
		const postIds = [...new Set(hits.map((hit) => hit.postId).filter(isEntityId))]
		const { authorRows, threadRows, postRows } = await this.database.read(async (db) => {
			const [authors, threadMeta, postMeta] = await Promise.all([
				authorIds.length === 0
					? []
					: db.select(author).from(users).where(inArray(users.id, authorIds)),
				threadIds.length === 0
					? []
					: db
							.select({ id: threads.id, number: threads.number, slug: threads.slug })
							.from(threads)
							.where(inArray(threads.id, threadIds)),
				postIds.length === 0
					? []
					: db
							.select({ id: posts.id, number: posts.number })
							.from(posts)
							.where(inArray(posts.id, postIds)),
			])
			return { authorRows: authors, threadRows: threadMeta, postRows: postMeta }
		})
		const authorsById = await this.extendedUsers(principal, authorRows)
		const threadRefById = new Map(
			threadRows.map((row) => [row.id, formatThreadRef(row.number, row.slug)]),
		)
		const postNumberById = new Map(postRows.map((row) => [row.id, row.number]))
		const items: SearchHitDto[] = hits.map((hit) => ({
			postId: hit.postId,
			postNumber: postNumberById.get(hit.postId) ?? 1,
			threadId: hit.threadId,
			threadRef: threadRefById.get(hit.threadId) ?? hit.threadId,
			categoryId: hit.categoryId,
			opening: hit.opening,
			title: hit.title,
			snippetHtml: sanitizeSearchSnippet(hit.snippetHtml),
			author: authorsById.get(hit.authorId) ?? placeholderUser(hit.authorId),
			createdAt: hit.createdAt,
		}))
		return Result.ok({ items, page, pageSize, total: raw.total })
	}

	/**
	 * For search index backfill: scans visible (not deleted) posts in ascending `postId` order so
	 * an indexer plugin can populate its own tables in batches without importing core tables.
	 */
	async listIndexablePosts(
		options: { afterPostId?: string; limit?: number } = {},
	): Promise<IndexablePost[]> {
		const limit =
			Number.isSafeInteger(options.limit) && options.limit! >= 1
				? Math.min(options.limit!, 500)
				: 100
		const afterPostId =
			options.afterPostId !== undefined && isEntityId(options.afterPostId)
				? options.afterPostId
				: undefined
		const rows = await this.database.read((db) =>
			db
				.select({
					postId: posts.id,
					threadId: posts.threadId,
					categoryId: threads.categoryId,
					authorId: posts.authorId,
					opening: posts.opening,
					threadTitle: threads.title,
					body: posts.body,
					createdAt: posts.createdAt,
				})
				.from(posts)
				.innerJoin(threads, eq(threads.id, posts.threadId))
				.where(
					and(
						isNull(posts.deletedAt),
						isNull(threads.deletedAt),
						afterPostId === undefined ? undefined : gt(posts.id, afterPostId),
					),
				)
				.orderBy(asc(posts.id))
				.limit(limit),
		)
		return rows.map((row) => ({
			...row,
			createdAt: row.createdAt.toISOString(),
		}))
	}

	/**
	 * For extension plugins: confirms that a post exists, is not deleted and is visible to the
	 * principal, and returns what a permission check on it needs.
	 */
	async locatePost(principal: Principal, postId: string): Promise<ForumResult<PostLocation>> {
		if (!isEntityId(postId)) return notFound('post')
		const found = await this.database.read((db) => this.findPost(db, principal, postId))
		if (!found) return notFound('post')
		return Result.ok({
			postId: found.post.id,
			threadId: found.thread.id,
			threadRef: formatThreadRef(found.thread.number, found.thread.slug),
			postNumber: found.post.number,
			threadKind: kindOf(found.kind),
			threadAuthorId: found.thread.authorId,
			authorId: found.post.authorId,
			body: found.post.body,
			resource: this.postResource(found.post, found.thread),
		})
	}

	/**
	 * For extension plugins: confirms that a thread exists, is not deleted and is visible to the
	 * principal, and returns what a permission check on it needs.
	 */
	async locateThread(principal: Principal, threadId: string): Promise<ForumResult<ThreadLocation>> {
		if (!isEntityId(threadId)) return notFound('thread')
		const found = await this.database.read((db) => this.findThread(db, threadId))
		if (!found || !this.can(principal, 'thread.view', this.threadResource(found.thread))) {
			return notFound('thread')
		}
		return Result.ok({
			threadId: found.thread.id,
			threadRef: formatThreadRef(found.thread.number, found.thread.slug),
			resource: this.threadResource(found.thread),
		})
	}

	/**
	 * For extension plugins whose data depends on where a thread sits: the slug of each given
	 * thread's category, in one query. Deleted or unknown threads are left out. It answers for
	 * threads the caller already holds DTOs of, so it checks no visibility of its own.
	 */
	async threadCategorySlugs(threadIds: readonly string[]): Promise<Map<string, string>> {
		const ids = threadIds.filter((id) => isEntityId(id))
		if (ids.length === 0) return new Map()
		const rows = await this.database.read((db) =>
			db
				.select({ threadId: threads.id, slug: categories.slug })
				.from(threads)
				.innerJoin(categories, eq(categories.id, threads.categoryId))
				.where(and(inArray(threads.id, ids), isNull(threads.deletedAt))),
		)
		return new Map(rows.map((row) => [row.threadId, row.slug]))
	}

	// ── Users ───────────────────────────────────────────────────────────────────────────────

	/** Returns the account for an identity-provider subject, creating it on first sight. */
	async ensureUser(input: EnsureUserInput): Promise<ForumResult<UserDto>> {
		const subject = typeof input.subject === 'string' ? input.subject.trim() : ''
		if (!subject || subject.length > 255) return invalid(errorDetail('account.invalid_subject'))
		const displayName = validateDisplayName(input.displayName)
		if (!displayName.ok) return invalid(displayName.error)
		// A concurrent first login may claim the same handle (or subject) between our read and
		// write; the retry then sees that row and picks the next candidate or the existing account.
		for (let attempt = 1; ; attempt++) {
			try {
				// oxlint-disable-next-line no-await-in-loop -- retries are sequential on purpose.
				return await this.createOrFindUser(subject, displayName.value, input.handleHint)
			} catch (error) {
				if (attempt >= 3 || !isUniqueViolation(error)) throw error
			}
		}
	}

	private async createOrFindUser(
		subject: string,
		displayName: string,
		handleHint: string | undefined,
	): Promise<ForumResult<UserDto>> {
		let created = false
		const found = await this.database.transaction(async (tx) => {
			const [existing] = await tx.select(author).from(users).where(eq(users.subject, subject))
			if (existing) return Result.ok(existing)

			const tempHandle = `u-tmp-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`
			const [inserted] = await tx
				.insert(users)
				.values({ subject, handle: tempHandle, displayName })
				.onConflictDoNothing({ target: users.subject })
				.returning({ id: users.id, number: users.number })

			if (inserted) {
				created = true
				const base = deriveHandleBase(handleHint ?? '') || deriveHandleBase(displayName)
				const rawCandidates =
					base === ''
						? [`u${inserted.number}`]
						: [base, `${base}-${inserted.number}`, `u${inserted.number}`]
				const candidates = rawCandidates.flatMap((candidate) => {
					const checked = validateHandle(candidate)
					return checked.ok ? [checked.value] : []
				})
				const takenRows =
					candidates.length === 0
						? []
						: await tx
								.select({ handle: users.handle })
								.from(users)
								.where(inArray(users.handle, candidates))
				const taken = new Set(takenRows.map((row) => row.handle))
				const chosen =
					candidates.find((candidate) => !taken.has(candidate)) ?? `u${inserted.number}`
				await tx.update(users).set({ handle: chosen }).where(eq(users.id, inserted.id))
			}

			const [user] = await tx.select(author).from(users).where(eq(users.subject, subject))
			if (!user) throw new Error('User row is missing right after its upsert')
			return Result.ok(user)
		})
		// The community panel lists the newest members.
		if (created) await this.listingsChanged()
		return found
	}

	/** The account of an identity-provider subject, or null when it has never logged in. */
	async findUserBySubject(subject: string): Promise<UserDto | null> {
		const [user] = await this.database.read((db) =>
			db.select(author).from(users).where(eq(users.subject, subject)),
		)
		return user ?? null
	}

	/**
	 * Privileged: records the address the identity provider vouches for (null: it shares none).
	 * The forum keeps no address of its own; this is what notification mail goes to.
	 */
	async setContactEmail(userId: string, email: string | null): Promise<void> {
		if (!isEntityId(userId)) return
		const value = email === null ? null : email.trim().slice(0, 254) || null
		await this.database.transaction((tx) =>
			tx
				.update(users)
				.set({ email: value })
				.where(and(eq(users.id, userId), sql`${users.email} is distinct from ${value}`)),
		)
	}

	/** Privileged: the account's contact address from its identity provider, if any. */
	async contactEmail(userId: string): Promise<string | null> {
		if (!isEntityId(userId)) return null
		const [row] = await this.database.read((db) =>
			db.select({ email: users.email }).from(users).where(eq(users.id, userId)),
		)
		return row?.email ?? null
	}

	/** Privileged: changes an account's display name; callers decide who may. */
	async renameUser(userId: string, displayName: string): Promise<ForumResult<UserDto>> {
		if (!isEntityId(userId)) return notFound('user')
		const name = validateDisplayName(displayName)
		if (!name.ok) return invalid(name.error)
		const [user] = await this.database.transaction((tx) =>
			tx
				.update(users)
				.set({ displayName: name.value })
				.where(eq(users.id, userId))
				.returning(author),
		)
		if (user) await this.listingsChanged()
		return user ? Result.ok(user) : notFound('user')
	}

	async getUser(userRef: string, viewer: Principal = GUEST): Promise<ForumResult<UserDto>> {
		const parsed = parseUserRef(userRef)
		if (!parsed) return notFound('user')
		const match = parsed.kind === 'id' ? eq(users.id, parsed.id) : eq(users.handle, parsed.handle)
		const [user] = await this.database.read((db) => db.select(author).from(users).where(match))
		if (!user) return notFound('user')
		const enriched = await this.extendedUsers(viewer, [user])
		return Result.ok(enriched.get(user.id) ?? user)
	}

	/** Changes a user's profile (`user.edit` on that user: the user themselves or an admin). */
	async updateProfile(
		principal: Principal,
		userRef: string,
		input: UpdateProfileInput,
	): Promise<ForumResult<UserDto>> {
		const parsed = parseUserRef(userRef)
		if (!parsed) return notFound('user')
		const patch: Partial<Pick<typeof users.$inferInsert, 'displayName' | 'handle'>> = {}
		if (input.displayName !== undefined) {
			const name = validateDisplayName(input.displayName)
			if (!name.ok) return invalid(name.error)
			patch.displayName = name.value
		}
		if (input.handle !== undefined) {
			const handle = validateHandle(input.handle)
			if (!handle.ok) return invalid(handle.error)
			patch.handle = handle.value
		}

		const updated = await this.database
			.transaction(async (tx): Promise<ForumResult<UserDto>> => {
				const match =
					parsed.kind === 'id' ? eq(users.id, parsed.id) : eq(users.handle, parsed.handle)
				const [current] = await tx.select(author).from(users).where(match)
				if (!current) return notFound('user')
				if (!this.can(principal, 'user.edit', { userId: current.id })) return denied(principal)
				if (Object.keys(patch).length === 0) return Result.ok(current)
				if (patch.handle !== undefined && patch.handle !== current.handle) {
					const [taken] = await tx
						.select({ id: users.id })
						.from(users)
						.where(eq(users.handle, patch.handle))
					if (taken) return fail('conflict', 'handle.taken')
				}
				const [row] = await tx
					.update(users)
					.set(patch)
					.where(eq(users.id, current.id))
					.returning(author)
				return row ? Result.ok(row) : notFound('user')
			})
			// Another account took the handle between the check above and the write.
			.catch((error: unknown) => {
				if (isUniqueViolation(error)) return fail('conflict', 'handle.taken')
				throw error
			})
		if (updated.isErr()) return updated
		// Listings show authors' names.
		await this.listingsChanged()
		const enriched = await this.extendedUsers(principal, [updated.value])
		return Result.ok(enriched.get(updated.value.id) ?? updated.value)
	}

	/**
	 * Public profile of a user together with one page of their visible topics, or of their notes
	 * with `kind: 'note'`.
	 */
	async getUserProfile(
		principal: Principal,
		userRef: string,
		paging: ProfilePageRequest = {},
	): Promise<ForumResult<UserProfileDto>> {
		const parsed = parseUserRef(userRef)
		if (!parsed) return notFound('user')
		const { page, pageSize } = normalizePage(paging)
		const wanted: ThreadKind = paging.kind === 'note' ? 'note' : 'topic'
		const visibleCategories = await this.listCategories(principal)
		const visibleCategoryIds = visibleCategories.map((category) => category.id)
		const kindIds = (kind: CategoryKind) =>
			visibleCategories.filter((category) => category.kind === kind).map(({ id }) => id)
		const boardIds = kindIds('board')
		const streamIds = kindIds('stream')

		const read = await this.database.read(async (db) => {
			const match = parsed.kind === 'id' ? eq(users.id, parsed.id) : eq(users.handle, parsed.handle)
			const [account] = await db
				.select({
					id: users.id,
					handle: users.handle,
					displayName: users.displayName,
					createdAt: users.createdAt,
				})
				.from(users)
				.where(match)
			if (!account) return null

			const roleRows = await db
				.select({ role: userRoles.role })
				.from(userRoles)
				.where(eq(userRoles.userId, account.id))
			const roleSet = new Set<Role>(['member'])
			for (const { role } of roleRows) if (isAssignableRole(role)) roleSet.add(role)
			const roles = ROLES.filter((role) => roleSet.has(role))

			if (visibleCategoryIds.length === 0) {
				return {
					account,
					roles,
					threadCount: 0,
					noteCount: 0,
					postCount: 0,
					threadRows: [] as ThreadRow[],
					openings: [] as OpeningSource[],
				}
			}

			const threadsIn = (ids: readonly string[]) =>
				and(
					eq(threads.authorId, account.id),
					isNull(threads.deletedAt),
					ids.length === 0 ? sql`false` : inArray(threads.categoryId, [...ids]),
				)
			const [threadTotal] = await db
				.select({ value: count() })
				.from(threads)
				.where(threadsIn(boardIds))
			const [noteTotal] = await db
				.select({ value: count() })
				.from(threads)
				.where(threadsIn(streamIds))
			const [postTotal] = await db
				.select({ value: count() })
				.from(posts)
				.innerJoin(threads, eq(threads.id, posts.threadId))
				.where(
					and(
						eq(posts.authorId, account.id),
						isNull(posts.deletedAt),
						isNull(threads.deletedAt),
						inArray(threads.categoryId, visibleCategoryIds),
					),
				)
			const threadRows = await db
				.select()
				.from(threads)
				.where(threadsIn(wanted === 'note' ? streamIds : boardIds))
				.orderBy(desc(threads.createdAt), desc(threads.id))
				.limit(pageSize)
				.offset((page - 1) * pageSize)
			const openings =
				wanted === 'note'
					? await this.openingsOf(
							db,
							threadRows.map((row) => row.id),
						)
					: []

			return {
				account,
				roles,
				threadCount: threadTotal?.value ?? 0,
				noteCount: noteTotal?.value ?? 0,
				postCount: postTotal?.value ?? 0,
				threadRows,
				openings,
			}
		})
		if (!read) return notFound('user')

		const baseUser: UserDto = {
			id: read.account.id,
			handle: read.account.handle,
			displayName: read.account.displayName,
		}
		const rawThreads = read.threadRows.map((row) =>
			toThreadDto(row, baseUser, wanted === 'note' ? 'stream' : 'board'),
		)
		const [usersById, extendedThreads] = await Promise.all([
			this.extendedUsers(principal, [baseUser]),
			this.extended('thread', principal, rawThreads).then((list) =>
				this.withOpenings(principal, list, read.openings),
			),
		])
		const user = usersById.get(baseUser.id) ?? baseUser

		return Result.ok({
			user,
			roles: read.roles,
			createdAt: read.account.createdAt.toISOString(),
			threadCount: read.threadCount,
			noteCount: read.noteCount,
			postCount: read.postCount,
			threads: {
				items: extendedThreads,
				page,
				pageSize,
				total: wanted === 'note' ? read.noteCount : read.threadCount,
			},
			can: { edit: this.can(principal, 'user.edit', { userId: user.id }) },
			ext: user.ext ?? {},
		})
	}

	/**
	 * Resolves who a user ID acts as. Every existing account is a `member`; elevated roles are
	 * stored. A null or unknown ID is a guest.
	 */
	async principalOf(userId: string | null): Promise<Principal> {
		if (!isEntityId(userId)) return GUEST
		const rows = await this.database.read((db) =>
			db
				.select({ role: userRoles.role })
				.from(users)
				.leftJoin(userRoles, eq(userRoles.userId, users.id))
				.where(eq(users.id, userId)),
		)
		if (rows.length === 0) return GUEST
		const roles = new Set<Role>(['member'])
		for (const { role } of rows) if (isAssignableRole(role)) roles.add(role)
		return { userId, roles: [...roles] }
	}

	/**
	 * Privileged, for admin tooling: one page of accounts, newest first, with their assigned roles.
	 * `query` matches a handle or display name (case-insensitive substring).
	 */
	async listUsers(
		input: Readonly<{ query?: string; page?: number; pageSize?: number }> = {},
	): Promise<UserListDto> {
		const { page, pageSize } = normalizePage(input)
		const query = input.query?.trim().slice(0, 64) ?? ''
		const pattern = `%${query.replaceAll(/[\\%_]/g, (char) => `\\${char}`)}%`
		const where =
			query === '' ? undefined : or(ilike(users.handle, pattern), ilike(users.displayName, pattern))
		return this.database.read(async (db) => {
			const [totalRow] = await db.select({ value: count() }).from(users).where(where)
			const rows = await db
				.select({ ...author, number: users.number, createdAt: users.createdAt })
				.from(users)
				.where(where)
				.orderBy(desc(users.number))
				.limit(pageSize)
				.offset((page - 1) * pageSize)
			const roleRows =
				rows.length === 0
					? []
					: await db
							.select({ userId: userRoles.userId, role: userRoles.role })
							.from(userRoles)
							.where(
								inArray(
									userRoles.userId,
									rows.map((row) => row.id),
								),
							)
			const rolesOf = new Map<string, AssignableRole[]>()
			for (const { userId, role } of roleRows) {
				if (!isAssignableRole(role)) continue
				rolesOf.set(userId, [...(rolesOf.get(userId) ?? []), role])
			}
			return {
				items: rows.map((row) => ({
					id: row.id,
					handle: row.handle,
					displayName: row.displayName,
					number: row.number,
					createdAt: row.createdAt.toISOString(),
					roles: rolesOf.get(row.id) ?? [],
				})),
				total: totalRow?.value ?? 0,
				page,
				pageSize,
			}
		})
	}

	/** Privileged: callers (identity setup, admin tooling) decide who may grant roles. */
	async grantRole(userId: string, role: AssignableRole): Promise<ForumResult<void>> {
		if (!isAssignableRole(role)) return invalid(errorDetail('role.unknown'))
		if (!isEntityId(userId)) return notFound('user')
		return this.database.transaction(async (tx) => {
			const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId))
			if (!user) return notFound('user')
			await tx.insert(userRoles).values({ userId, role }).onConflictDoNothing()
			return Result.ok()
		})
	}

	async revokeRole(userId: string, role: AssignableRole): Promise<ForumResult<void>> {
		if (!isEntityId(userId)) return notFound('user')
		await this.database.transaction((tx) =>
			tx.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.role, role))),
		)
		return Result.ok()
	}

	// ── Categories ──────────────────────────────────────────────────────────────────────────

	async listCategories(principal: Principal): Promise<CategoryDto[]> {
		const rows = await this.database.read((db) =>
			db.select().from(categories).orderBy(asc(categories.position), asc(categories.name)),
		)
		return rows
			.filter((row) => this.can(principal, 'category.view', { categoryId: row.id }))
			.map(toCategoryDto)
	}

	async createCategory(
		principal: Principal,
		input: CreateCategoryInput,
	): Promise<ForumResult<CategoryDto>> {
		if (!this.can(principal, 'category.manage')) return denied(principal)
		const name = validateCategoryName(input.name)
		if (!name.ok) return invalid(name.error)
		const slug = validateSlug(input.slug ?? slugify(name.value))
		if (!slug.ok) {
			return invalid(input.slug === undefined ? errorDetail('slug.derive_failed') : slug.error)
		}
		const description = validateCategoryDescription(input.description ?? '')
		if (!description.ok) return invalid(description.error)
		const position = input.position ?? 0
		if (!Number.isSafeInteger(position)) return invalid(errorDetail('position.not_integer'))

		const [row] = await this.database.transaction((tx) =>
			tx
				.insert(categories)
				.values({
					name: name.value,
					slug: slug.value,
					description: description.value,
					position,
				})
				.onConflictDoNothing({ target: categories.slug })
				.returning(),
		)
		if (row) await this.listingsChanged()
		return row ? Result.ok(toCategoryDto(row)) : fail('conflict', 'category.slug_taken')
	}

	async updateCategory(
		principal: Principal,
		categoryId: string,
		input: UpdateCategoryInput,
	): Promise<ForumResult<CategoryDto>> {
		if (!this.can(principal, 'category.manage', { categoryId })) return denied(principal)
		if (!isEntityId(categoryId)) return notFound('category')
		const patch: Partial<Pick<CategoryRow, 'name' | 'slug' | 'description' | 'position'>> = {}
		if (input.name !== undefined) {
			const name = validateCategoryName(input.name)
			if (!name.ok) return invalid(name.error)
			patch.name = name.value
		}
		if (input.slug !== undefined) {
			const slug = validateSlug(input.slug)
			if (!slug.ok) return invalid(slug.error)
			patch.slug = slug.value
		}
		if (input.description !== undefined) {
			const description = validateCategoryDescription(input.description)
			if (!description.ok) return invalid(description.error)
			patch.description = description.value
		}
		if (input.position !== undefined) {
			if (!Number.isSafeInteger(input.position)) return invalid(errorDetail('position.not_integer'))
			patch.position = input.position
		}

		const updated = await this.database.transaction(async (tx) => {
			const [current] = await tx.select().from(categories).where(eq(categories.id, categoryId))
			if (!current) return notFound('category')
			if (Object.keys(patch).length === 0) return Result.ok(toCategoryDto(current))
			if (patch.slug !== undefined && patch.slug !== current.slug) {
				const [taken] = await tx
					.select({ id: categories.id })
					.from(categories)
					.where(eq(categories.slug, patch.slug))
				if (taken) return fail('conflict', 'category.slug_taken')
			}
			const [row] = await tx
				.update(categories)
				.set(patch)
				.where(eq(categories.id, categoryId))
				.returning()
			return row ? Result.ok(toCategoryDto(row)) : notFound('category')
		})
		if (updated.isOk()) await this.listingsChanged()
		return updated
	}

	/** Only a category that never held a thread can be removed; history is not discarded. */
	async deleteCategory(principal: Principal, categoryId: string): Promise<ForumResult<void>> {
		if (!this.can(principal, 'category.manage', { categoryId })) return denied(principal)
		if (!isEntityId(categoryId)) return notFound('category')
		const outcome = await this.database.transaction(async (tx) => {
			const [current] = await tx
				.select({ kind: categories.kind })
				.from(categories)
				.where(eq(categories.id, categoryId))
			if (current?.kind === 'stream') return fail('conflict', 'category.stream_undeletable')
			const [used] = await tx
				.select({ id: threads.id })
				.from(threads)
				.where(eq(threads.categoryId, categoryId))
				.limit(1)
			if (used) return fail('conflict', 'category.not_empty')
			const removed = await tx
				.delete(categories)
				.where(eq(categories.id, categoryId))
				.returning({ id: categories.id })
			return removed.length > 0 ? Result.ok() : notFound('category')
		})
		if (outcome.isOk()) await this.listingsChanged()
		return outcome
	}

	// ── Threads ─────────────────────────────────────────────────────────────────────────────

	/**
	 * One page of threads (topics and notes) across every category the viewer may see. `sort` is
	 * `active` (latest activity, the default), `new` (latest started) or `hot`: replies plus
	 * engagement, decaying with age (`(replies + engagement) / (hours + 2) ^ gravity`), among
	 * threads active in the last `HOT_WINDOW_DAYS` days.
	 *
	 * `scope: 'following'` keeps only threads by people the viewer follows (and their own) and
	 * threads in categories they follow, as the follow graph says; it is empty for guests and while
	 * no graph is installed. Those pages are per reader, so they are never cached.
	 */
	async listRecentThreads(
		principal: Principal,
		paging: PageRequest = {},
		filter: RecentThreadsFilter = {},
	): Promise<RecentThreadsDto> {
		const { page, pageSize } = normalizePage(paging)
		const sort = filter.sort ?? 'active'
		const empty: RecentThreadsDto = { items: [], page, pageSize, total: 0 }
		const visibleCategories = await this.visibleCategories(principal)
		if (visibleCategories.length === 0) return empty
		const visibleIds = visibleCategories.map((category) => category.id)
		let following: SQL | undefined
		if (filter.scope === 'following') {
			if (principal.userId === null) return empty
			const followed = await this.followedBy(principal.userId)
			if (followed === null) return empty
			const visibleSet = new Set(visibleIds)
			const userIds = [...new Set([principal.userId, ...followed.userIds])].filter(isEntityId)
			const categoryIds = followed.categoryIds.filter((id) => visibleSet.has(id))
			following = or(
				inArray(threads.authorId, userIds),
				categoryIds.length > 0 ? inArray(threads.categoryId, categoryIds) : undefined,
			)
		}
		const categoriesById = new Map<string, CategorySummaryDto>(
			visibleCategories.map(({ id, slug, name }) => [id, { id, slug, name }]),
		)
		const gravity = this.config.social.hotGravity
		const hotScore = sql`(${threads.replyCount} + ${threads.engagement})::float8 / power(extract(epoch from (now() - ${threads.createdAt})) / 3600 + 2, ${gravity}::float8)`
		const load = () =>
			this.database.read(async (db): Promise<ThreadListing> => {
				const visible = and(
					inArray(threads.categoryId, visibleIds),
					isNull(threads.deletedAt),
					sort === 'hot'
						? gte(threads.lastPostAt, new Date(Date.now() - HOT_WINDOW_DAYS * 86_400_000))
						: undefined,
					following,
				)
				const order =
					sort === 'new'
						? [desc(threads.createdAt), desc(threads.id)]
						: sort === 'hot'
							? [desc(hotScore), desc(threads.lastPostAt), desc(threads.id)]
							: [desc(threads.lastPostAt), desc(threads.id)]
				const [total] = await db.select({ value: count() }).from(threads).where(visible)
				const rows = await db
					.select({ thread: threads, author, kind: categories.kind })
					.from(threads)
					.innerJoin(users, eq(users.id, threads.authorId))
					.innerJoin(categories, eq(categories.id, threads.categoryId))
					.where(visible)
					.orderBy(...order)
					.limit(pageSize)
					.offset((page - 1) * pageSize)
				const list = rows.map((row) => toThreadDto(row.thread, row.author, row.kind))
				return {
					threads: list,
					openings: await this.noteOpenings(db, list),
					total: total?.value ?? 0,
				}
			})
		const read =
			page <= CACHED_PAGES && following === undefined
				? await this.cachedListing(
						`recent:${sort}${sort === 'hot' ? gravity : ''}:${page}:${pageSize}:${digest(visibleIds.join(','))}`,
						load,
						isThreadListing,
					)
				: await load()

		const extendedThreads = await this.withOpenings(
			principal,
			await this.extended('thread', principal, read.threads),
			read.openings,
		)
		const items: RecentThreadDto[] = extendedThreads.flatMap((thread) => {
			const category = categoriesById.get(thread.categoryId)
			return category ? [{ ...thread, category }] : []
		})
		return {
			items,
			page,
			pageSize,
			total: read.total,
		}
	}

	/** Every category the viewer may see, in display order. */
	private async visibleCategories(principal: Principal) {
		const all = await this.database.read((db) =>
			db
				.select({ id: categories.id, slug: categories.slug, name: categories.name })
				.from(categories)
				.orderBy(asc(categories.position), asc(categories.id)),
		)
		return all.filter((category) =>
			this.can(principal, 'category.view', { categoryId: category.id }),
		)
	}

	/**
	 * The overview's community panel: how many members there are, who joined last, and who posted
	 * most in the last `ACTIVE_WINDOW_DAYS` days. Only posts in categories the viewer may see count.
	 */
	async communityPulse(principal: Principal): Promise<CommunityDto> {
		const visibleIds = (await this.visibleCategories(principal)).map((category) => category.id)
		const read = await this.cachedListing(
			`community:${digest(visibleIds.join(','))}`,
			() =>
				this.database.read(async (db): Promise<CommunityListing> => {
					const [members] = await db.select({ value: count() }).from(users)
					const newest = await db
						.select({ id: users.id, handle: users.handle, displayName: users.displayName })
						.from(users)
						.orderBy(desc(users.number))
						.limit(COMMUNITY_LIST_SIZE)
					const since = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 86_400_000)
					const posted = count()
					const active =
						visibleIds.length === 0
							? []
							: await db
									.select({
										id: users.id,
										handle: users.handle,
										displayName: users.displayName,
										posts: posted,
									})
									.from(posts)
									.innerJoin(threads, eq(threads.id, posts.threadId))
									.innerJoin(users, eq(users.id, posts.authorId))
									.where(
										and(
											inArray(threads.categoryId, visibleIds),
											isNull(threads.deletedAt),
											isNull(posts.deletedAt),
											gte(posts.createdAt, since),
										),
									)
									.groupBy(users.id, users.handle, users.displayName, users.number)
									.orderBy(desc(posted), asc(users.number))
									.limit(COMMUNITY_LIST_SIZE)
					return { members: members?.value ?? 0, newest, active }
				}),
			isCommunityListing,
		)
		const byId = await this.extendedUsers(principal, [
			...read.newest,
			...read.active.map(({ id, handle, displayName }) => ({ id, handle, displayName })),
		])
		const userOf = (user: UserDto): UserDto => byId.get(user.id) ?? user
		return {
			members: read.members,
			newMembers: read.newest.map(userOf),
			activeMembers: read.active.map(({ posts: total, ...user }) => ({
				user: userOf(user),
				posts: total,
			})),
			days: ACTIVE_WINDOW_DAYS,
		}
	}

	/** One page of a category's threads: pinned first, then most recently active. */
	async listThreads(
		principal: Principal,
		categorySlug: string,
		paging: PageRequest = {},
	): Promise<ForumResult<CategoryThreadsDto>> {
		const { page, pageSize } = normalizePage(paging)
		const load = () =>
			this.database.read(async (db): Promise<CategoryListing | null> => {
				const [category] = await db
					.select()
					.from(categories)
					.where(eq(categories.slug, categorySlug))
				if (!category) return null
				const visible = and(eq(threads.categoryId, category.id), isNull(threads.deletedAt))
				const [total] = await db.select({ value: count() }).from(threads).where(visible)
				const rows = await db
					.select({ thread: threads, author })
					.from(threads)
					.innerJoin(users, eq(users.id, threads.authorId))
					.where(visible)
					.orderBy(desc(threads.pinned), desc(threads.lastPostAt), desc(threads.id))
					.limit(pageSize)
					.offset((page - 1) * pageSize)
				const list = rows.map((row) => toThreadDto(row.thread, row.author, category.kind))
				return {
					category: toCategoryDto(category),
					threads: list,
					openings: await this.noteOpenings(db, list),
					total: total?.value ?? 0,
				}
			})
		const listing =
			page <= CACHED_PAGES
				? await this.cachedListing(
						`category:${digest(categorySlug)}:${page}:${pageSize}`,
						load,
						isCategoryListing,
					)
				: await load()
		if (!listing || !this.can(principal, 'category.view', { categoryId: listing.category.id })) {
			return notFound('category')
		}
		const { category } = listing
		return Result.ok({
			category,
			threads: {
				items: await this.withOpenings(
					principal,
					await this.extended('thread', principal, listing.threads),
					listing.openings,
				),
				page,
				pageSize,
				total: listing.total,
			},
			can: {
				createThread: this.can(principal, 'thread.create', { categoryId: category.id }),
			},
		})
	}

	/**
	 * A thread with one page of its top-level posts, oldest first; deleted ones stay as
	 * placeholders. Each carries its first `REPLY_PREVIEW` replies (all of them, up to
	 * `REPLY_EXPAND_MAX`, for `expandFloor`) and how many there are.
	 */
	async getThread(
		principal: Principal,
		threadRef: string,
		paging: ThreadPageRequest = {},
	): Promise<ForumResult<ThreadDetailDto>> {
		if (!parseThreadRef(threadRef)) return notFound('thread')
		const { page, pageSize } = normalizePage(paging)
		const detail = await this.database.read(async (db): Promise<ForumResult<ThreadDetailDto>> => {
			const found = await this.findThread(db, threadRef)
			if (!found || !this.can(principal, 'thread.view', this.threadResource(found.thread))) {
				return notFound('thread')
			}
			const { thread, category } = found
			const topLevel = and(eq(posts.threadId, thread.id), isNull(posts.parentId))
			const [total] = await db.select({ value: count() }).from(posts).where(topLevel)
			const rows = await db
				.select({ post: posts, author })
				.from(posts)
				.innerJoin(users, eq(users.id, posts.authorId))
				.where(topLevel)
				.orderBy(asc(posts.number), asc(posts.id))
				.limit(pageSize)
				.offset((page - 1) * pageSize)
			const expandId = rows.find((row) => row.post.number === paging.expandFloor)?.post.id
			const replies = await this.replyPreviews(
				db,
				principal,
				thread,
				rows.map((row) => row.post.id),
				expandId,
			)
			const resource = this.threadResource(thread)
			return Result.ok({
				thread: toThreadDto(thread, found.author, category.kind),
				category: toCategoryDto(category),
				posts: {
					items: rows.map((row) => ({
						...this.toPostDto(principal, row.post, row.author, thread),
						replies: replies.get(row.post.id) ?? { items: [], total: 0 },
					})),
					page,
					pageSize,
					total: total?.value ?? 0,
				},
				can: {
					reply: this.can(principal, 'post.create', resource),
					edit: this.can(principal, 'thread.edit', resource),
					delete: this.can(principal, 'thread.delete', resource),
					moderate: this.can(principal, 'thread.moderate', resource),
					move:
						this.can(principal, 'thread.moderate', resource) ||
						this.can(principal, 'thread.edit', resource),
				},
			})
		})
		if (detail.isErr()) return detail
		// Extensions answer after the core's own read has finished, each with one batch per entity:
		// the replies inside floors go in the same batch as the floors.
		const top = detail.value.posts.items
		const nested = top.flatMap((post) => post.replies?.items ?? [])
		const [[thread], extendedPosts] = await Promise.all([
			this.extended('thread', principal, [detail.value.thread]),
			this.extended('post', principal, [...top, ...nested]),
		])
		const byId = new Map(extendedPosts.map((post) => [post.id, post]))
		const items = top.map((post) => {
			const extended = byId.get(post.id) ?? post
			return post.replies
				? {
						...extended,
						replies: {
							total: post.replies.total,
							items: post.replies.items.map((reply) => byId.get(reply.id) ?? reply),
						},
					}
				: extended
		})
		return Result.ok({
			...detail.value,
			thread: thread ?? detail.value.thread,
			posts: { ...detail.value.posts, items },
		})
	}

	/**
	 * The first replies inside each of the given top-level posts and how many each has (deleted
	 * replies are left out). `expandId` names one whose replies are all wanted.
	 */
	private async replyPreviews(
		db: Db,
		principal: Principal,
		thread: ThreadRow,
		parentIds: readonly string[],
		expandId: string | undefined,
	): Promise<Map<string, { items: PostDto[]; total: number }>> {
		const previews = new Map<string, { items: PostDto[]; total: number }>()
		if (parentIds.length === 0) return previews
		const inFloors = and(
			eq(posts.threadId, thread.id),
			inArray(posts.parentId, [...parentIds]),
			isNull(posts.deletedAt),
		)
		const totals = await db
			.select({ parentId: posts.parentId, value: count() })
			.from(posts)
			.where(inFloors)
			.groupBy(posts.parentId)
		if (totals.length === 0) return previews
		const ranked = db
			.select({
				id: posts.id,
				parentId: posts.parentId,
				rank: sql<number>`row_number() over (partition by ${posts.parentId} order by ${posts.number})`.as(
					'rank',
				),
			})
			.from(posts)
			.where(inFloors)
			.as('ranked')
		const rows = await db
			.select({ post: posts, author, replyTo })
			.from(posts)
			.innerJoin(ranked, eq(ranked.id, posts.id))
			.innerJoin(users, eq(users.id, posts.authorId))
			.leftJoin(replyToUsers, eq(replyToUsers.id, posts.replyToId))
			.where(
				or(
					lte(ranked.rank, REPLY_PREVIEW),
					expandId === undefined
						? undefined
						: and(eq(ranked.parentId, expandId), lte(ranked.rank, REPLY_EXPAND_MAX)),
				),
			)
			.orderBy(asc(posts.number))
		for (const { parentId, value } of totals) {
			if (parentId !== null) previews.set(parentId, { items: [], total: value })
		}
		for (const row of rows) {
			const preview = row.post.parentId === null ? undefined : previews.get(row.post.parentId)
			preview?.items.push(
				this.toPostDto(principal, row.post, row.author, thread, userOrNull(row.replyTo)),
			)
		}
		return previews
	}

	/**
	 * One page of the replies inside a top-level post ("楼中楼"), oldest first, without deleted
	 * ones. `postId` is the top-level post.
	 */
	async listReplies(
		principal: Principal,
		postId: string,
		paging: PageRequest = {},
	): Promise<ForumResult<PageDto<PostDto>>> {
		if (!isEntityId(postId)) return notFound('floor')
		const { page, pageSize } = normalizePage(paging)
		const read = await this.database.read(async (db) => {
			const [row] = await db
				.select({ post: posts, thread: threads })
				.from(posts)
				.innerJoin(threads, eq(threads.id, posts.threadId))
				.where(and(eq(posts.id, postId), isNull(threads.deletedAt)))
			if (!row || !this.can(principal, 'thread.view', this.threadResource(row.thread))) {
				return null
			}
			const inFloor = and(eq(posts.parentId, row.post.id), isNull(posts.deletedAt))
			const [total] = await db.select({ value: count() }).from(posts).where(inFloor)
			const rows = await db
				.select({ post: posts, author, replyTo })
				.from(posts)
				.innerJoin(users, eq(users.id, posts.authorId))
				.leftJoin(replyToUsers, eq(replyToUsers.id, posts.replyToId))
				.where(inFloor)
				.orderBy(asc(posts.number))
				.limit(pageSize)
				.offset((page - 1) * pageSize)
			return {
				items: rows.map((reply) =>
					this.toPostDto(
						principal,
						reply.post,
						reply.author,
						row.thread,
						userOrNull(reply.replyTo),
					),
				),
				total: total?.value ?? 0,
			}
		})
		if (!read) return notFound('floor')
		return Result.ok({
			items: await this.extended('post', principal, read.items),
			page,
			pageSize,
			total: read.total,
		})
	}

	/**
	 * Where floor `floor` of a thread is shown: the page of top-level posts that holds it, or holds
	 * the floor it replies inside. What a link to `/t/<ref>/<floor>` resolves to.
	 */
	async locateFloor(
		principal: Principal,
		threadRef: string,
		floor: number,
		paging: PageRequest = {},
	): Promise<ForumResult<FloorLocationDto>> {
		if (!parseThreadRef(threadRef)) return notFound('thread')
		if (!Number.isSafeInteger(floor) || floor < 1) return notFound('floor')
		const { pageSize } = normalizePage(paging)
		const located = await this.database.read(async (db) => {
			const found = await this.findThread(db, threadRef)
			if (!found || !this.can(principal, 'thread.view', this.threadResource(found.thread))) {
				return notFound('thread')
			}
			const { thread } = found
			const [post] = await db
				.select({ parentId: posts.parentId, number: posts.number })
				.from(posts)
				.where(and(eq(posts.threadId, thread.id), eq(posts.number, floor)))
			if (!post) return notFound('floor')
			let topNumber = post.number
			let parentFloor: number | null = null
			if (post.parentId !== null) {
				const [parent] = await db
					.select({ number: posts.number })
					.from(posts)
					.where(eq(posts.id, post.parentId))
				if (!parent) return notFound('floor')
				topNumber = parent.number
				parentFloor = parent.number
			}
			const [before] = await db
				.select({ value: count() })
				.from(posts)
				.where(
					and(eq(posts.threadId, thread.id), isNull(posts.parentId), lte(posts.number, topNumber)),
				)
			return Result.ok({
				threadRef: formatThreadRef(thread.number, thread.slug),
				floor,
				page: Math.max(1, Math.ceil((before?.value ?? 1) / pageSize)),
				parentFloor,
			})
		})
		return located
	}

	/**
	 * Creates a thread together with its opening post. In a `stream` category it is a note: no
	 * title, and a body of at most `noteBodyMax()`.
	 */
	async createThread(
		principal: Principal,
		input: CreateThreadInput,
	): Promise<ForumResult<ThreadDto>> {
		const { categoryId } = input
		if (principal.userId === null) return denied(principal)
		if (!isEntityId(categoryId)) return notFound('category')
		const [target] = await this.database.read((db) =>
			db.select({ kind: categories.kind }).from(categories).where(eq(categories.id, categoryId)),
		)
		if (!target || !this.can(principal, 'category.view', { categoryId }))
			return notFound('category')
		const threadKind = kindOf(target.kind)
		let titleValue = ''
		if (threadKind === 'note') {
			if (typeof input.title !== 'string' || input.title.trim() !== '') {
				return invalid(errorDetail('thread.note_no_title'))
			}
		} else {
			const title = validateThreadTitle(input.title)
			if (!title.ok) return invalid(title.error)
			titleValue = title.value
		}
		const body = validatePostBody(
			input.body,
			threadKind === 'note' ? this.noteBodyMax() : undefined,
		)
		if (!body.ok) return invalid(body.error)
		if (!this.can(principal, 'thread.create', { categoryId })) return denied(principal)
		const authorId = principal.userId
		if (authorId === null) return denied(principal)
		const slug = slugifyAsciiTitle(titleValue)
		const refused = await this.admit({ kind: 'thread.create', principal })
		if (refused) return Result.err(refused)

		const written = await this.database.transaction(
			async (
				tx,
			): Promise<ForumResult<Readonly<{ dto: ThreadDto; event: PostAfterWriteEvent }>>> => {
				const [by] = await tx.select(author).from(users).where(eq(users.id, authorId))
				if (!by) return denied(GUEST)
				const [category] = await tx
					.select({ id: categories.id, kind: categories.kind })
					.from(categories)
					.where(eq(categories.id, categoryId))
				if (!category) return notFound('category')
				if (kindOf(category.kind) !== threadKind) return fail('conflict', 'category.kind_changed')
				const rejected = this.beforeWrite({
					kind: 'thread.create',
					principal,
					categoryId,
					threadKind,
					title: titleValue,
					body: body.value,
				})
				if (rejected) return Result.err(rejected)
				const [thread] = await tx
					.insert(threads)
					.values({ categoryId, authorId, title: titleValue, slug, postSeq: 1 })
					.returning()
				if (!thread) throw new Error('Thread insert returned no row')
				const [opening] = await tx
					.insert(posts)
					.values({
						threadId: thread.id,
						number: 1,
						authorId,
						body: body.value,
						opening: true,
					})
					.returning({ id: posts.id })
				if (!opening) throw new Error('Opening post insert returned no row')
				await tx
					.update(categories)
					.set({
						threadCount: sql`${categories.threadCount} + 1`,
						postCount: sql`${categories.postCount} + 1`,
					})
					.where(eq(categories.id, categoryId))
				const dto = toThreadDto(thread, by, category.kind)
				return Result.ok({
					dto,
					event: {
						kind: 'thread.created',
						principal,
						categoryId,
						threadId: thread.id,
						threadRef: dto.ref,
						threadKind,
						postId: opening.id,
						authorId,
						title: thread.title,
						body: body.value,
						createdAt: thread.createdAt.toISOString(),
					},
				})
			},
		)
		if (written.isErr()) return Result.err(written.error)
		await this.afterWrite(written.value.event)
		return this.extendedResult('thread', principal, Result.ok(written.value.dto))
	}

	/**
	 * Renames a thread (`thread.edit`), pins or locks it (`thread.moderate`) and/or moves it to
	 * another board (`thread.moderate`, or `thread.edit` together with `thread.create` there).
	 * A note has no title; moving it to a board turns it into a topic and takes one.
	 */
	async updateThread(
		principal: Principal,
		threadRef: string,
		input: UpdateThreadInput,
	): Promise<ForumResult<ThreadDto>> {
		if (!parseThreadRef(threadRef)) return notFound('thread')
		if (input.categoryId !== undefined && !isEntityId(input.categoryId)) return notFound('category')
		const patch: Partial<Pick<ThreadRow, 'title' | 'slug' | 'pinned' | 'locked' | 'categoryId'>> =
			{}
		if (input.title !== undefined) {
			const title = validateThreadTitle(input.title)
			if (!title.ok) return invalid(title.error)
			patch.title = title.value
			patch.slug = slugifyAsciiTitle(title.value)
		}
		if (input.pinned !== undefined) patch.pinned = input.pinned
		if (input.locked !== undefined) patch.locked = input.locked
		// Pinning and locking are moderation, not writing: only a new title is admitted.
		if (patch.title !== undefined && principal.userId !== null) {
			const refused = await this.admit({ kind: 'thread.update', principal })
			if (refused) return Result.err(refused)
		}

		const written = await this.database.transaction(
			async (
				tx,
			): Promise<ForumResult<Readonly<{ dto: ThreadDto; event: PostAfterWriteEvent | null }>>> => {
				const found = await this.findThread(tx, threadRef)
				if (!found || !this.can(principal, 'thread.view', this.threadResource(found.thread))) {
					return notFound('thread')
				}
				const resource = this.threadResource(found.thread)
				const source = found.category
				const moderator = this.can(principal, 'thread.moderate', resource)
				let target: CategoryRow = source
				if (input.categoryId !== undefined && input.categoryId !== source.id) {
					const [row] = await tx
						.select()
						.from(categories)
						.where(eq(categories.id, input.categoryId))
					if (!row || !this.can(principal, 'category.view', { categoryId: row.id })) {
						return notFound('category')
					}
					if (row.kind === 'stream') return invalid(errorDetail('thread.topic_not_to_stream'))
					const allowed =
						moderator ||
						(this.can(principal, 'thread.edit', resource) &&
							this.can(principal, 'thread.create', { categoryId: row.id }))
					if (!allowed) return denied(principal)
					target = row
					patch.categoryId = row.id
				}
				if (target.kind === 'stream' && patch.title !== undefined) {
					return invalid(errorDetail('thread.note_untitled'))
				}
				if (source.kind === 'stream' && target.kind !== 'stream' && patch.title === undefined) {
					return invalid(errorDetail('thread.convert_needs_title'))
				}
				if (patch.title !== undefined && !this.can(principal, 'thread.edit', resource)) {
					return denied(principal)
				}
				if ((patch.pinned !== undefined || patch.locked !== undefined) && !moderator) {
					return denied(principal)
				}
				if (Object.keys(patch).length === 0) {
					return Result.ok({
						dto: toThreadDto(found.thread, found.author, source.kind),
						event: null,
					})
				}
				if (patch.title !== undefined) {
					const rejected = this.beforeWrite({
						kind: 'thread.update',
						principal,
						categoryId: target.id,
						threadId: found.thread.id,
						title: patch.title,
					})
					if (rejected) return Result.err(rejected)
				}
				const [row] = await tx
					.update(threads)
					.set(patch)
					.where(eq(threads.id, found.thread.id))
					.returning()
				if (!row) return notFound('thread')
				if (target.id !== source.id) {
					const moved = found.thread.replyCount + 1
					await tx
						.update(categories)
						.set({
							threadCount: sql`${categories.threadCount} - 1`,
							postCount: sql`${categories.postCount} - ${moved}`,
						})
						.where(eq(categories.id, source.id))
					await tx
						.update(categories)
						.set({
							threadCount: sql`${categories.threadCount} + 1`,
							postCount: sql`${categories.postCount} + ${moved}`,
						})
						.where(eq(categories.id, target.id))
				}
				const [opening] = await tx
					.select({ id: posts.id, body: posts.body })
					.from(posts)
					.where(and(eq(posts.threadId, found.thread.id), eq(posts.opening, true)))
				const dto = toThreadDto(row, found.author, target.kind)
				return Result.ok({
					dto,
					event: opening
						? {
								kind: 'thread.updated',
								principal,
								categoryId: row.categoryId,
								previousCategoryId: source.id,
								threadId: row.id,
								threadRef: dto.ref,
								threadKind: dto.kind,
								postId: opening.id,
								authorId: row.authorId,
								title: row.title,
								body: opening.body,
								pinned: row.pinned,
								locked: row.locked,
								createdAt: row.createdAt.toISOString(),
							}
						: null,
				})
			},
		)
		if (written.isErr()) return Result.err(written.error)
		if (written.value.event) await this.afterWrite(written.value.event)
		return this.extendedResult('thread', principal, Result.ok(written.value.dto))
	}

	/** Hides a thread and all of its posts. The rows stay for moderation history. */
	async deleteThread(principal: Principal, threadRef: string): Promise<ForumResult<void>> {
		if (!parseThreadRef(threadRef)) return notFound('thread')
		const deleted = await this.database.transaction(
			async (tx): Promise<ForumResult<PostAfterWriteEvent>> => {
				const found = await this.findThread(tx, threadRef)
				if (!found || !this.can(principal, 'thread.view', this.threadResource(found.thread))) {
					return notFound('thread')
				}
				const { thread } = found
				if (!this.can(principal, 'thread.delete', this.threadResource(thread))) {
					return denied(principal)
				}
				await tx
					.update(threads)
					.set({ deletedAt: sql`now()` })
					.where(eq(threads.id, thread.id))
				await tx
					.update(categories)
					.set({
						threadCount: sql`${categories.threadCount} - 1`,
						postCount: sql`${categories.postCount} - ${thread.replyCount + 1}`,
					})
					.where(eq(categories.id, thread.categoryId))
				return Result.ok({
					kind: 'thread.deleted',
					principal,
					categoryId: thread.categoryId,
					threadId: thread.id,
					authorId: thread.authorId,
				})
			},
		)
		if (deleted.isErr()) return Result.err(deleted.error)
		await this.afterWrite(deleted.value)
		return Result.ok()
	}

	// ── Posts ───────────────────────────────────────────────────────────────────────────────

	/** Replies to a thread, or inside a floor of it with `parentId` (see `CreatePostInput`). */
	async createPost(principal: Principal, input: CreatePostInput): Promise<ForumResult<PostDto>> {
		const body = validatePostBody(input.body)
		if (!body.ok) return invalid(body.error)
		if (!parseThreadRef(input.threadId)) return notFound('thread')
		if (input.parentId !== undefined && !isEntityId(input.parentId)) return notFound('floor')
		const authorId = principal.userId
		if (authorId !== null) {
			const refused = await this.admit({ kind: 'post.create', principal })
			if (refused) return Result.err(refused)
		}

		const written = await this.database.transaction(
			async (tx): Promise<ForumResult<Readonly<{ dto: PostDto; event: PostAfterWriteEvent }>>> => {
				const found = await this.findThread(tx, input.threadId)
				if (!found || !this.can(principal, 'thread.view', this.threadResource(found.thread))) {
					return notFound('thread')
				}
				const { thread } = found
				if (authorId === null || !this.can(principal, 'post.create', this.threadResource(thread))) {
					return thread.locked && authorId !== null
						? fail('forbidden', 'thread.locked')
						: denied(principal)
				}
				const [by] = await tx.select(author).from(users).where(eq(users.id, authorId))
				if (!by) return denied(GUEST)
				// Where the reply goes: a floor (one level only) or the thread itself.
				let parent: Readonly<{ id: string; authorId: string }> | null = null
				let answered: UserDto | null = null
				if (input.parentId !== undefined) {
					const [target] = await tx
						.select({ post: posts, author })
						.from(posts)
						.innerJoin(users, eq(users.id, posts.authorId))
						.where(and(eq(posts.id, input.parentId), eq(posts.threadId, thread.id)))
					if (!target || target.post.deletedAt !== null) return notFound('floor')
					if (target.post.parentId !== null) {
						const [floor] = await tx
							.select({ id: posts.id, authorId: posts.authorId })
							.from(posts)
							.where(eq(posts.id, target.post.parentId))
						if (!floor) return notFound('floor')
						parent = { id: floor.id, authorId: floor.authorId }
						answered = target.author
					} else if (!target.post.opening) {
						parent = { id: target.post.id, authorId: target.post.authorId }
					}
				}
				const rejected = this.beforeWrite({
					kind: 'post.create',
					principal,
					categoryId: thread.categoryId,
					threadId: thread.id,
					parentId: parent?.id ?? null,
					body: body.value,
				})
				if (rejected) return Result.err(rejected)
				const now = new Date()
				const [updatedThread] = await tx
					.update(threads)
					.set({
						postSeq: sql`${threads.postSeq} + 1`,
						replyCount: sql`${threads.replyCount} + 1`,
						lastPostAt: now,
					})
					.where(eq(threads.id, thread.id))
					.returning({ postSeq: threads.postSeq })
				if (!updatedThread) throw new Error('Thread update returned no row')
				const [post] = await tx
					.insert(posts)
					.values({
						threadId: thread.id,
						number: updatedThread.postSeq,
						parentId: parent?.id ?? null,
						replyToId: answered?.id ?? null,
						authorId,
						body: body.value,
						createdAt: now,
					})
					.returning()
				if (!post) throw new Error('Post insert returned no row')
				await tx
					.update(categories)
					.set({ postCount: sql`${categories.postCount} + 1` })
					.where(eq(categories.id, thread.categoryId))
				return Result.ok({
					dto: this.toPostDto(principal, post, by, thread, answered),
					event: {
						kind: 'post.created',
						principal,
						categoryId: thread.categoryId,
						threadId: thread.id,
						threadRef: formatThreadRef(thread.number, thread.slug),
						threadKind: kindOf(found.category.kind),
						threadAuthorId: thread.authorId,
						threadTitle: thread.title,
						postId: post.id,
						postNumber: post.number,
						parentId: parent?.id ?? null,
						parentAuthorId: parent?.authorId ?? null,
						replyToAuthorId: answered?.id ?? null,
						previousLastPostAt: thread.lastPostAt.toISOString(),
						authorId,
						body: post.body,
						createdAt: post.createdAt.toISOString(),
					},
				})
			},
		)
		if (written.isErr()) return Result.err(written.error)
		await this.afterWrite(written.value.event)
		return this.extendedResult('post', principal, Result.ok(written.value.dto))
	}

	/** Replaces a post's body and keeps the previous one as a revision. */
	async updatePost(
		principal: Principal,
		postId: string,
		input: UpdatePostInput,
	): Promise<ForumResult<PostDto>> {
		const body = validatePostBody(input.body)
		if (!body.ok) return invalid(body.error)
		if (!isEntityId(postId)) return notFound('post')
		const editorId = principal.userId
		if (editorId !== null) {
			const refused = await this.admit({ kind: 'post.update', principal })
			if (refused) return Result.err(refused)
		}

		const written = await this.database.transaction(
			async (
				tx,
			): Promise<ForumResult<Readonly<{ dto: PostDto; event: PostAfterWriteEvent | null }>>> => {
				const found = await this.findPost(tx, principal, postId)
				if (!found) return notFound('post')
				const { post, thread } = found
				const resource = this.postResource(post, thread)
				if (editorId === null || !this.can(principal, 'post.edit', resource)) {
					return denied(principal)
				}
				if (post.opening) {
					// A note's body keeps the note limit when it is edited.
					const [category] = await tx
						.select({ kind: categories.kind })
						.from(categories)
						.where(eq(categories.id, thread.categoryId))
					const limit = this.noteBodyMax()
					if (category?.kind === 'stream' && bodyLength(body.value) > limit) {
						return invalid(errorDetail('field.too_long', { field: 'content', max: limit }))
					}
				}
				const rejected = this.beforeWrite({
					kind: 'post.update',
					principal,
					categoryId: thread.categoryId,
					threadId: thread.id,
					postId: post.id,
					opening: post.opening,
					body: body.value,
				})
				if (rejected) return Result.err(rejected)
				if (post.body === body.value) {
					return Result.ok({
						dto: this.toPostDto(principal, post, found.author, thread),
						event: null,
					})
				}
				await tx.insert(postRevisions).values({ postId: post.id, editorId, body: post.body })
				const [row] = await tx
					.update(posts)
					.set({ body: body.value, editedAt: sql`now()` })
					.where(eq(posts.id, post.id))
					.returning()
				if (!row) throw new Error('Post update returned no row')
				return Result.ok({
					dto: this.toPostDto(principal, row, found.author, thread),
					event: {
						kind: 'post.updated',
						principal,
						categoryId: thread.categoryId,
						threadId: thread.id,
						threadRef: formatThreadRef(thread.number, thread.slug),
						threadTitle: thread.title,
						postId: row.id,
						postNumber: row.number,
						authorId: row.authorId,
						opening: row.opening,
						body: row.body,
						createdAt: row.createdAt.toISOString(),
						editedAt: (row.editedAt ?? row.createdAt).toISOString(),
					},
				})
			},
		)
		if (written.isErr()) return Result.err(written.error)
		if (written.value.event) await this.afterWrite(written.value.event)
		return this.extendedResult('post', principal, Result.ok(written.value.dto))
	}

	/** Hides a reply. The opening post goes away only with its thread. */
	async deletePost(principal: Principal, postId: string): Promise<ForumResult<void>> {
		if (!isEntityId(postId)) return notFound('post')
		const deleted = await this.database.transaction(
			async (tx): Promise<ForumResult<PostAfterWriteEvent>> => {
				const found = await this.findPost(tx, principal, postId)
				if (!found) return notFound('post')
				const { post, thread } = found
				if (!this.can(principal, 'post.delete', this.postResource(post, thread))) {
					return denied(principal)
				}
				if (post.opening) return fail('conflict', 'post.opening_undeletable')
				await tx
					.update(posts)
					.set({ deletedAt: sql`now()` })
					.where(eq(posts.id, post.id))
				await tx
					.update(threads)
					.set({ replyCount: sql`${threads.replyCount} - 1` })
					.where(eq(threads.id, thread.id))
				await tx
					.update(categories)
					.set({ postCount: sql`${categories.postCount} - 1` })
					.where(eq(categories.id, thread.categoryId))
				return Result.ok({
					kind: 'post.deleted',
					principal,
					categoryId: thread.categoryId,
					threadId: thread.id,
					postId: post.id,
					authorId: post.authorId,
				})
			},
		)
		if (deleted.isErr()) return Result.err(deleted.error)
		await this.afterWrite(deleted.value)
		return Result.ok()
	}

	// ── Internals ───────────────────────────────────────────────────────────────────────────

	/** The opening posts of the notes in a listing, so a feed can show them as cards. */
	private async noteOpenings(db: Db, list: readonly ThreadDto[]): Promise<OpeningSource[]> {
		return this.openingsOf(
			db,
			list.filter((thread) => thread.kind === 'note').map((thread) => thread.id),
		)
	}

	private async openingsOf(db: Db, noteIds: readonly string[]): Promise<OpeningSource[]> {
		if (noteIds.length === 0) return []
		const rows = await db
			.select({
				threadId: posts.threadId,
				postId: posts.id,
				body: posts.body,
				createdAt: posts.createdAt,
				editedAt: posts.editedAt,
			})
			.from(posts)
			.where(and(inArray(posts.threadId, [...noteIds]), eq(posts.opening, true)))
		return rows.map((row) => ({
			...row,
			createdAt: row.createdAt.toISOString(),
			editedAt: row.editedAt?.toISOString() ?? null,
		}))
	}

	/** Listed threads with each note's opening post rendered and extended under `opening`. */
	private async withOpenings<T extends ThreadDto>(
		principal: Principal,
		list: readonly T[],
		openings: readonly OpeningSource[],
	): Promise<T[]> {
		if (openings.length === 0) return [...list]
		const threadsById = new Map(list.map((thread) => [thread.id, thread]))
		const drafts: PostDto[] = []
		for (const opening of openings) {
			const thread = threadsById.get(opening.threadId)
			if (!thread) continue
			const resource: ForumResource = {
				categoryId: thread.categoryId,
				threadId: thread.id,
				postId: opening.postId,
				authorId: thread.author.id,
				locked: thread.locked,
			}
			const rendered = this.renderBody(opening.body, opening.postId)
			drafts.push({
				id: opening.postId,
				threadId: thread.id,
				number: 1,
				parentId: null,
				replyTo: null,
				author: thread.author,
				body: opening.body,
				bodyHtml: rendered.html,
				bodyFormat: rendered.format,
				createdAt: opening.createdAt,
				editedAt: opening.editedAt,
				deleted: false,
				can: { edit: this.can(principal, 'post.edit', resource), delete: false },
				ext: {},
			})
		}
		const extended = await this.extended('post', principal, drafts)
		const byThread = new Map(extended.map((post) => [post.threadId, post]))
		return list.map((thread) => {
			const opening = byThread.get(thread.id)
			return opening ? { ...thread, opening } : thread
		})
	}

	private threadResource(thread: ThreadRow): ForumResource {
		return {
			categoryId: thread.categoryId,
			threadId: thread.id,
			authorId: thread.authorId,
			locked: thread.locked,
		}
	}

	private postResource(post: PostRow, thread: ThreadRow): ForumResource {
		return {
			categoryId: thread.categoryId,
			threadId: thread.id,
			postId: post.id,
			authorId: post.authorId,
			locked: thread.locked,
		}
	}

	private admit(event: PostAdmitEvent): Promise<ForumError | null> {
		return this.postHooks.admit(event, (error, hookId) =>
			this.ctx.logger.error('post admit hook failed; continuing without it', {
				error,
				hookId,
				kind: event.kind,
			}),
		)
	}

	private beforeWrite(event: PostBeforeWriteEvent): ForumError | null {
		return this.postHooks.beforeWrite(event, (error, hookId) =>
			this.ctx.logger.error('post beforeWrite hook failed; continuing without it', {
				error,
				hookId,
				kind: event.kind,
			}),
		)
	}

	private async afterWrite(event: PostAfterWriteEvent): Promise<void> {
		await this.listingsChanged()
		await this.postHooks.afterWrite(event, (error, hookId) =>
			this.ctx.logger.error('post afterWrite hook failed', {
				error,
				hookId,
				kind: event.kind,
			}),
		)
	}

	/**
	 * Copies of the user DTOs with extension data attached when any `user` extension contributes
	 * data for them. Users without extension data keep their plain `{ id, displayName }` shape.
	 */
	private async extendedUsers(
		principal: Principal,
		items: readonly UserDto[],
	): Promise<Map<string, UserDto>> {
		const uniqueIds = [...new Set(items.map((item) => item.id))]
		const data = await this.entityExtensions.load(
			'user',
			uniqueIds,
			principal,
			(error, extensionId) =>
				this.ctx.logger.error('entity extension failed; serving the page without it', {
					error,
					extensionId,
					entity: 'user',
				}),
		)
		const byId = new Map<string, UserDto>()
		for (const item of items) {
			if (byId.has(item.id)) continue
			const ext = data.get(item.id)
			byId.set(
				item.id,
				ext && Object.keys(ext).length > 0
					? { id: item.id, handle: item.handle, displayName: item.displayName, ext }
					: { id: item.id, handle: item.handle, displayName: item.displayName },
			)
		}
		return byId
	}

	/**
	 * Copies of the DTOs with the data of every registered extension under `ext` (and `author`
	 * enriched with `user` extensions). An extension that fails or is too slow is logged and left
	 * out; the core's own data is never held back by it.
	 */
	private async extended<T extends Readonly<{ id: string; author: UserDto }>>(
		entity: Exclude<ExtendableEntity, 'user'>,
		principal: Principal,
		items: readonly T[],
	): Promise<T[]> {
		const [data, authors] = await Promise.all([
			this.entityExtensions.load(
				entity,
				items.map((item) => item.id),
				principal,
				(error, extensionId) =>
					this.ctx.logger.error('entity extension failed; serving the page without it', {
						error,
						extensionId,
						entity,
					}),
			),
			this.extendedUsers(
				principal,
				items.map((item) => item.author),
			),
		])
		return items.map((item) => ({
			...item,
			author: authors.get(item.author.id) ?? item.author,
			ext: data.get(item.id) ?? {},
		}))
	}

	/** The DTO a write returned, with extension data attached. */
	private async extendedResult<T extends Readonly<{ id: string; author: UserDto }>>(
		entity: Exclude<ExtendableEntity, 'user'>,
		principal: Principal,
		result: ForumResult<T>,
	): Promise<ForumResult<T>> {
		if (result.isErr()) return result
		const [item] = await this.extended(entity, principal, [result.value])
		return Result.ok(item ?? result.value)
	}

	private toPostDto(
		principal: Principal,
		post: PostRow,
		by: UserDto,
		thread: ThreadRow,
		answered: UserDto | null = null,
	): PostDto {
		const deleted = post.deletedAt !== null
		const resource = this.postResource(post, thread)
		const rendered = deleted ? this.renderBody('', post.id) : this.renderBody(post.body, post.id)
		return {
			id: post.id,
			threadId: post.threadId,
			number: post.number,
			parentId: post.parentId,
			replyTo: answered
				? { id: answered.id, handle: answered.handle, displayName: answered.displayName }
				: null,
			author: { id: by.id, handle: by.handle, displayName: by.displayName },
			body: deleted ? '' : post.body,
			bodyHtml: rendered.html,
			bodyFormat: rendered.format,
			createdAt: post.createdAt.toISOString(),
			editedAt: post.editedAt?.toISOString() ?? null,
			deleted,
			can: {
				edit: !deleted && this.can(principal, 'post.edit', resource),
				delete: !deleted && !post.opening && this.can(principal, 'post.delete', resource),
			},
			ext: {},
		}
	}

	/** A post body as HTML, from the cache when the same source was rendered before. */
	private renderBody(source: string, postId: string): RenderedBody {
		const render = () => {
			let failed = false
			const body = this.contentRenderers.render(source, (error, rendererId) => {
				failed = true
				this.ctx.logger.error('content renderer failed; showing the post as plain text', {
					error,
					rendererId,
					postId,
				})
			})
			return { body, failed }
		}
		if (source === '') return render().body
		return this.cache.rendered(
			`${this.renderGeneration}:${digest(source)}`,
			render,
			(error, cacheId) =>
				this.ctx.logger.error('cache failed; rendering the post again', { error, cacheId }),
		)
	}

	/** A thread that has not been deleted, with its author and category. */
	private async findThread(db: Db, threadRef: string) {
		const parsed = parseThreadRef(threadRef)
		if (!parsed) return undefined
		const match =
			parsed.kind === 'id' ? eq(threads.id, parsed.id) : eq(threads.number, parsed.number)
		const [row] = await db
			.select({ thread: threads, author, category: categories })
			.from(threads)
			.innerJoin(users, eq(users.id, threads.authorId))
			.innerJoin(categories, eq(categories.id, threads.categoryId))
			.where(and(match, isNull(threads.deletedAt)))
		return row
	}

	/** A visible post in a visible thread that the principal may see. */
	private async findPost(db: Db, principal: Principal, postId: string) {
		const [row] = await db
			.select({ post: posts, author, thread: threads, kind: categories.kind })
			.from(posts)
			.innerJoin(users, eq(users.id, posts.authorId))
			.innerJoin(threads, eq(threads.id, posts.threadId))
			.innerJoin(categories, eq(categories.id, threads.categoryId))
			.where(and(eq(posts.id, postId), isNull(posts.deletedAt), isNull(threads.deletedAt)))
		if (!row || !this.can(principal, 'thread.view', this.threadResource(row.thread))) {
			return undefined
		}
		return row
	}
}
