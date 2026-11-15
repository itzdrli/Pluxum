import {
	GUEST,
	LIMITS,
	type ApiError,
	type ForumError,
	type ForumErrorCode,
	type MetaDto,
	type PageRequest,
	type Principal,
} from '@forum/domain'
import { ForumAuth, type AuthFailure, type Logout } from '@forum/forum-auth'
import { ForumCorePlugin, type ForumResult } from '@forum/forum-core'
import { BasePlugin, Plugin } from '@pluxel/core'
import { ElysiaApp } from '@pluxel/services/elysia'
import type { Elysia } from 'elysia'
import * as schema from './schemas'

/** Public prefix for every forum HTTP route; the frontend proxies this path on its own origin. */
export const FORUM_API_PREFIX = '/api/forum'

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

const AUTH_STATUS: Readonly<Record<AuthFailure['code'], number>> = {
	unavailable: 503,
	rejected: 400,
	unauthenticated: 401,
}

/** Carries an expected failure from a handler to the shared error response. */
class ApiFailure extends Error {
	constructor(
		readonly status: number,
		readonly failure: ApiError,
	) {
		super(failure.message)
	}
}

const forumFailure = (failure: ForumError) => new ApiFailure(STATUS[failure.code], failure)
const authFailure = (failure: AuthFailure) =>
	new ApiFailure(AUTH_STATUS[failure.code], {
		code: failure.code === 'rejected' ? 'invalid' : failure.code,
		message: failure.message,
	})

function redirect(location: string, setCookie?: string): Response {
	const headers = new Headers({ location, 'cache-control': 'no-store' })
	if (setCookie !== undefined) headers.set('set-cookie', setCookie)
	// 303: the browser follows with GET, also after the logout form's POST.
	return new Response(null, { status: 303, headers })
}

/** After a logout the browser goes to the provider's logout page when there is one, else home. */
const loggedOut = (logout: Logout) => redirect(logout.providerUrl ?? '/', logout.setCookie)

/** The `logout_token` form field of an OIDC back-channel logout request. */
function logoutTokenOf(body: unknown): string | null {
	if (typeof body !== 'object' || body === null || !('logout_token' in body)) return null
	return typeof body.logout_token === 'string' ? body.logout_token : null
}

