import {
	failure as keyed,
	GUEST,
	isBrandAssetKind,
	LIMITS,
	type ApiError,
	type ForumError,
	type ForumErrorCode,
	type MetaDto,
	type PageRequest,
	type Principal,
} from '@pluxum/domain'
import { ForumAuth, type AuthFailure, type Logout } from '@pluxum/auth'
import { ForumCorePlugin, type ForumResult } from '@pluxum/core'
import { BasePlugin, Plugin } from '@pluxel/core'
import { ElysiaApp } from '@pluxel/services/elysia'
import type { Elysia } from 'elysia'
import type { TSchema } from 'typebox'
import { Value } from 'typebox/value'
import {
	ExtActionRegistry,
	ExtFileRegistry,
	type ExtActionContribution,
	type ExtActionMethod,
	type ExtFileContribution,
} from './ext'
import * as schema from './schemas'

export type {
	ExtActionContribution,
	ExtActionMethod,
	ExtFileContribution,
	ExtFileObject,
} from './ext'

/** Public prefix for every forum HTTP route; the frontend proxies this path on its own origin. */
export const FORUM_API_PREFIX = '/api/forum'

const STATUS: Readonly<Record<ForumErrorCode, number>> = {
	invalid: 422,
	unauthenticated: 401,
	forbidden: 403,
	not_found: 404,
	conflict: 409,
	unavailable: 503,
	rate_limited: 429,
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
		...(failure.key === undefined ? {} : { key: failure.key }),
		...(failure.params === undefined ? {} : { params: failure.params }),
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

/** `{ name, admin? }` of a test login request. */
function testLoginInputOf(body: unknown): { name: string; admin: boolean } | null {
	if (typeof body !== 'object' || body === null || !('name' in body)) return null
	if (typeof body.name !== 'string') return null
	return { name: body.name, admin: 'admin' in body && body.admin === true }
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
 * never mount routes: they contribute handlers to `registerExtAction`, served under `/ext`.
 */
const SAFE_INLINE_IMAGES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

function contentDisposition(inline: boolean, filename?: string): string {
	const kind = inline ? 'inline' : 'attachment'
	const clean = filename?.replaceAll(/[\r\n\0/\\]/g, '').trim()
	if (!clean) return kind
	const ascii = clean.replaceAll(/[^\x20-\x7e]|["\\;]/g, '_')
	return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`
}

@Plugin({ displayName: 'Forum API' })
export class ForumApiPlugin extends BasePlugin {
	private readonly extActions = new ExtActionRegistry()
	private readonly extFiles = new ExtFileRegistry()

	constructor(
		private readonly core: ForumCorePlugin,
		private readonly auth: ForumAuth,
	) {
		super()
	}

	/**
	 * Serves an extension's action at `GET|POST /api/forum/ext/:extId/:action`. The ingress resolves
	 * the caller, refuses cross-site writes and guests where login is required, and checks input
	 * and output against the contributed schemas. The returned disposer must be handed to the
	 * contributor's `ctx.effects`; once it ran, the path answers 404. Throws on an invalid name or
	 * when the path is already taken.
	 */
	registerExtAction<Input extends TSchema, Output extends TSchema>(
		contribution: ExtActionContribution<Input, Output>,
	): () => void {
		return this.extActions.register(contribution)
	}

	/** The registered ext actions as `extId/action`. */
	extActionKeys(): string[] {
		return this.extActions.keys()
	}

	/**
	 * Serves an extension's binary files at `GET /api/forum/ext/:extId/files/:fileId` with strict
	 * `nosniff`, CSP and `Content-Disposition` headers. The returned disposer must be handed to the
	 * contributor's `ctx.effects`.
	 */
	registerExtFile(contribution: ExtFileContribution): () => void {
		return this.extFiles.register(contribution)
	}

	/** The registered ext file contributor IDs. */
	extFileIds(): string[] {
		return this.extFiles.ids()
	}

	protected override init(): void {
		this.ctx
			.require(ElysiaApp)
			.onError(({ error }) => {
				if (error instanceof ApiFailure) return errorResponse(error.status, error.failure)
				const { code, status } = elysiaErrorFacts(error)
				// A response that fails its own schema is a server fault (500), not bad input.
				if (code === 'validation' && status === 422) {
					return errorResponse(422, keyed('invalid', 'request.invalid'))
				}
				if (code === 'parse') {
					return errorResponse(400, keyed('invalid', 'request.unparsable'))
				}
				if (code === 'not-found') {
					return errorResponse(404, keyed('not_found', 'route.not_found'))
				}
				this.ctx.logger.error('forum api request failed', { error })
				return errorResponse(500, keyed('internal', 'server.internal'))
			})
			.group(FORUM_API_PREFIX, (app) =>
				app
					.get('/ping', { response: schema.ping }, () => ({
						status: 'ok' as const,
						service: 'forum-api' as const,
						time: new Date().toISOString(),
					}))
					.get('/meta', { response: schema.meta }, ({ request }) => this.meta(request))
					.get('/brand/:kind', ({ request, params }) => this.serveBrandAsset(request, params.kind))
					.get('/palette', { response: schema.paletteCommands }, async ({ request }) =>
						this.core.paletteCommandsFor(await this.viewer(request)),
					)
					.get(
						'/community',
						{ response: schema.community },
						async ({ request }) => await this.core.communityPulse(await this.viewer(request)),
					)
					.get(
						'/search',
						{ query: schema.searchQuery, response: schema.searchPage },
						async ({ request, query }) =>
							valueOf(
								await this.core.search(await this.viewer(request), {
									query: query.q ?? '',
									categoryId: query.categoryId,
									authorId: query.authorId,
									threadsOnly: query.threadsOnly === 'true' || query.threadsOnly === '1',
									...pageOf(query),
								}),
							),
					)
					.use(this.authRoutes())
					.use(this.userRoutes())
					.use(this.categoryRoutes())
					.use(this.threadRoutes())
					.use(this.postRoutes())
					.use(this.extRoutes()),
			)
	}

	// The fixed routes behind which every extension action and file lives.
	private extRoutes() {
		return (app: Elysia) =>
			app
				.get('/ext/:extId/files/:fileId', ({ request, params }) =>
					this.serveExtFile(request, params),
				)
				.get('/ext/:extId/:action', ({ request, params, query }) =>
					this.runExtAction('GET', request, params, query),
				)
				.post('/ext/:extId/:action', ({ request, params, body }) =>
					this.runExtAction('POST', request, params, body),
				)
	}

	private async serveExtFile(
		request: Request,
		params: { extId: string; fileId: string },
	): Promise<Response> {
		const found = this.extFiles.find(params.extId)
		if (!found) throw new ApiFailure(404, keyed('not_found', 'route.not_found'))
		const principal = await this.viewer(request)
		const result = await found.read({
			principal,
			fileId: params.fileId,
			ifNoneMatch: request.headers.get('if-none-match'),
		})
		if (!this.extFiles.holds(found)) {
			throw new ApiFailure(404, keyed('not_found', 'route.not_found'))
		}
		const payload = valueOf(result)
		if (payload === 'not_modified') {
			return new Response(null, { status: 304 })
		}
		const inline = SAFE_INLINE_IMAGES.has(payload.contentType)
		const headers = new Headers({
			'content-type': payload.contentType,
			'content-disposition': contentDisposition(inline, payload.filename),
			'x-content-type-options': 'nosniff',
			'content-security-policy':
				"default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
			'cache-control': payload.immutable
				? 'public, max-age=31536000, immutable'
				: 'private, max-age=0, must-revalidate',
		})
		if (payload.etag) headers.set('etag', payload.etag)
		if (payload.size !== undefined) headers.set('content-length', String(payload.size))
		return new Response(payload.body, { status: 200, headers })
	}

	/**
	 * A brand image uploaded in Workbench (see Forum Core). URLs carry `?v=<content version>`,
	 * so a versioned request is cached for good; SVG runs under a sandboxing CSP like ext files.
	 */
	private async serveBrandAsset(request: Request, kind: string): Promise<Response> {
		if (!isBrandAssetKind(kind)) throw new ApiFailure(404, keyed('not_found', 'route.not_found'))
		const asset = await this.core.brandAsset(kind)
		if (!asset) throw new ApiFailure(404, keyed('not_found', 'route.not_found'))
		const etag = `"${asset.version}"`
		const versioned = new URL(request.url).searchParams.get('v') === asset.version
		const headers = new Headers({
			etag,
			'x-content-type-options': 'nosniff',
			'content-security-policy':
				"default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
			'cache-control': versioned
				? 'public, max-age=31536000, immutable'
				: 'public, max-age=300, must-revalidate',
		})
		if (request.headers.get('if-none-match') === etag)
			return new Response(null, { status: 304, headers })
		headers.set('content-type', asset.type)
		headers.set('content-length', String(asset.bytes.byteLength))
		return new Response(asset.bytes, { status: 200, headers })
	}

	private async runExtAction(
		method: ExtActionMethod,
		request: Request,
		params: { extId: string; action: string },
		raw: unknown,
	): Promise<Response> {
		const found = this.extActions.find(params.extId, params.action)
		if (!found) throw new ApiFailure(404, keyed('not_found', 'route.not_found'))
		if (found.method !== method) {
			throw new ApiFailure(405, keyed('invalid', 'request.method'))
		}
		const principal = await (method === 'POST' ? this.actor(request) : this.viewer(request))
		if (found.login && principal.userId === null) {
			throw new ApiFailure(401, keyed('unauthenticated', 'auth.required'))
		}
		const input = Value.Clean(found.input, raw ?? {})
		if (!Value.Check(found.input, input)) {
			throw new ApiFailure(422, keyed('invalid', 'request.invalid'))
		}
		const result = await found.handle({ principal, input })
		// Stopped or replaced while it ran: its answer is no longer this endpoint's.
		if (!this.extActions.holds(found)) {
			throw new ApiFailure(404, keyed('not_found', 'route.not_found'))
		}
		const output = Value.Clean(found.output, structuredClone(valueOf(result)))
		if (!Value.Check(found.output, output)) {
			throw new Error(`Ext action "${params.extId}/${params.action}" broke its output schema`)
		}
		return Response.json(output, { headers: { 'cache-control': 'no-store' } })
	}

	private userRoutes() {
		return (app: Elysia) =>
			app
				.get(
					'/users/:id',
					{ query: schema.profileQuery, response: schema.userProfile },
					async ({ request, params, query }) =>
						valueOf(
							await this.core.getUserProfile(await this.viewer(request), params.id, {
								...pageOf(query),
								kind: query.kind,
							}),
						),
				)
				.patch(
					'/users/:id',
					{ body: schema.updateUserBody, response: schema.user },
					async ({ request, params, body }) =>
						valueOf(await this.core.updateProfile(await this.actor(request), params.id, body)),
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
				.get(
					'/threads',
					{ query: schema.recentThreadsQuery, response: schema.recentThreads },
					async ({ request, query }) =>
						await this.core.listRecentThreads(await this.viewer(request), pageOf(query), {
							sort: query.sort,
							scope: query.scope,
						}),
				)
				.post(
					'/threads',
					{ body: schema.createThreadBody, response: { 201: schema.thread } },
					async ({ request, body, status }) =>
						status(201, valueOf(await this.core.createThread(await this.actor(request), body))),
				)
				.get(
					'/threads/:id',
					{ query: schema.threadQuery, response: schema.threadDetail },
					async ({ request, params, query }) =>
						valueOf(
							await this.core.getThread(await this.viewer(request), params.id, {
								...pageOf(query),
								expandFloor: queryInt(query.expand),
							}),
						),
				)
				// Which page shows a floor (and which floor it replies inside), for `/t/<ref>/<floor>`.
				.get(
					'/threads/:id/floors/:floor',
					{ query: schema.paging, response: schema.floorLocation },
					async ({ request, params, query }) =>
						valueOf(
							await this.core.locateFloor(
								await this.viewer(request),
								params.id,
								queryInt(params.floor) ?? 0,
								pageOf(query),
							),
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
					{ body: schema.createPostBody, response: { 201: schema.post } },
					async ({ request, params, body, status }) =>
						status(
							201,
							valueOf(
								await this.core.createPost(await this.actor(request), {
									threadId: params.id,
									body: body.body,
									parentId: body.parentId,
								}),
							),
						),
				)
	}

	private postRoutes() {
		return (app: Elysia) =>
			app
				// Resolves a post id to its floor, for links that only know the id.
				.get(
					'/posts/:id/location',
					{ response: schema.postLocation },
					async ({ request, params }) => {
						const located = valueOf(
							await this.core.locatePost(await this.viewer(request), params.id),
						)
						return { threadRef: located.threadRef, postNumber: located.postNumber }
					},
				)
				// The replies inside a top-level post ("楼中楼"), page by page.
				.get(
					'/posts/:id/replies',
					{ query: schema.paging, response: schema.replyPage },
					async ({ request, params, query }) =>
						valueOf(
							await this.core.listReplies(await this.viewer(request), params.id, pageOf(query)),
						),
				)
				.patch(
					'/posts/:id',
					{ body: schema.postBody, response: schema.post },
					async ({ request, params, body }) =>
						valueOf(await this.core.updatePost(await this.actor(request), params.id, body)),
				)
				.delete('/posts/:id', async ({ request, params }) =>
					noContent(await this.core.deletePost(await this.actor(request), params.id)),
				)
				// Renders a body as a saved post would look. Members only: it runs the renderer.
				.post(
					'/preview',
					{ body: schema.postBody, response: schema.preview },
					async ({ request, body }) => {
						const principal = await this.actor(request)
						if (principal.userId === null) {
							throw new ApiFailure(401, keyed('unauthenticated', 'auth.required'))
						}
						return valueOf(this.core.previewBody(body.body))
					},
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
				// Throwaway test accounts for checking signed-in UI; off unless a token hash is configured.
				// Off reads as 404 so the route does not advertise itself.
				.post('/auth/test-login', async ({ request, body }) => {
					if (!this.auth.testLoginAvailable()) {
						throw new ApiFailure(404, keyed('not_found', 'route.not_found'))
					}
					const input = testLoginInputOf(body)
					if (input === null) {
						throw new ApiFailure(400, { code: 'invalid', message: 'name is required' })
					}
					const login = await this.auth.testLogin(
						request.headers.get('x-test-login-token'),
						input,
						request.headers.get('user-agent'),
					)
					if (login.isErr()) throw authFailure(login.error)
					return Response.json(
						{ userId: login.value.userId },
						{ headers: { 'cache-control': 'no-store', 'set-cookie': login.value.setCookie } },
					)
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
		const [user, stream, following] = await Promise.all([
			principal.userId === null
				? null
				: this.core.getUser(principal.userId, principal).then((found) => found.unwrapOr(null)),
			this.core.streamFor(principal),
			this.core.followingOf(principal),
		])
		return {
			viewer: {
				user,
				roles: [...principal.roles],
				can: {
					manageCategories: this.core.can(principal, 'category.manage'),
					postNote: stream?.canPost ?? false,
				},
				following,
			},
			auth: { loginAvailable: this.auth.loginAvailable() },
			search: { available: this.core.searchAvailable() },
			limits: {
				categoryNameMax: LIMITS.categoryNameMax,
				threadTitleMax: LIMITS.threadTitleMax,
				postBodyMax: LIMITS.postBodyMax,
				noteBodyMax: this.core.noteBodyMax(),
				displayNameMax: LIMITS.displayNameMax,
				handleMax: LIMITS.handleMax,
			},
			content: { format: this.core.contentFormat() },
			stream: stream?.category ?? null,
			uiSlots: this.core.uiSlots(),
			site: this.core.site(),
			footer: this.core.footer(),
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
			throw new ApiFailure(503, keyed('unavailable', 'login.unavailable'))
		}
		return authentication.status === 'authenticated'
			? this.core.principalOf(authentication.userId)
			: GUEST
	}

	private requireSameOrigin(request: Request): void {
		if (!this.auth.allowsOrigin(request)) {
			throw new ApiFailure(403, keyed('forbidden', 'request.cross_site'))
		}
	}
}
