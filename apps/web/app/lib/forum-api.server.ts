// Server-only client for the forum API on the Pluxel host. Loaders and actions call it directly on
// the internal address; the browser never sees that address.
import type {
	ApiError,
	CategoryDto,
	CategoryThreadsDto,
	CommunityDto,
	FloorLocationDto,
	MetaDto,
	ModerationLogPageDto,
	ModerationQueuePageDto,
	ModerationQueueStatus,
	ModerationReportDto,
	NotificationPageDto,
	PageDto,
	PostDto,
	RecentThreadsDto,
	SearchPageDto,
	SearchRequest,
	ThreadDetailDto,
	ThreadDto,
	ThreadKind,
	UserDto,
	UserProfileDto,
} from '@pluxum/domain'
import { t } from '@lingui/core/macro'
import { data } from 'react-router'

import type { feedQuery } from './home'
import { apiErrorText } from './api-errors'
import { i18nFromRequest } from './i18n.server'

const DEFAULT_API_INTERNAL = 'http://127.0.0.1:5173'

export function forumApiUrl(path: string): URL {
	return new URL(path, process.env.FORUM_API_INTERNAL ?? DEFAULT_API_INTERNAL)
}

export type ApiResult<T> =
	| Readonly<{ ok: true; value: T }>
	| Readonly<{ ok: false; status: number; error: ApiError }>

/** The failure when the API cannot be reached or answers nonsense, worded in the visitor's language. */
async function unavailableOf(request: Request): Promise<ApiError> {
	return { code: 'internal', message: t(await i18nFromRequest(request))`论坛服务暂时不可用` }
}

const ERROR_CODES = [
	'invalid',
	'unauthenticated',
	'forbidden',
	'not_found',
	'conflict',
	'unavailable',
	'rate_limited',
	'internal',
] as const satisfies ReadonlyArray<ApiError['code']>

/** The error's parameters when it sent any: only strings and numbers are kept. */
function paramsOf(value: unknown): Record<string, string | number> | undefined {
	if (typeof value !== 'object' || value === null) return undefined
	const out: Record<string, string | number> = {}
	for (const [name, entry] of Object.entries(value)) {
		if (typeof entry === 'string' || typeof entry === 'number') out[name] = entry
	}
	return out
}

/** The API's own error, or null when the body is not one. Its text is already in the visitor's language. */
async function apiErrorOf(request: Request, body: unknown): Promise<ApiError | null> {
	if (typeof body !== 'object' || body === null || !('error' in body)) return null
	const error: unknown = body.error
	if (typeof error !== 'object' || error === null) return null
	if (!('message' in error) || typeof error.message !== 'string') return null
	const reported: unknown = 'code' in error ? error.code : undefined
	// An unknown code only loses its specific handling; the message is still the API's own.
	const code = ERROR_CODES.find((known) => known === reported) ?? 'internal'
	const key: unknown = 'key' in error ? error.key : undefined
	const params = paramsOf('params' in error ? error.params : undefined)
	const message = apiErrorText(await i18nFromRequest(request), {
		key: typeof key === 'string' ? key : undefined,
		params,
		message: error.message,
	})
	return { code, message }
}

type CallInit = Readonly<{ method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown }>

/**
 * One API call on behalf of the incoming page request. Expected failures come back as values so
 * that loaders can turn them into a status page and actions into a form message.
 */
async function call<T>(request: Request, path: string, init: CallInit = {}): Promise<ApiResult<T>> {
	const headers = new Headers({ accept: 'application/json' })
	// The visitor's session travels with the call, and so does the browser's Origin: forum-api
	// refuses writes that a page on another site made the browser send.
	for (const name of ['cookie', 'origin']) {
		const value = request.headers.get(name)
		if (value !== null) headers.set(name, value)
	}
	if (init.body !== undefined) headers.set('content-type', 'application/json')
	let response: Response
	try {
		response = await fetch(forumApiUrl(`/api/forum${path}`), {
			method: init.method ?? 'GET',
			headers,
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
			signal: request.signal,
		})
	} catch (error) {
		if (request.signal.aborted) throw error
		return { ok: false, status: 502, error: await unavailableOf(request) }
	}
	// 204 (a delete) has no body; it reads as null.
	const body: unknown = await response.json().catch(() => null)
	if (!response.ok) {
		return {
			ok: false,
			status: response.status,
			error: (await apiErrorOf(request, body)) ?? (await unavailableOf(request)),
		}
	}
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- forum-api validates every success response against the schema these DTO types mirror; this is the one place that trust is stated.
	return { ok: true, value: body as T }
}