/** The value of a core result; a failure becomes the error response every forum route shares. */
function valueOf<T>(result: ForumResult<T>): T {
	if (result.isErr()) throw forumFailure(result.error)
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
	constructor(
		private readonly core: ForumCorePlugin,
		private readonly auth: ForumAuth,
	) {
		super()
	}

	protected override init(): void {
		this.ctx
			.require(ElysiaApp)
			.onError(({ error }) => {
				if (error instanceof ApiFailure) return errorResponse(error.status, error.failure)
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
					.get('/meta', { response: schema.meta }, ({ request }) => this.meta(request))
					.use(this.authRoutes())
					.use(this.categoryRoutes())
					.use(this.threadRoutes())
					.use(this.postRoutes()),
			)
	}

	private categoryRoutes() {
		return (app: Elysia) =>
			app
				.get('/categories', { response: schema.categoryList }, async ({ request }) => ({
					items: await this.core.listCategories(await this.viewer(request)),
				}))
				.post(
					'/categories',
					{ body: schema.createCategoryBody, response: { 201: schema.category } },
					async ({ request, body, status }) =>
						status(201, valueOf(await this.core.createCategory(await this.actor(request), body))),
				)
				// `:category` is the slug when reading threads and the ID when managing the category.
				.get(
					'/categories/:category/threads',
					{ query: schema.paging, response: schema.categoryThreads },
					async ({ request, params, query }) =>
						valueOf(
							await this.core.listThreads(
								await this.viewer(request),
								params.category,
								pageOf(query),
							),
						),
				)
				.patch(
					'/categories/:category',
					{ body: schema.updateCategoryBody, response: schema.category },
					async ({ request, params, body }) =>
						valueOf(
							await this.core.updateCategory(await this.actor(request), params.category, body),
						),
				)
				.delete('/categories/:category', async ({ request, params }) =>
					noContent(await this.core.deleteCategory(await this.actor(request), params.category)),
				)
	}

	private threadRoutes() {
		return (app: Elysia) =>
			app
				.post(
					'/threads',
					{ body: schema.createThreadBody, response: { 201: schema.thread } },
					async ({ request, body, status }) =>
						status(201, valueOf(await this.core.createThread(await this.actor(request), body))),
				)
				.get(
					'/threads/:id',
					{ query: schema.paging, response: schema.threadDetail },
					async ({ request, params, query }) =>
						valueOf(
							await this.core.getThread(await this.viewer(request), params.id, pageOf(query)),
						),
				)
				.patch(
					'/threads/:id',
					{ body: schema.updateThreadBody, response: schema.thread },
					async ({ request, params, body }) =>
						valueOf(await this.core.updateThread(await this.actor(request), params.id, body)),
				)
				.delete('/threads/:id', async ({ request, params }) =>
					noContent(await this.core.deleteThread(await this.actor(request), params.id)),
				)
				.post(
					'/threads/:id/posts',
					{ body: schema.postBody, response: { 201: schema.post } },
					async ({ request, params, body, status }) =>
						status(
							201,
							valueOf(
								await this.core.createPost(await this.actor(request), {
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
					async ({ request, params, body }) =>
						valueOf(await this.core.updatePost(await this.actor(request), params.id, body)),
				)
				.delete('/posts/:id', async ({ request, params }) =>
					noContent(await this.core.deletePost(await this.actor(request), params.id)),
				)
	}

	private authRoutes() {
		return (app: Elysia) =>
			app
				.get('/auth/login', async ({ request }) => {
					const returnTo = new URL(request.url).searchParams.get('returnTo')
					const started = await this.auth.beginLogin(returnTo)
					if (started.isErr()) throw authFailure(started.error)
					return redirect(started.value)
				})
				.get('/auth/callback', async ({ request }) => {
					const login = await this.auth.completeLogin(request)
					// The browser arrives here by redirect, so a failure goes back to a page, not JSON.
					if (login.isErr()) return redirect(`/?login=${login.error.code}`)
					return redirect(login.value.returnTo, login.value.setCookie)
				})
				.post('/auth/logout', async ({ request }) => {
					this.requireSameOrigin(request)
					return loggedOut(await this.auth.logout(request))
				})
				.post('/auth/logout-all', async ({ request }) => {
					this.requireSameOrigin(request)
					const logout = await this.auth.logoutEverywhere(request)
					if (logout.isErr()) throw authFailure(logout.error)
					return loggedOut(logout.value)
				})
				// Called by the identity provider, not by a browser: the signed token is the credential.
				.post('/auth/backchannel-logout', async ({ body }) => {
					const token = logoutTokenOf(body)
					if (token === null) {
						throw new ApiFailure(400, { code: 'invalid', message: 'logout_token is required' })
					}
					const result = await this.auth.backchannelLogout(token)
					if (result.isErr()) throw authFailure(result.error)
					return new Response(null, { status: 200, headers: { 'cache-control': 'no-store' } })
				})
	}

	private async meta(request: Request): Promise<MetaDto> {
		const principal = await this.viewer(request)
		const user =
			principal.userId === null ? null : (await this.core.getUser(principal.userId)).unwrapOr(null)
		return {
			viewer: {
				user,
				roles: [...principal.roles],
				can: { manageCategories: this.core.can(principal, 'category.manage') },
			},
			auth: { loginAvailable: this.auth.loginAvailable() },
			limits: {
				categoryNameMax: LIMITS.categoryNameMax,
				threadTitleMax: LIMITS.threadTitleMax,
				postBodyMax: LIMITS.postBodyMax,
			},
		}
	}

	/**
	 * Who a read acts as. A session that cannot be checked right now reads as a guest, so public
	 * pages stay up while the session store is down.
	 */
	private async viewer(request: Request): Promise<Principal> {
		const authentication = await this.auth.authenticate(request)
		return authentication.status === 'authenticated'
			? this.core.principalOf(authentication.userId)
			: GUEST
	}

	/**
	 * Who a write acts as. Refuses cross-site browser requests, and answers 503 rather than
	 * "not logged in" when the request has a session that cannot be checked.
	 */
	private async actor(request: Request): Promise<Principal> {
		this.requireSameOrigin(request)
		const authentication = await this.auth.authenticate(request)
		if (authentication.status === 'unavailable') {
			throw new ApiFailure(503, { code: 'unavailable', message: '登录服务暂时不可用，请稍后再试' })
		}
		return authentication.status === 'authenticated'
			? this.core.principalOf(authentication.userId)
			: GUEST
	}

	private requireSameOrigin(request: Request): void {
		if (!this.auth.allowsOrigin(request)) {
			throw new ApiFailure(403, { code: 'forbidden', message: '不允许跨站请求' })
		}
	}
}
