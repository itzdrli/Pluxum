import {
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
	type CategorySummaryDto,
	type CategoryThreadsDto,
	type ForumAction,
	type ForumError,
	type ForumErrorCode,
	type ForumNotification,
	type ForumResource,
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
import { and, asc, count, desc, eq, gt, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import {
	categories,
	ForumDatabase,
	postRevisions,
	posts,
	threads,
	userRoles,
	users,
} from './database'
import { ContentRendererRegistry, type ContentRendererContribution } from './content'
import {
	EntityExtensionRegistry,
	UiSlotRegistry,
	type EntityExtensionContribution,
	type ExtendableEntity,
	type UiSlotContribution,
} from './extensions'
import {
	PostHookRegistry,
	type PostAfterWriteEvent,
	type PostBeforeWriteEvent,
	type PostHookContribution,
} from './hooks'
import { ForumAdminTarget } from './admin-target'
import { ForumCoreConfig } from './config'
import { FooterLinkRegistry, type FooterLinkContribution } from './footer'
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
export type {
	EntityExtensionContribution,
	ExtendableEntity,
	UiSlotContribution,
} from './extensions'
export type {
	PostAfterWriteEvent,
	PostBeforeWriteEvent,
	PostHookContribution,
	PostHookRejection,
	PostHookRejectionCode,
} from './hooks'
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
export type CreateThreadInput = Readonly<{ categoryId: string; title: string; body: string }>
export type UpdateThreadInput = Readonly<{ title?: string; pinned?: boolean; locked?: boolean }>
export type CreatePostInput = Readonly<{ threadId: string; body: string }>
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

const fail = (code: ForumErrorCode, message: string): Result<never, ForumError> =>
	Result.err({ code, message })
const notFound = (what: string) => fail('not_found', `${what}不存在`)
const invalid = (message: string) => fail('invalid', message)
const denied = (principal: Principal) =>
	principal.userId === null
		? fail('unauthenticated', '请先登录')
		: fail('forbidden', '没有权限执行此操作')

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
		threadCount: row.threadCount,
		postCount: row.postCount,
	}
}