/** For loaders: the value, or the API's failure as a route error response with the same status. */
export function orThrow<T>(result: ApiResult<T>): T {
	if (!result.ok) throw data(result.error.message, { status: result.status })
	return result.value
}

/** How long one visitor's `/meta` answer is reused. Plugin and role changes show within this time. */
const META_TTL_MS = 5000
const META_CACHE_MAX = 500

const metaCache = new Map<string, Readonly<{ expires: number; meta: MetaDto }>>()
const metaInFlight = new Map<string, Promise<ApiResult<MetaDto>>>()

/**
 * What `/meta` depends on in a request: the forum session. Guests share one entry, which is what
 * keeps crawlers and anonymous readers from costing an API call per page.
 */
function metaCacheKey(request: Request): string {
	return (request.headers.get('cookie') ?? '')
		.split(';')
		.map((part) => part.trim())
		.filter((part) => /^(?:__Host-)?forum_session=/.test(part))
		.join(';')
}

/** `/meta`, answered from a short-lived per-session cache. Failures are never cached. */
async function cachedMeta(request: Request): Promise<ApiResult<MetaDto>> {
	const key = metaCacheKey(request)
	const now = Date.now()
	const hit = metaCache.get(key)
	if (hit !== undefined && hit.expires > now) return { ok: true, value: hit.meta }
	const existing = metaInFlight.get(key)
	if (existing !== undefined) return existing
	const pending = (async (): Promise<ApiResult<MetaDto>> => {
		try {
			const result = await call<MetaDto>(request, '/meta')
			if (result.ok) {
				// Re-inserting moves the key to the end, so the oldest entry is always first.
				metaCache.delete(key)
				metaCache.set(key, { expires: Date.now() + META_TTL_MS, meta: result.value })
				if (metaCache.size > META_CACHE_MAX) {
					const oldest = metaCache.keys().next()
					if (!oldest.done) metaCache.delete(oldest.value)
				}
			}
			return result
		} finally {
			metaInFlight.delete(key)
		}
	})()
	metaInFlight.set(key, pending)
	return pending
}

const CATEGORIES_TTL_MS = 3000
const CATEGORIES_CACHE_MAX = 500

const categoriesCache = new Map<
	string,
	Readonly<{ expires: number; categories: { items: CategoryDto[] } }>
>()
const categoriesInFlight = new Map<string, Promise<ApiResult<{ items: CategoryDto[] }>>>()

/** `/categories`, answered from a short-lived per-session cache across nested stage loaders. */
async function cachedCategories(request: Request): Promise<ApiResult<{ items: CategoryDto[] }>> {
	const key = metaCacheKey(request)
	const now = Date.now()
	const hit = categoriesCache.get(key)
	if (hit !== undefined && hit.expires > now) return { ok: true, value: hit.categories }
	const existing = categoriesInFlight.get(key)
	if (existing !== undefined) return existing
	const pending = (async (): Promise<ApiResult<{ items: CategoryDto[] }>> => {
		try {
			const fetched = await call<{ items: CategoryDto[] }>(request, '/categories')
			// The stream holds notes and is reached through the home page, not as a category.
			const result: ApiResult<{ items: CategoryDto[] }> = fetched.ok
				? {
						ok: true,
						value: { items: fetched.value.items.filter((item) => item.kind !== 'stream') },
					}
				: fetched
			if (result.ok) {
				categoriesCache.delete(key)
				categoriesCache.set(key, {
					expires: Date.now() + CATEGORIES_TTL_MS,
					categories: result.value,
				})
				if (categoriesCache.size > CATEGORIES_CACHE_MAX) {
					const oldest = categoriesCache.keys().next()
					if (!oldest.done) categoriesCache.delete(oldest.value)
				}
			}
			return result
		} finally {
			categoriesInFlight.delete(key)
		}
	})()
	categoriesInFlight.set(key, pending)
	return pending
}

