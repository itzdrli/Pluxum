import {
	ASSIGNABLE_ROLES,
	GUEST,
	LIMITS,
	type ApiError,
	type ForumError,
	type ForumErrorCode,
	type MetaDto,
	type PageRequest,
	type Principal,
} from '@forum/domain'
import { ForumCorePlugin, type ForumResult } from '@forum/forum-core'
import { BasePlugin, Plugin } from '@pluxel/core'
import { ElysiaApp } from '@pluxel/services/elysia'
import type { Elysia } from 'elysia'
import * as v from 'valibot'
import * as schema from './schemas'

/** Public prefix for every forum HTTP route; the frontend proxies this path on its own origin. */
export const FORUM_API_PREFIX = '/api/forum'

export const ForumApiConfig = v.object({
	/**
	 * Development stand-in for login until forum-auth exists (M2): when enabled, every request acts
	 * as this one account. Refused when NODE_ENV is "production".
	 */
	devIdentity: v.optional(
		v.object({
			enabled: v.optional(v.boolean(), false),
			subject: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(255)), 'dev:local'),
			displayName: v.optional(
				v.pipe(v.string(), v.minLength(1), v.maxLength(LIMITS.displayNameMax)),
				'开发者',
			),
			roles: v.optional(v.array(v.picklist(ASSIGNABLE_ROLES)), []),
		}),
		{},
	),
})

const STATUS: Readonly<Record<ForumErrorCode, number>> = {
	invalid: 422,
	unauthenticated: 401,
	forbidden: 403,
	not_found: 404,
	conflict: 409,
}

function errorResponse(status: number, error: ApiError): Response {
	return Response.json({ error }, { status })
}

/** Carries an expected forum failure from a handler to the shared error response. */
class ForumFailure extends Error {
	constructor(readonly failure: ForumError) {
		super(failure.message)
	}
}

/** The value of a core result; a failure becomes the error response every forum route shares. */
function valueOf<T>(result: ForumResult<T>): T {
	if (result.isErr()) throw new ForumFailure(result.error)
	return result.value
}

function noContent(result: ForumResult<void>): Response {
	valueOf(result)
	return new Response(null, { status: 204 })
}

/**
 * Elysia tags its own errors with a stable `code` and HTTP `status`. Reading those fields, rather
 * than testing `instanceof`, keeps working when a source-linked host loads a second Elysia copy.
 */
function elysiaErrorFacts(error: unknown): { code?: unknown; status?: unknown } {
	if (typeof error !== 'object' || error === null) return {}
	return {
		code: 'code' in error ? error.code : undefined,
		status: 'status' in error ? error.status : undefined,
	}
}

/** A non-negative integer from a query string, or undefined for anything else. */
function queryInt(value: string | undefined): number | undefined {
	return value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined
}

function pageOf(query: { page?: string; pageSize?: string }): PageRequest {
	return { page: queryInt(query.page), pageSize: queryInt(query.pageSize) }
}

/**
 * Fixed HTTP ingress for the forum. The core owns the domain and its rules; this plugin owns the
 * URLs, resolves who is calling and projects results onto the wire contract. Dynamic extensions
 * never mount routes: they will contribute handlers through a registry owned here (M3).
 */
@Plugin({ displayName: 'Forum API' })
export class ForumApiPlugin extends BasePlugin {
	private readonly config = this.configs.use(ForumApiConfig)
	private devUserId: string | null = null

	constructor(private readonly core: ForumCorePlugin) {
		super()
	}

	protected override async init(): Promise<void> {
		await this.setUpDevIdentity()
		this.ctx
			.require(ElysiaApp)
			.onError(({ error }) => {
				if (error instanceof ForumFailure) {
					return errorResponse(STATUS[error.failure.code], error.failure)
				}
				const { code, status } = elysiaErrorFacts(error)
				// A response that fails its own schema is a server fault (500), not bad input.
				if (code === 'validation' && status === 422) {
					return errorResponse(422, { code: 'invalid', message: '请求参数无效' })
				}
				if (code === 'parse') {
					return errorResponse(400, { code: 'invalid', message: '请求内容无法解析' })
				}
				if (code === 'not-found') {
					return errorResponse(404, { code: 'not_found', message: '接口不存在' })
				}
				this.ctx.logger.error('forum api request failed', { error })
				return errorResponse(500, { code: 'internal', message: '服务器内部错误' })
			})
			.group(FORUM_API_PREFIX, (app) =>
				app
					.get('/ping', { response: schema.ping }, () => ({
						status: 'ok' as const,
						service: 'forum-api' as const,
						time: new Date().toISOString(),
					}))
					.get('/meta', { response: schema.meta }, () => this.meta())
					.use(this.categoryRoutes())
					.use(this.threadRoutes())
					.use(this.postRoutes()),
			)
	}