function toThreadDto(row: ThreadRow, by: UserDto): ThreadDto {
	return {
		id: row.id,
		number: row.number,
		slug: row.slug,
		ref: formatThreadRef(row.number, row.slug),
		categoryId: row.categoryId,
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
	private readonly postHooks = new PostHookRegistry()
	private readonly notificationChannels = new NotificationChannelRegistry()
	private readonly searchProviders = new SearchProviderRegistry()

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
		return this.contentRenderers.register(contribution)
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
		if (!body.ok) return invalid(body.reason)
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
		if (!this.searchProviders.available()) return fail('unavailable', '搜索服务未启用')
		const query = validateSearchQuery(request.query)
		if (!query.ok) return invalid(query.reason)
		if (request.categoryId !== undefined && !isEntityId(request.categoryId)) {
			return notFound('版块')
		}
		let resolvedAuthorId: string | undefined
		if (request.authorId !== undefined) {
			const parsedAuthor = parseUserRef(request.authorId)
			if (!parsedAuthor) return notFound('用户')
			if (parsedAuthor.kind === 'id') {
				resolvedAuthorId = parsedAuthor.id
			} else {
				const [foundAuthor] = await this.database.read((db) =>
					db.select({ id: users.id }).from(users).where(eq(users.handle, parsedAuthor.handle)),
				)
				if (!foundAuthor) return notFound('用户')
				resolvedAuthorId = foundAuthor.id
			}
		}
		const { page, pageSize } = normalizePage(request)
		const visibleCategories = await this.listCategories(principal)
		const visibleIds = new Set(visibleCategories.map((category) => category.id))
		let categoryIds: string[]
		if (request.categoryId !== undefined) {
			if (!visibleIds.has(request.categoryId)) return notFound('版块')
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
		if (!raw) return fail('unavailable', '搜索服务暂时不可用')
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
			author: authorsById.get(hit.authorId) ?? {
				id: hit.authorId,
				handle: hit.authorId,
				displayName: '未知用户',
			},
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
		if (!isEntityId(postId)) return notFound('帖子')
		const found = await this.database.read((db) => this.findPost(db, principal, postId))
		if (!found) return notFound('帖子')
		return Result.ok({
			postId: found.post.id,
			threadId: found.thread.id,
			threadRef: formatThreadRef(found.thread.number, found.thread.slug),
			postNumber: found.post.number,
			resource: this.postResource(found.post, found.thread),
		})
	}

	// ── Users ───────────────────────────────────────────────────────────────────────────────

	/** Returns the account for an identity-provider subject, creating it on first sight. */
	async ensureUser(input: EnsureUserInput): Promise<ForumResult<UserDto>> {
		const subject = typeof input.subject === 'string' ? input.subject.trim() : ''
		if (!subject || subject.length > 255) return invalid('无效的账号标识')
		const displayName = validateDisplayName(input.displayName)
		if (!displayName.ok) return invalid(displayName.reason)
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

	private createOrFindUser(
		subject: string,
		displayName: string,
		handleHint: string | undefined,
	): Promise<ForumResult<UserDto>> {
		return this.database.transaction(async (tx) => {
			const [existing] = await tx.select(author).from(users).where(eq(users.subject, subject))
			if (existing) return Result.ok(existing)

			const tempHandle = `u-tmp-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`
			const [inserted] = await tx
				.insert(users)
				.values({ subject, handle: tempHandle, displayName })
				.onConflictDoNothing({ target: users.subject })
				.returning({ id: users.id, number: users.number })

			if (inserted) {
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
	}

	/** The account of an identity-provider subject, or null when it has never logged in. */
	async findUserBySubject(subject: string): Promise<UserDto | null> {
		const [user] = await this.database.read((db) =>
			db.select(author).from(users).where(eq(users.subject, subject)),
		)
		return user ?? null
	}

	/** Privileged: changes an account's display name; callers decide who may. */
	async renameUser(userId: string, displayName: string): Promise<ForumResult<UserDto>> {
		if (!isEntityId(userId)) return notFound('用户')
		const name = validateDisplayName(displayName)
		if (!name.ok) return invalid(name.reason)
		const [user] = await this.database.transaction((tx) =>
			tx
				.update(users)
				.set({ displayName: name.value })
				.where(eq(users.id, userId))
				.returning(author),
		)
		return user ? Result.ok(user) : notFound('用户')
	}

	async getUser(userRef: string, viewer: Principal = GUEST): Promise<ForumResult<UserDto>> {
		const parsed = parseUserRef(userRef)
		if (!parsed) return notFound('用户')
		const match = parsed.kind === 'id' ? eq(users.id, parsed.id) : eq(users.handle, parsed.handle)
		const [user] = await this.database.read((db) => db.select(author).from(users).where(match))
		if (!user) return notFound('用户')
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
		if (!parsed) return notFound('用户')
		const patch: Partial<Pick<typeof users.$inferInsert, 'displayName' | 'handle'>> = {}
		if (input.displayName !== undefined) {
			const name = validateDisplayName(input.displayName)
			if (!name.ok) return invalid(name.reason)
			patch.displayName = name.value
		}
		if (input.handle !== undefined) {
			const handle = validateHandle(input.handle)
			if (!handle.ok) return invalid(handle.reason)
			patch.handle = handle.value
		}

		const updated = await this.database
			.transaction(async (tx): Promise<ForumResult<UserDto>> => {
				const match =
					parsed.kind === 'id' ? eq(users.id, parsed.id) : eq(users.handle, parsed.handle)
				const [current] = await tx.select(author).from(users).where(match)
				if (!current) return notFound('用户')
				if (!this.can(principal, 'user.edit', { userId: current.id })) return denied(principal)
				if (Object.keys(patch).length === 0) return Result.ok(current)
				if (patch.handle !== undefined && patch.handle !== current.handle) {
					const [taken] = await tx
						.select({ id: users.id })
						.from(users)
						.where(eq(users.handle, patch.handle))
					if (taken) return fail('conflict', '用户名已被使用')
				}
				const [row] = await tx
					.update(users)
					.set(patch)
					.where(eq(users.id, current.id))
					.returning(author)
				return row ? Result.ok(row) : notFound('用户')
			})
			// Another account took the handle between the check above and the write.
			.catch((error: unknown) => {
				if (isUniqueViolation(error)) return fail('conflict', '用户名已被使用')
				throw error
			})
		if (updated.isErr()) return updated
		const enriched = await this.extendedUsers(principal, [updated.value])
		return Result.ok(enriched.get(updated.value.id) ?? updated.value)
	}

	/** Public profile of a user together with one page of their visible threads. */
	async getUserProfile(
		principal: Principal,
		userRef: string,
		paging: PageRequest = {},
	): Promise<ForumResult<UserProfileDto>> {
		const parsed = parseUserRef(userRef)
		if (!parsed) return notFound('用户')
		const { page, pageSize } = normalizePage(paging)
		const visibleCategories = await this.listCategories(principal)
		const visibleCategoryIds = visibleCategories.map((category) => category.id)

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
					postCount: 0,
					threadRows: [] as ThreadRow[],
				}
			}

			const visibleThreads = and(
				eq(threads.authorId, account.id),
				isNull(threads.deletedAt),
				inArray(threads.categoryId, visibleCategoryIds),
			)
			const [threadTotal] = await db.select({ value: count() }).from(threads).where(visibleThreads)
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
				.where(visibleThreads)
				.orderBy(desc(threads.createdAt), desc(threads.id))
				.limit(pageSize)
				.offset((page - 1) * pageSize)

			return {
				account,
				roles,
				threadCount: threadTotal?.value ?? 0,
				postCount: postTotal?.value ?? 0,
				threadRows,
			}
		})
		if (!read) return notFound('用户')

		const baseUser: UserDto = {
			id: read.account.id,
			handle: read.account.handle,
			displayName: read.account.displayName,
		}
		const rawThreads = read.threadRows.map((row) => toThreadDto(row, baseUser))
		const [usersById, extendedThreads] = await Promise.all([
			this.extendedUsers(principal, [baseUser]),
			this.extended('thread', principal, rawThreads),
		])
		const user = usersById.get(baseUser.id) ?? baseUser

		return Result.ok({
			user,
			roles: read.roles,
			createdAt: read.account.createdAt.toISOString(),
			threadCount: read.threadCount,
			postCount: read.postCount,
			threads: {
				items: extendedThreads,
				page,
				pageSize,
				total: read.threadCount,
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
		if (!isAssignableRole(role)) return invalid('未知的角色')
		if (!isEntityId(userId)) return notFound('用户')
		return this.database.transaction(async (tx) => {
			const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId))
			if (!user) return notFound('用户')
			await tx.insert(userRoles).values({ userId, role }).onConflictDoNothing()
			return Result.ok()
		})
	}

	async revokeRole(userId: string, role: AssignableRole): Promise<ForumResult<void>> {
		if (!isEntityId(userId)) return notFound('用户')
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
		if (!name.ok) return invalid(name.reason)
		const slug = validateSlug(input.slug ?? slugify(name.value))
		if (!slug.ok) {
			return invalid(input.slug === undefined ? '无法从名称生成标识，请手动填写' : slug.reason)
		}
		const description = validateCategoryDescription(input.description ?? '')
		if (!description.ok) return invalid(description.reason)
		const position = input.position ?? 0
		if (!Number.isSafeInteger(position)) return invalid('排序必须是整数')

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
		return row ? Result.ok(toCategoryDto(row)) : fail('conflict', '版块标识已被使用')
	}

	async updateCategory(
		principal: Principal,
		categoryId: string,
		input: UpdateCategoryInput,
	): Promise<ForumResult<CategoryDto>> {
		if (!this.can(principal, 'category.manage', { categoryId })) return denied(principal)
		if (!isEntityId(categoryId)) return notFound('版块')
		const patch: Partial<Pick<CategoryRow, 'name' | 'slug' | 'description' | 'position'>> = {}
		if (input.name !== undefined) {
			const name = validateCategoryName(input.name)
			if (!name.ok) return invalid(name.reason)
			patch.name = name.value
		}
		if (input.slug !== undefined) {
			const slug = validateSlug(input.slug)
			if (!slug.ok) return invalid(slug.reason)
			patch.slug = slug.value
		}
		if (input.description !== undefined) {
			const description = validateCategoryDescription(input.description)
			if (!description.ok) return invalid(description.reason)
			patch.description = description.value
		}
		if (input.position !== undefined) {
			if (!Number.isSafeInteger(input.position)) return invalid('排序必须是整数')
			patch.position = input.position
		}

		return this.database.transaction(async (tx) => {
			const [current] = await tx.select().from(categories).where(eq(categories.id, categoryId))
			if (!current) return notFound('版块')
			if (Object.keys(patch).length === 0) return Result.ok(toCategoryDto(current))
			if (patch.slug !== undefined && patch.slug !== current.slug) {
				const [taken] = await tx
					.select({ id: categories.id })
					.from(categories)
					.where(eq(categories.slug, patch.slug))
				if (taken) return fail('conflict', '版块标识已被使用')
			}
			const [row] = await tx
				.update(categories)
				.set(patch)
				.where(eq(categories.id, categoryId))
				.returning()
			return row ? Result.ok(toCategoryDto(row)) : notFound('版块')
		})
	}

	/** Only a category that never held a thread can be removed; history is not discarded. */
	async deleteCategory(principal: Principal, categoryId: string): Promise<ForumResult<void>> {
		if (!this.can(principal, 'category.manage', { categoryId })) return denied(principal)
		if (!isEntityId(categoryId)) return notFound('版块')
		return this.database.transaction(async (tx) => {
			const [used] = await tx
				.select({ id: threads.id })
				.from(threads)
				.where(eq(threads.categoryId, categoryId))
				.limit(1)
			if (used) return fail('conflict', '版块内已有主题，不能删除')
			const removed = await tx
				.delete(categories)
				.where(eq(categories.id, categoryId))
				.returning({ id: categories.id })
			return removed.length > 0 ? Result.ok() : notFound('版块')
		})
	}

	// ── Threads ─────────────────────────────────────────────────────────────────────────────

	/** One page of the most recently active threads across every category the viewer may see. */
	async listRecentThreads(
		principal: Principal,
		paging: PageRequest = {},
	): Promise<RecentThreadsDto> {
		const { page, pageSize } = normalizePage(paging)
		const read = await this.database.read(async (db) => {
			const allCategories = await db
				.select({
					id: categories.id,
					slug: categories.slug,
					name: categories.name,
				})
				.from(categories)
				.orderBy(asc(categories.position), asc(categories.id))
			const visibleCategories = allCategories.filter((category) =>
				this.can(principal, 'category.view', { categoryId: category.id }),
			)
			if (visibleCategories.length === 0) return null

			const visibleIds = visibleCategories.map((category) => category.id)
			const categoriesById = new Map<string, CategorySummaryDto>(
				visibleCategories.map((category) => [category.id, category]),
			)
			const visible = and(inArray(threads.categoryId, visibleIds), isNull(threads.deletedAt))
			const [total] = await db.select({ value: count() }).from(threads).where(visible)
			const rows = await db
				.select({ thread: threads, author })
				.from(threads)
				.innerJoin(users, eq(users.id, threads.authorId))
				.where(visible)
				.orderBy(desc(threads.lastPostAt), desc(threads.id))
				.limit(pageSize)
				.offset((page - 1) * pageSize)
			return {
				categoriesById,
				rows,
				total: total?.value ?? 0,
			}
		})
		if (!read) return { items: [], page, pageSize, total: 0 }

		const baseThreads = read.rows.map((row) => toThreadDto(row.thread, row.author))
		const extendedThreads = await this.extended('thread', principal, baseThreads)
		const items: RecentThreadDto[] = extendedThreads.flatMap((thread) => {
			const category = read.categoriesById.get(thread.categoryId)
			return category ? [{ ...thread, category }] : []
		})
		return {
			items,
			page,
			pageSize,
			total: read.total,
		}
	}

	/** One page of a category's threads: pinned first, then most recently active. */
	async listThreads(
		principal: Principal,
		categorySlug: string,
		paging: PageRequest = {},
	): Promise<ForumResult<CategoryThreadsDto>> {
		const { page, pageSize } = normalizePage(paging)
		const listing = await this.database.read(
			async (db): Promise<ForumResult<CategoryThreadsDto>> => {
				const [category] = await db
					.select()
					.from(categories)
					.where(eq(categories.slug, categorySlug))
				if (!category || !this.can(principal, 'category.view', { categoryId: category.id })) {
					return notFound('版块')
				}
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
				return Result.ok({
					category: toCategoryDto(category),
					threads: {
						items: rows.map((row) => toThreadDto(row.thread, row.author)),
						page,
						pageSize,
						total: total?.value ?? 0,
					},
					can: {
						createThread: this.can(principal, 'thread.create', { categoryId: category.id }),
					},
				})
			},
		)
		if (listing.isErr()) return listing
		const { threads: threadPage } = listing.value
		return Result.ok({
			...listing.value,
			threads: { ...threadPage, items: await this.extended('thread', principal, threadPage.items) },
		})
	}

	/** A thread with one page of its posts, oldest first. Deleted posts stay as placeholders. */
	async getThread(
		principal: Principal,
		threadRef: string,
		paging: PageRequest = {},
	): Promise<ForumResult<ThreadDetailDto>> {
		if (!parseThreadRef(threadRef)) return notFound('主题')
		const { page, pageSize } = normalizePage(paging)
		const detail = await this.database.read(async (db): Promise<ForumResult<ThreadDetailDto>> => {
			const found = await this.findThread(db, threadRef)
			if (!found || !this.can(principal, 'thread.view', this.threadResource(found.thread))) {
				return notFound('主题')
			}
			const { thread, category } = found
			const inThread = eq(posts.threadId, thread.id)
			const [total] = await db.select({ value: count() }).from(posts).where(inThread)
			const rows = await db
				.select({ post: posts, author })
				.from(posts)
				.innerJoin(users, eq(users.id, posts.authorId))
				.where(inThread)
				.orderBy(asc(posts.number), asc(posts.id))
				.limit(pageSize)
				.offset((page - 1) * pageSize)
			const resource = this.threadResource(thread)
			return Result.ok({
				thread: toThreadDto(thread, found.author),
				category: toCategoryDto(category),
				posts: {
					items: rows.map((row) => this.toPostDto(principal, row.post, row.author, thread)),
					page,
					pageSize,
					total: total?.value ?? 0,
				},
				can: {
					reply: this.can(principal, 'post.create', resource),
					edit: this.can(principal, 'thread.edit', resource),
					delete: this.can(principal, 'thread.delete', resource),
					moderate: this.can(principal, 'thread.moderate', resource),
				},
			})
		})
		if (detail.isErr()) return detail
		// Extensions answer after the core's own read has finished, each with one batch per entity.
		const [[thread], items] = await Promise.all([
			this.extended('thread', principal, [detail.value.thread]),
			this.extended('post', principal, detail.value.posts.items),
		])
		return Result.ok({
			...detail.value,
			thread: thread ?? detail.value.thread,
			posts: { ...detail.value.posts, items },
		})
	}

	/** Creates a thread together with its opening post. */
	async createThread(
		principal: Principal,
		input: CreateThreadInput,
	): Promise<ForumResult<ThreadDto>> {
		const title = validateThreadTitle(input.title)
		if (!title.ok) return invalid(title.reason)
		const body = validatePostBody(input.body)
		if (!body.ok) return invalid(body.reason)
		const { categoryId } = input
		if (!isEntityId(categoryId)) return notFound('版块')
		if (!this.can(principal, 'thread.create', { categoryId })) return denied(principal)
		const authorId = principal.userId
		if (authorId === null) return denied(principal)
		const slug = slugifyAsciiTitle(title.value)

		const written = await this.database.transaction(
			async (
				tx,
			): Promise<ForumResult<Readonly<{ dto: ThreadDto; event: PostAfterWriteEvent }>>> => {
				const [by] = await tx.select(author).from(users).where(eq(users.id, authorId))
				if (!by) return denied(GUEST)
				const [category] = await tx
					.select({ id: categories.id })
					.from(categories)
					.where(eq(categories.id, categoryId))
				if (!category) return notFound('版块')
				const rejected = this.beforeWrite({
					kind: 'thread.create',
					principal,
					categoryId,
					title: title.value,
					body: body.value,
				})
				if (rejected) return Result.err(rejected)
				const [thread] = await tx
					.insert(threads)
					.values({ categoryId, authorId, title: title.value, slug, postSeq: 1 })
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
				const dto = toThreadDto(thread, by)
				return Result.ok({
					dto,
					event: {
						kind: 'thread.created',
						principal,
						categoryId,
						threadId: thread.id,
						threadRef: dto.ref,
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

	/** Renames a thread (`thread.edit`) and/or pins or locks it (`thread.moderate`). */
	async updateThread(
		principal: Principal,
		threadRef: string,
		input: UpdateThreadInput,
	): Promise<ForumResult<ThreadDto>> {
		if (!parseThreadRef(threadRef)) return notFound('主题')
		const patch: Partial<Pick<ThreadRow, 'title' | 'slug' | 'pinned' | 'locked'>> = {}
		if (input.title !== undefined) {
			const title = validateThreadTitle(input.title)
			if (!title.ok) return invalid(title.reason)
			patch.title = title.value
			patch.slug = slugifyAsciiTitle(title.value)
		}
		if (input.pinned !== undefined) patch.pinned = input.pinned
		if (input.locked !== undefined) patch.locked = input.locked

		const written = await this.database.transaction(
			async (
				tx,
			): Promise<ForumResult<Readonly<{ dto: ThreadDto; event: PostAfterWriteEvent | null }>>> => {
				const found = await this.findThread(tx, threadRef)
				if (!found || !this.can(principal, 'thread.view', this.threadResource(found.thread))) {
					return notFound('主题')
				}
				const resource = this.threadResource(found.thread)
				if (patch.title !== undefined && !this.can(principal, 'thread.edit', resource)) {
					return denied(principal)
				}
				if (
					(patch.pinned !== undefined || patch.locked !== undefined) &&
					!this.can(principal, 'thread.moderate', resource)
				) {
					return denied(principal)
				}
				if (Object.keys(patch).length === 0) {
					return Result.ok({ dto: toThreadDto(found.thread, found.author), event: null })
				}
				if (patch.title !== undefined) {
					const rejected = this.beforeWrite({
						kind: 'thread.update',
						principal,
						categoryId: found.thread.categoryId,
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
				if (!row) return notFound('主题')
				const [opening] = await tx
					.select({ id: posts.id, body: posts.body })
					.from(posts)
					.where(and(eq(posts.threadId, found.thread.id), eq(posts.opening, true)))
				const dto = toThreadDto(row, found.author)
				return Result.ok({
					dto,
					event: opening
						? {
								kind: 'thread.updated',
								principal,
								categoryId: row.categoryId,
								threadId: row.id,
								threadRef: dto.ref,
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
		if (!parseThreadRef(threadRef)) return notFound('主题')
		const deleted = await this.database.transaction(
			async (tx): Promise<ForumResult<PostAfterWriteEvent>> => {
				const found = await this.findThread(tx, threadRef)
				if (!found || !this.can(principal, 'thread.view', this.threadResource(found.thread))) {
					return notFound('主题')
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

	async createPost(principal: Principal, input: CreatePostInput): Promise<ForumResult<PostDto>> {
		const body = validatePostBody(input.body)
		if (!body.ok) return invalid(body.reason)
		if (!parseThreadRef(input.threadId)) return notFound('主题')
		const authorId = principal.userId

		const written = await this.database.transaction(
			async (tx): Promise<ForumResult<Readonly<{ dto: PostDto; event: PostAfterWriteEvent }>>> => {
				const found = await this.findThread(tx, input.threadId)
				if (!found || !this.can(principal, 'thread.view', this.threadResource(found.thread))) {
					return notFound('主题')
				}
				const { thread } = found
				if (authorId === null || !this.can(principal, 'post.create', this.threadResource(thread))) {
					return thread.locked && authorId !== null
						? fail('forbidden', '主题已锁定，不能回复')
						: denied(principal)
				}
				const [by] = await tx.select(author).from(users).where(eq(users.id, authorId))
				if (!by) return denied(GUEST)
				const rejected = this.beforeWrite({
					kind: 'post.create',
					principal,
					categoryId: thread.categoryId,
					threadId: thread.id,
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
					dto: this.toPostDto(principal, post, by, thread),
					event: {
						kind: 'post.created',
						principal,
						categoryId: thread.categoryId,
						threadId: thread.id,
						threadRef: formatThreadRef(thread.number, thread.slug),
						threadAuthorId: thread.authorId,
						threadTitle: thread.title,
						postId: post.id,
						postNumber: post.number,
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
		if (!body.ok) return invalid(body.reason)
		if (!isEntityId(postId)) return notFound('帖子')
		const editorId = principal.userId

		const written = await this.database.transaction(
			async (
				tx,
			): Promise<ForumResult<Readonly<{ dto: PostDto; event: PostAfterWriteEvent | null }>>> => {
				const found = await this.findPost(tx, principal, postId)
				if (!found) return notFound('帖子')
				const { post, thread } = found
				const resource = this.postResource(post, thread)
				if (editorId === null || !this.can(principal, 'post.edit', resource)) {
					return denied(principal)
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
		if (!isEntityId(postId)) return notFound('帖子')
		const deleted = await this.database.transaction(
			async (tx): Promise<ForumResult<PostAfterWriteEvent>> => {
				const found = await this.findPost(tx, principal, postId)
				if (!found) return notFound('帖子')
				const { post, thread } = found
				if (!this.can(principal, 'post.delete', this.postResource(post, thread))) {
					return denied(principal)
				}
				if (post.opening) return fail('conflict', '主楼不能单独删除，请删除整个主题')
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

	private toPostDto(principal: Principal, post: PostRow, by: UserDto, thread: ThreadRow): PostDto {
		const deleted = post.deletedAt !== null
		const resource = this.postResource(post, thread)
		const rendered = this.contentRenderers.render(deleted ? '' : post.body, (error, rendererId) =>
			this.ctx.logger.error('content renderer failed; showing the post as plain text', {
				error,
				rendererId,
				postId: post.id,
			}),
		)
		return {
			id: post.id,
			threadId: post.threadId,
			number: post.number,
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
			.select({ post: posts, author, thread: threads })
			.from(posts)
			.innerJoin(users, eq(users.id, posts.authorId))
			.innerJoin(threads, eq(threads.id, posts.threadId))
			.where(and(eq(posts.id, postId), isNull(posts.deletedAt), isNull(threads.deletedAt)))
		if (!row || !this.can(principal, 'thread.view', this.threadResource(row.thread))) {
			return undefined
		}
		return row
	}
}
