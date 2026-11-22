import type { Route } from './+types/api-forum'
import { forumApiUrl, invalidateForumCaches } from '../lib/forum-api.server'

// Hop-by-hop headers must not be forwarded by a proxy (RFC 9110 §7.6.1).
const HOP_BY_HOP = ['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'host']

async function forward(request: Request): Promise<Response> {
	const incoming = new URL(request.url)
	const target = forumApiUrl(incoming.pathname + incoming.search)
	const headers = new Headers(request.headers)
	for (const name of HOP_BY_HOP) headers.delete(name)
	headers.set('x-forwarded-host', incoming.host)
	headers.set('x-forwarded-proto', incoming.protocol.replace(':', ''))
	const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
	const upstream = await fetch(target, {
		method: request.method,
		headers,
		body: hasBody ? request.body : undefined,
		// Required by Node's fetch when streaming a request body.
		...(hasBody ? { duplex: 'half' } : {}),
		redirect: 'manual',
		signal: request.signal,
	})
	const responseHeaders = new Headers(upstream.headers)
	// fetch already decoded the body; drop encoding/length that no longer match it.
	responseHeaders.delete('content-encoding')
	responseHeaders.delete('content-length')
	return new Response(upstream.body, {
		status: upstream.status,
		statusText: upstream.statusText,
		headers: responseHeaders,
	})
}

export function loader({ request }: Route.LoaderArgs) {
	return forward(request)
}

// Writes that change nothing the cached `/meta`, categories or unread counts show.
const PRIVATE_WRITES = ['/api/forum/ext/forum-drafts/']

export async function action({ request }: Route.ActionArgs) {
	const response = await forward(request)
	const { pathname } = new URL(request.url)
	if (!PRIVATE_WRITES.some((prefix) => pathname.startsWith(prefix))) invalidateForumCaches()
	return response
}