const UNREAD_TTL_MS = 5000
const UNREAD_CACHE_MAX = 500

const unreadCache = new Map<string, Readonly<{ expires: number; count: number }>>()
const unreadInFlight = new Map<string, Promise<ApiResult<Readonly<{ count: number }>>>>()

async function cachedUnreadNotifications(
	request: Request,
): Promise<ApiResult<Readonly<{ count: number }>>> {
	const key = metaCacheKey(request)
	if (key === '') return { ok: true, value: { count: 0 } }
	const now = Date.now()
	const hit = unreadCache.get(key)
	if (hit !== undefined && hit.expires > now) {
		return { ok: true, value: { count: hit.count } }
	}
	const existing = unreadInFlight.get(key)
	if (existing !== undefined) return existing
	const pending = (async (): Promise<ApiResult<Readonly<{ count: number }>>> => {
		try {
			const result = await call<Readonly<{ count: number }>>(
				request,
				'/ext/forum-notifications/unread-count',
			)
			if (result.ok) {
				unreadCache.delete(key)
				unreadCache.set(key, {
					expires: Date.now() + UNREAD_TTL_MS,
					count: result.value.count,
				})
				if (unreadCache.size > UNREAD_CACHE_MAX) {
					const oldest = unreadCache.keys().next()
					if (!oldest.done) unreadCache.delete(oldest.value)
				}
			}
			return result
		} finally {
			unreadInFlight.delete(key)
		}
	})()
	unreadInFlight.set(key, pending)
	return pending
}

/** Clears short-lived `/meta`, `/categories` and unread notification caches after mutations. */
export function invalidateForumCaches(): void {
	metaCache.clear()
	categoriesCache.clear()
	unreadCache.clear()
}

function pageQuery(page: number): string {
	return page > 1 ? `?page=${page}` : ''
}

/** The 1-based page search parameter of a page URL; anything malformed is page 1. */
export function pageParam(request: Request, param = 'page'): number {
	const raw = new URL(request.url).searchParams.get(param) ?? ''
	return /^[1-9]\d{0,5}$/.test(raw) ? Number(raw) : 1
}

/** Builds the `/search?...` API path from a `SearchRequest`. */
export function buildSearchApiPath(query: SearchRequest): string {
	const params = new URLSearchParams()
	params.set('q', query.query)
	if (query.categoryId !== undefined && query.categoryId !== '') {
		params.set('categoryId', query.categoryId)
	}
	if (query.authorId !== undefined && query.authorId !== '') {
		params.set('authorId', query.authorId)
	}
	if (query.threadsOnly === true) {
		params.set('threadsOnly', 'true')
	}
	if (query.page !== undefined && query.page > 1) {
		params.set('page', String(query.page))
	}
	if (query.pageSize !== undefined) {
		params.set('pageSize', String(query.pageSize))
	}
	return `/search?${params.toString()}`
}

export type NotificationsQuery = Readonly<{
	page?: number
	pageSize?: number
	unreadOnly?: boolean
}>

/** Builds the `/ext/forum-notifications/list?...` API path from a `NotificationsQuery`. */
export function buildNotificationsApiPath(query: NotificationsQuery = {}): string {
	const params = new URLSearchParams()
	if (query.unreadOnly === true) {
		params.set('unreadOnly', 'true')
	}
	if (query.page !== undefined && query.page > 1) {
		params.set('page', String(query.page))
	}
	if (query.pageSize !== undefined) {
		params.set('pageSize', String(query.pageSize))
	}
	const qs = params.toString()
	return qs === '' ? '/ext/forum-notifications/list' : `/ext/forum-notifications/list?${qs}`
}

export type ModerationQueueQuery = Readonly<{
	status?: ModerationQueueStatus
	page?: number
	pageSize?: number
}>

