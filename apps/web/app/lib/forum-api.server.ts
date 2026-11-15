// Server-only client for the forum API on the Pluxel host. Loaders and actions call it directly on
// the internal address; the browser never sees that address.
import type {
	ApiError,
	CategoryDto,
	CategoryThreadsDto,
	MetaDto,
	PostDto,
	ThreadDetailDto,
	ThreadDto,
} from '@forum/domain'
import { data } from 'react-router'

const DEFAULT_API_INTERNAL = 'http://127.0.0.1:5173'

export function forumApiUrl(path: string): URL {
	return new URL(path, process.env.FORUM_API_INTERNAL ?? DEFAULT_API_INTERNAL)
}

export type ApiResult<T> =
	| Readonly<{ ok: true; value: T }>
	| Readonly<{ ok: false; status: number; error: ApiError }>

const UNAVAILABLE: ApiError = { code: 'internal', message: '论坛服务暂时不可用' }

const ERROR_CODES = [
	'invalid',
	'unauthenticated',
	'forbidden',
	'not_found',
	'conflict',
	'unavailable',
	'internal',
] as const satisfies ReadonlyArray<ApiError['code']>

function apiErrorOf(body: unknown): ApiError {
	if (typeof body !== 'object' || body === null || !('error' in body)) return UNAVAILABLE
	const error: unknown = body.error
	if (typeof error !== 'object' || error === null) return UNAVAILABLE
	if (!('message' in error) || typeof error.message !== 'string') return UNAVAILABLE
	const reported: unknown = 'code' in error ? error.code : undefined
	// An unknown code only loses its specific handling; the message is still the API's own.
	const code = ERROR_CODES.find((known) => known === reported) ?? 'internal'
	return { code, message: error.message }
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
		return { ok: false, status: 502, error: UNAVAILABLE }
	}
	// 204 (a delete) has no body; it reads as null.
	const body: unknown = await response.json().catch(() => null)
	if (!response.ok) return { ok: false, status: response.status, error: apiErrorOf(body) }
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- forum-api validates every success response against the schema these DTO types mirror; this is the one place that trust is stated.
	return { ok: true, value: body as T }
}

/** For loaders: the value, or the API's failure as a route error response with the same status. */
export function orThrow<T>(result: ApiResult<T>): T {
	if (!result.ok) throw data(result.error.message, { status: result.status })
	return result.value
}

function pageQuery(page: number): string {
	return page > 1 ? `?page=${page}` : ''
}

/** The 1-based `page` search parameter of a page URL; anything malformed is page 1. */
export function pageParam(request: Request): number {
	const raw = new URL(request.url).searchParams.get('page') ?? ''
	return /^[1-9]\d{0,5}$/.test(raw) ? Number(raw) : 1
}

export const forumApi = {
	meta: (request: Request) => call<MetaDto>(request, '/meta'),
	categories: (request: Request) => call<{ items: CategoryDto[] }>(request, '/categories'),
	createCategory: (
		request: Request,
		body: Readonly<{ name: string; slug?: string; description?: string }>,
	) => call<CategoryDto>(request, '/categories', { method: 'POST', body }),
	categoryThreads: (request: Request, slug: string, page = 1) =>
		call<CategoryThreadsDto>(
			request,
			`/categories/${encodeURIComponent(slug)}/threads${pageQuery(page)}`,
		),
	thread: (request: Request, id: string, page = 1) =>
		call<ThreadDetailDto>(request, `/threads/${encodeURIComponent(id)}${pageQuery(page)}`),
	createThread: (
		request: Request,
		body: Readonly<{ categoryId: string; title: string; body: string }>,
	) => call<ThreadDto>(request, '/threads', { method: 'POST', body }),
	createPost: (request: Request, threadId: string, body: string) =>
		call<PostDto>(request, `/threads/${encodeURIComponent(threadId)}/posts`, {
			method: 'POST',
			body: { body },
		}),
	updateThread: (
		request: Request,
		id: string,
		body: Readonly<{ title?: string; pinned?: boolean; locked?: boolean }>,
	) => call<ThreadDto>(request, `/threads/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
	deleteThread: (request: Request, id: string) =>
		call<null>(request, `/threads/${encodeURIComponent(id)}`, { method: 'DELETE' }),
	updatePost: (request: Request, id: string, body: string) =>
		call<PostDto>(request, `/posts/${encodeURIComponent(id)}`, {
			method: 'PATCH',
			body: { body },
		}),
	deletePost: (request: Request, id: string) =>
		call<null>(request, `/posts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}

/** A text form field; a missing or file value reads as empty. */
export function textField(form: FormData, name: string): string {
	const value = form.get(name)
	return typeof value === 'string' ? value : ''
}
