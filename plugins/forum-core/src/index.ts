import {
	defaultRolePolicy,
	evaluatePolicies,
	GUEST,
	isAssignableRole,
	isEntityId,
	normalizePage,
	slugify,
	validateCategoryDescription,
	validateCategoryName,
	validateDisplayName,
	validatePostBody,
	validateSlug,
	validateThreadTitle,
	type AssignableRole,
	type BodyFormat,
	type CategoryDto,
	type CategoryThreadsDto,
	type ForumAction,
	type ForumError,
	type ForumErrorCode,
	type ForumResource,
	type PageRequest,
	type PostDto,
	type PreviewDto,
	type Principal,
	type Role,
	type ThreadDetailDto,
	type ThreadDto,
	type UiSlotDto,
	type UserDto,
} from '@forum/domain'
import { BasePlugin, Plugin } from '@pluxel/core'
import { Result } from '@pluxel/core/better-result'
import {
	Database,
	type PluginDatabaseClient,
	type PluginDatabaseHandle,
} from '@pluxel/services/database'
import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm'
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
import { PolicyRegistry, type PermissionPolicyContribution } from './policies'

export type { ContentRendererContribution } from './content'
export type {
	EntityExtensionContribution,
	ExtendableEntity,
	UiSlotContribution,
} from './extensions'
export type { PermissionPolicyContribution } from './policies'

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
export type EnsureUserInput = Readonly<{ subject: string; displayName: string }>

/**
 * A post that exists and that the asking principal may see, as extension plugins need it: the
 * stable IDs to key their own rows by, and the facts permission checks take.
 */