/** Builds the `/ext/forum-moderation/queue?...` API path from a `ModerationQueueQuery`. */
export function buildModerationQueueApiPath(query: ModerationQueueQuery = {}): string {
	const params = new URLSearchParams()
	if (query.status !== undefined && query.status !== 'open') {
		params.set('status', query.status)
	}
	if (query.page !== undefined && query.page > 1) {
		params.set('page', String(query.page))
	}
	if (query.pageSize !== undefined) {
		params.set('pageSize', String(query.pageSize))
	}
	const qs = params.toString()
	return qs === '' ? '/ext/forum-moderation/queue' : `/ext/forum-moderation/queue?${qs}`
}

export type ModerationLogsQuery = Readonly<{
	page?: number
	pageSize?: number
}>

/** Builds the `/ext/forum-moderation/logs?...` API path from a `ModerationLogsQuery`. */
export function buildModerationLogsApiPath(query: ModerationLogsQuery = {}): string {
	const params = new URLSearchParams()
	if (query.page !== undefined && query.page > 1) {
		params.set('page', String(query.page))
	}
	if (query.pageSize !== undefined) {
		params.set('pageSize', String(query.pageSize))
	}
	const qs = params.toString()
	return qs === '' ? '/ext/forum-moderation/logs' : `/ext/forum-moderation/logs?${qs}`
}