	private categoryRoutes() {
		return (app: Elysia) =>
			app
				.get('/categories', { response: schema.categoryList }, async () => ({
					items: await this.core.listCategories(await this.principal()),
				}))
				.post(
					'/categories',
					{ body: schema.createCategoryBody, response: { 201: schema.category } },
					async ({ body, status }) =>
						status(201, valueOf(await this.core.createCategory(await this.principal(), body))),
				)
				// `:category` is the slug when reading threads and the ID when managing the category.
				.get(
					'/categories/:category/threads',
					{ query: schema.paging, response: schema.categoryThreads },
					async ({ params, query }) =>
						valueOf(
							await this.core.listThreads(await this.principal(), params.category, pageOf(query)),
						),
				)
				.patch(
					'/categories/:category',
					{ body: schema.updateCategoryBody, response: schema.category },
					async ({ params, body }) =>
						valueOf(await this.core.updateCategory(await this.principal(), params.category, body)),
				)
				.delete('/categories/:category', async ({ params }) =>
					noContent(await this.core.deleteCategory(await this.principal(), params.category)),
				)
	}

	private threadRoutes() {
		return (app: Elysia) =>
			app
				.post(
					'/threads',
					{ body: schema.createThreadBody, response: { 201: schema.thread } },
					async ({ body, status }) =>
						status(201, valueOf(await this.core.createThread(await this.principal(), body))),
				)
				.get(
					'/threads/:id',
					{ query: schema.paging, response: schema.threadDetail },
					async ({ params, query }) =>
						valueOf(await this.core.getThread(await this.principal(), params.id, pageOf(query))),
				)
				.patch(
					'/threads/:id',
					{ body: schema.updateThreadBody, response: schema.thread },
					async ({ params, body }) =>
						valueOf(await this.core.updateThread(await this.principal(), params.id, body)),
				)
				.delete('/threads/:id', async ({ params }) =>
					noContent(await this.core.deleteThread(await this.principal(), params.id)),
				)
				.post(
					'/threads/:id/posts',
					{ body: schema.postBody, response: { 201: schema.post } },
					async ({ params, body, status }) =>
						status(
							201,
							valueOf(
								await this.core.createPost(await this.principal(), {
									threadId: params.id,
									body: body.body,
								}),
							),
						),
				)
	}

	private postRoutes() {
		return (app: Elysia) =>
			app
				.patch(
					'/posts/:id',
					{ body: schema.postBody, response: schema.post },
					async ({ params, body }) =>
						valueOf(await this.core.updatePost(await this.principal(), params.id, body)),
				)
				.delete('/posts/:id', async ({ params }) =>
					noContent(await this.core.deletePost(await this.principal(), params.id)),
				)
	}

	private async meta(): Promise<MetaDto> {
		const principal = await this.principal()
		const user =
			principal.userId === null ? null : (await this.core.getUser(principal.userId)).unwrapOr(null)
		return {
			viewer: {
				user,
				roles: [...principal.roles],
				can: { manageCategories: this.core.can(principal, 'category.manage') },
			},
			limits: {
				categoryNameMax: LIMITS.categoryNameMax,
				threadTitleMax: LIMITS.threadTitleMax,
				postBodyMax: LIMITS.postBodyMax,
			},
		}
	}

	/** Who the current request acts as. Sessions replace the development identity in M2. */
	private principal(): Promise<Principal> {
		return this.devUserId === null ? Promise.resolve(GUEST) : this.core.principalOf(this.devUserId)
	}

	private async setUpDevIdentity(): Promise<void> {
		const identity = this.config.devIdentity
		if (!identity.enabled) return
		if (process.env.NODE_ENV === 'production') {
			throw new Error('Forum API devIdentity must not be enabled when NODE_ENV is "production"')
		}
		const user = await this.core.ensureUser({
			subject: identity.subject,
			displayName: identity.displayName,
		})
		if (user.isErr()) throw new Error(`Invalid Forum API devIdentity: ${user.error.message}`)
		// Stored roles follow the configured ones in both directions.
		const changes = await Promise.all(
			ASSIGNABLE_ROLES.map((role) =>
				identity.roles.includes(role)
					? this.core.grantRole(user.value.id, role)
					: this.core.revokeRole(user.value.id, role),
			),
		)
		if (changes.some((change) => change.isErr())) {
			throw new Error('Cannot apply the Forum API devIdentity roles')
		}
		this.devUserId = user.value.id
		this.ctx.logger.warn('forum api runs with a development identity; every request is this user', {
			subject: identity.subject,
			roles: identity.roles,
		})
	}
}