export type PostLocation = Readonly<{
	postId: string
	threadId: string
	resource: ForumResource
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

const author = { id: users.id, displayName: users.displayName }

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
		categoryId: row.categoryId,
		title: row.title,
		author: { id: by.id, displayName: by.displayName },
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
	private database!: PluginDatabaseHandle<typeof ForumDatabase>
	private readonly permissionPolicies = new PolicyRegistry()
	private readonly contentRenderers = new ContentRendererRegistry()
	private readonly entityExtensions = new EntityExtensionRegistry()
	private readonly uiSlotContributions = new UiSlotRegistry()

	protected override async init(): Promise<void> {
		this.database = await this.ctx.require(Database).use(ForumDatabase)
		this.permissionPolicies.register({ id: BUILT_IN_POLICY_ID, evaluate: defaultRolePolicy })
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
		return this.database.transaction(async (tx) => {
			await tx
				.insert(users)
				.values({ subject, displayName: displayName.value })
				.onConflictDoNothing({ target: users.subject })
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

	async getUser(userId: string): Promise<ForumResult<UserDto>> {
		if (!isEntityId(userId)) return notFound('用户')
		const [user] = await this.database.read((db) =>
			db.select(author).from(users).where(eq(users.id, userId)),
		)
		return user ? Result.ok(user) : notFound('用户')
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
		threadId: string,
		paging: PageRequest = {},
	): Promise<ForumResult<ThreadDetailDto>> {
		if (!isEntityId(threadId)) return notFound('主题')
		const { page, pageSize } = normalizePage(paging)
		const detail = await this.database.read(async (db): Promise<ForumResult<ThreadDetailDto>> => {
			const found = await this.findThread(db, threadId)
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
				.orderBy(desc(posts.opening), asc(posts.createdAt), asc(posts.id))
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

		const written = await this.database.transaction(async (tx): Promise<ForumResult<ThreadDto>> => {
			const [by] = await tx.select(author).from(users).where(eq(users.id, authorId))
			if (!by) return denied(GUEST)
			const [category] = await tx
				.select({ id: categories.id })
				.from(categories)
				.where(eq(categories.id, categoryId))
			if (!category) return notFound('版块')
			const [thread] = await tx
				.insert(threads)
				.values({ categoryId, authorId, title: title.value })
				.returning()
			if (!thread) throw new Error('Thread insert returned no row')
			await tx
				.insert(posts)
				.values({ threadId: thread.id, authorId, body: body.value, opening: true })
			await tx
				.update(categories)
				.set({
					threadCount: sql`${categories.threadCount} + 1`,
					postCount: sql`${categories.postCount} + 1`,
				})
				.where(eq(categories.id, categoryId))
			return Result.ok(toThreadDto(thread, by))
		})
		return this.extendedResult('thread', principal, written)
	}

	/** Renames a thread (`thread.edit`) and/or pins or locks it (`thread.moderate`). */
	async updateThread(
		principal: Principal,
		threadId: string,
		input: UpdateThreadInput,
	): Promise<ForumResult<ThreadDto>> {
		if (!isEntityId(threadId)) return notFound('主题')
		const patch: Partial<Pick<ThreadRow, 'title' | 'pinned' | 'locked'>> = {}
		if (input.title !== undefined) {
			const title = validateThreadTitle(input.title)
			if (!title.ok) return invalid(title.reason)
			patch.title = title.value
		}
		if (input.pinned !== undefined) patch.pinned = input.pinned
		if (input.locked !== undefined) patch.locked = input.locked

		const written = await this.database.transaction(async (tx): Promise<ForumResult<ThreadDto>> => {
			const found = await this.findThread(tx, threadId)
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
				return Result.ok(toThreadDto(found.thread, found.author))
			}
			const [row] = await tx.update(threads).set(patch).where(eq(threads.id, threadId)).returning()
			return row ? Result.ok(toThreadDto(row, found.author)) : notFound('主题')
		})
		return this.extendedResult('thread', principal, written)
	}

	/** Hides a thread and all of its posts. The rows stay for moderation history. */
	async deleteThread(principal: Principal, threadId: string): Promise<ForumResult<void>> {
		if (!isEntityId(threadId)) return notFound('主题')
		return this.database.transaction(async (tx) => {
			const found = await this.findThread(tx, threadId)
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
			return Result.ok()
		})
	}

	// ── Posts ───────────────────────────────────────────────────────────────────────────────

	async createPost(principal: Principal, input: CreatePostInput): Promise<ForumResult<PostDto>> {
		const body = validatePostBody(input.body)
		if (!body.ok) return invalid(body.reason)
		if (!isEntityId(input.threadId)) return notFound('主题')
		const authorId = principal.userId

		const written = await this.database.transaction(async (tx): Promise<ForumResult<PostDto>> => {
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
			const [post] = await tx
				.insert(posts)
				.values({ threadId: thread.id, authorId, body: body.value })
				.returning()
			if (!post) throw new Error('Post insert returned no row')
			await tx
				.update(threads)
				.set({ replyCount: sql`${threads.replyCount} + 1`, lastPostAt: post.createdAt })
				.where(eq(threads.id, thread.id))
			await tx
				.update(categories)
				.set({ postCount: sql`${categories.postCount} + 1` })
				.where(eq(categories.id, thread.categoryId))
			return Result.ok(this.toPostDto(principal, post, by, thread))
		})
		return this.extendedResult('post', principal, written)
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

		const written = await this.database.transaction(async (tx): Promise<ForumResult<PostDto>> => {
			const found = await this.findPost(tx, principal, postId)
			if (!found) return notFound('帖子')
			const { post, thread } = found
			const resource = this.postResource(post, thread)
			if (editorId === null || !this.can(principal, 'post.edit', resource)) {
				return denied(principal)
			}
			if (post.body === body.value) {
				return Result.ok(this.toPostDto(principal, post, found.author, thread))
			}
			await tx.insert(postRevisions).values({ postId: post.id, editorId, body: post.body })
			const [row] = await tx
				.update(posts)
				.set({ body: body.value, editedAt: sql`now()` })
				.where(eq(posts.id, post.id))
				.returning()
			if (!row) throw new Error('Post update returned no row')
			return Result.ok(this.toPostDto(principal, row, found.author, thread))
		})
		return this.extendedResult('post', principal, written)
	}

	/** Hides a reply. The opening post goes away only with its thread. */
	async deletePost(principal: Principal, postId: string): Promise<ForumResult<void>> {
		if (!isEntityId(postId)) return notFound('帖子')
		return this.database.transaction(async (tx) => {
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
			return Result.ok()
		})
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

	/**
	 * Copies of the DTOs with the data of every registered extension under `ext`. An extension that
	 * fails or is too slow is logged and left out; the core's own data is never held back by it.
	 */
	private async extended<T extends Readonly<{ id: string }>>(
		entity: ExtendableEntity,
		principal: Principal,
		items: readonly T[],
	): Promise<T[]> {
		const data = await this.entityExtensions.load(
			entity,
			items.map((item) => item.id),
			principal,
			(error, extensionId) =>
				this.ctx.logger.error('entity extension failed; serving the page without it', {
					error,
					extensionId,
					entity,
				}),
		)
		return items.map((item) => ({ ...item, ext: data.get(item.id) ?? {} }))
	}

	/** The DTO a write returned, with extension data attached. */
	private async extendedResult<T extends Readonly<{ id: string }>>(
		entity: ExtendableEntity,
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
			author: { id: by.id, displayName: by.displayName },
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
	private async findThread(db: Db, threadId: string) {
		const [row] = await db
			.select({ thread: threads, author, category: categories })
			.from(threads)
			.innerJoin(users, eq(users.id, threads.authorId))
			.innerJoin(categories, eq(categories.id, threads.categoryId))
			.where(and(eq(threads.id, threadId), isNull(threads.deletedAt)))
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