export const forumApi = {
	meta: cachedMeta,
	categories: cachedCategories,
	community: (request: Request) => call<CommunityDto>(request, '/community'),
	search: (request: Request, query: SearchRequest) =>
		call<SearchPageDto>(request, buildSearchApiPath(query)),
	notifications: async (request: Request, query: NotificationsQuery = {}) => {
		const result = await call<NotificationPageDto>(request, buildNotificationsApiPath(query))
		if (result.ok) {
			const key = metaCacheKey(request)
			if (key !== '') {
				unreadCache.set(key, {
					expires: Date.now() + UNREAD_TTL_MS,
					count: result.value.unreadCount,
				})
			}
		}
		return result
	},
	unreadNotificationsCount: cachedUnreadNotifications,
	markNotificationRead: async (request: Request, id: string) => {
		const result = await call<
			Readonly<{ id: string; read: true; readAt: string; unreadCount: number }>
		>(request, '/ext/forum-notifications/mark-read', {
			method: 'POST',
			body: { id },
		})
		if (result.ok) unreadCache.clear()
		return result
	},
	markAllNotificationsRead: async (request: Request) => {
		const result = await call<Readonly<{ marked: number; unreadCount: 0 }>>(
			request,
			'/ext/forum-notifications/mark-all-read',
			{
				method: 'POST',
				body: {},
			},
		)
		if (result.ok) unreadCache.clear()
		return result
	},
	moderationQueue: (request: Request, query: ModerationQueueQuery = {}) =>
		call<ModerationQueuePageDto>(request, buildModerationQueueApiPath(query)),
	moderationLogs: (request: Request, query: ModerationLogsQuery = {}) =>
		call<ModerationLogPageDto>(request, buildModerationLogsApiPath(query)),
	resolveReport: async (
		request: Request,
		body: Readonly<{
			reportId: string
			decision: 'resolved' | 'dismissed'
			deleteTarget?: boolean
			note?: string
		}>,
	) => {
		const result = await call<ModerationReportDto>(request, '/ext/forum-moderation/resolve', {
			method: 'POST',
			body,
		})
		if (result.ok) categoriesCache.clear()
		return result
	},
	createCategory: async (
		request: Request,
		body: Readonly<{ name: string; slug?: string; description?: string }>,
	) => {
		const result = await call<CategoryDto>(request, '/categories', { method: 'POST', body })
		if (result.ok) categoriesCache.clear()
		return result
	},
	recentThreads: (
		request: Request,
		page = 1,
		pageSize = 12,
		query: ReturnType<typeof feedQuery> = { sort: 'active', scope: 'all' },
	) =>
		call<RecentThreadsDto>(
			request,
			`/threads?page=${page}&pageSize=${pageSize}&sort=${query.sort}&scope=${query.scope}`,
		),
	categoryThreads: (request: Request, slug: string, page = 1) =>
		call<CategoryThreadsDto>(
			request,
			`/categories/${encodeURIComponent(slug)}/threads${pageQuery(page)}`,
		),
	/** `expand`: a top-level floor on the page whose replies are all wanted. */
	thread: (request: Request, id: string, page = 1, expand?: number) => {
		const query = new URLSearchParams()
		if (page > 1) query.set('page', String(page))
		if (expand !== undefined) query.set('expand', String(expand))
		const search = query.size > 0 ? `?${query}` : ''
		return call<ThreadDetailDto>(request, `/threads/${encodeURIComponent(id)}${search}`)
	},
	floorLocation: (request: Request, threadRef: string, floor: number) =>
		call<FloorLocationDto>(
			request,
			`/threads/${encodeURIComponent(threadRef)}/floors/${encodeURIComponent(String(floor))}`,
		),
	replies: (request: Request, postId: string, page = 1, pageSize = 50) =>
		call<PageDto<PostDto>>(
			request,
			`/posts/${encodeURIComponent(postId)}/replies?page=${page}&pageSize=${pageSize}`,
		),
	createThread: async (
		request: Request,
		body: Readonly<{ categoryId: string; title: string; body: string }>,
	) => {
		const result = await call<ThreadDto>(request, '/threads', { method: 'POST', body })
		if (result.ok) categoriesCache.clear()
		return result
	},
	/** `parentId`: the post answered, for a reply inside a floor. */
	createPost: async (request: Request, threadId: string, body: string, parentId?: string) => {
		const result = await call<PostDto>(request, `/threads/${encodeURIComponent(threadId)}/posts`, {
			method: 'POST',
			body: parentId === undefined ? { body } : { body, parentId },
		})
		if (result.ok) categoriesCache.clear()
		return result
	},
	updateThread: async (
		request: Request,
		id: string,
		body: Readonly<{ title?: string; pinned?: boolean; locked?: boolean; categoryId?: string }>,
	) => {
		const result = await call<ThreadDto>(request, `/threads/${encodeURIComponent(id)}`, {
			method: 'PATCH',
			body,
		})
		// A move changes two categories' counts.
		if (result.ok && body.categoryId !== undefined) categoriesCache.clear()
		return result
	},
	deleteThread: async (request: Request, id: string) => {
		const result = await call<null>(request, `/threads/${encodeURIComponent(id)}`, {
			method: 'DELETE',
		})
		if (result.ok) categoriesCache.clear()
		return result
	},
	postLocation: (request: Request, id: string) =>
		call<Readonly<{ threadRef: string; postNumber: number }>>(
			request,
			`/posts/${encodeURIComponent(id)}/location`,
		),
	updatePost: (request: Request, id: string, body: string) =>
		call<PostDto>(request, `/posts/${encodeURIComponent(id)}`, {
			method: 'PATCH',
			body: { body },
		}),
	deletePost: async (request: Request, id: string) => {
		const result = await call<null>(request, `/posts/${encodeURIComponent(id)}`, {
			method: 'DELETE',
		})
		if (result.ok) categoriesCache.clear()
		return result
	},
	userProfile: (request: Request, id: string, page = 1, kind: ThreadKind = 'topic') => {
		const query = new URLSearchParams()
		if (page > 1) query.set('page', String(page))
		if (kind === 'note') query.set('kind', 'note')
		const search = query.size > 0 ? `?${query}` : ''
		return call<UserProfileDto>(request, `/users/${encodeURIComponent(id)}${search}`)
	},
	updateProfile: async (
		request: Request,
		id: string,
		body: Readonly<{ displayName?: string; handle?: string }>,
	) => {
		const result = await call<UserDto>(request, `/users/${encodeURIComponent(id)}`, {
			method: 'PATCH',
			body,
		})
		if (result.ok) metaCache.clear()
		return result
	},
	/** A write action of an extension plugin; the answer's shape is the extension's own. */
	extAction: async (request: Request, extId: string, action: string, body: unknown) => {
		const result = await call<unknown>(
			request,
			`/ext/${encodeURIComponent(extId)}/${encodeURIComponent(action)}`,
			{
				method: 'POST',
				body,
			},
		)
		if (result.ok) {
			metaCache.clear()
			unreadCache.clear()
		}
		return result
	},
}

/** A text form field; a missing or file value reads as empty. */
export function textField(form: FormData, name: string): string {
	const value = form.get(name)
	return typeof value === 'string' ? value : ''
}
