// Server-only: where this process reaches the Pluxel host. Never exposed to the browser.
const DEFAULT_API_INTERNAL = 'http://127.0.0.1:5173'

export function forumApiUrl(path: string): URL {
	return new URL(path, process.env.FORUM_API_INTERNAL ?? DEFAULT_API_INTERNAL)
}

export type Ping = Readonly<{ status: 'ok'; service: 'forum-api'; time: string }>

function isPing(value: unknown): value is Ping {
	return (
		typeof value === 'object' &&
		value !== null &&
		'status' in value &&
		value.status === 'ok' &&
		'time' in value &&
		typeof value.time === 'string'
	)
}

export type PingResult =
	| Readonly<{ ok: true; ping: Ping }>
	| Readonly<{ ok: false; reason: string }>

export async function fetchPing(signal: AbortSignal): Promise<PingResult> {
	try {
		const response = await fetch(forumApiUrl('/api/forum/ping'), { signal })
		if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` }
		const body: unknown = await response.json()
		return isPing(body) ? { ok: true, ping: body } : { ok: false, reason: 'unexpected response' }
	} catch (error) {
		return { ok: false, reason: error instanceof Error ? error.message : 'unreachable' }
	}
}
