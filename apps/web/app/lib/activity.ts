// Live updates without moving the page: open lists and threads long-poll the forum API (its
// message bus, after Discourse's) for what others wrote since the newest activity they show, and
// offer a prompt that loads it. Each request waits up to `ACTIVITY_WAIT_S` for a write and is
// answered as soon as there is more than the page already knows of; plain short requests are what
// Cloudflare passes through reliably, where a long-lived stream would be buffered or cut.

import { useCallback, useEffect, useState } from 'react'

/** How long one request may wait on the server for news. */
export const ACTIVITY_WAIT_S = 25
/**
 * The interval when the server does not hold requests (an older backend, or too many waiting):
 * an answer that comes back at once with nothing new falls back to asking on this timer.
 */
export const ACTIVITY_POLL_MS = 30_000
/** Failures back off from this, doubling up to `ACTIVITY_MAX_DELAY_MS`. */
const ACTIVITY_RETRY_MS = 5_000
const ACTIVITY_MAX_DELAY_MS = 5 * 60_000
/** An answer quicker than this, with nothing new, was not held. */
const ACTIVITY_HELD_MS = 1_000

/** `path` as a long poll that waits for more than `known`. */
export function longPollPath(path: string, known: number): string {
	return `${path}${path.includes('?') ? '&' : '?'}wait=${ACTIVITY_WAIT_S}&known=${known}`
}

export type ListActivity = Readonly<{ count: number }>
export type ThreadActivity = Readonly<{ count: number; floor: number | null }>

function countOf(body: unknown): number | null {
	if (typeof body !== 'object' || body === null || !('count' in body)) return null
	const value = body.count
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

export function parseListActivity(body: unknown): ListActivity | null {
	const count = countOf(body)
	return count === null ? null : { count }
}

export function parseThreadActivity(body: unknown): ThreadActivity | null {
	const count = countOf(body)
	if (count === null || typeof body !== 'object' || body === null || !('floor' in body)) {
		return null
	}
	const floor = body.floor
	if (floor !== null && (typeof floor !== 'number' || !Number.isSafeInteger(floor))) return null
	return { count, floor }
}

/** The newest of some ISO instants, or the epoch when there are none (anything is newer). */
export function newestInstant(values: Iterable<string>): string {
	let newest = 0
	for (const value of values) {
		const time = Date.parse(value)
		if (Number.isFinite(time) && time > newest) newest = time
	}
	return new Date(newest).toISOString()
}

/** The overview feed's or a category's activity path, for the instant the page is current to. */
export function listActivityPath(
	since: string,
	list: Readonly<{ category?: string; sort?: 'active' | 'new'; scope?: 'all' | 'following' }>,
): string {
	const params = new URLSearchParams({ since })
	if (list.category !== undefined) params.set('category', list.category)
	if (list.sort !== undefined && list.sort !== 'active') params.set('sort', list.sort)
	if (list.scope !== undefined && list.scope !== 'all') params.set('scope', list.scope)
	return `/api/forum/activity?${params}`
}

export function threadActivityPath(threadRef: string, since: string): string {
	return `/api/forum/threads/${encodeURIComponent(threadRef)}/activity?${new URLSearchParams({ since })}`
}

/** 「99+」 past what the API counts, so the prompt stays short. */
export function activityLabelCount(count: number): string {
	return count > 99 ? '99+' : String(count)
}

/**
 * Long-polls `path` while the tab is visible and returns its latest answer with something new in
 * it (`count > 0`), or null. A new `path` (the page reloaded its data) starts over at null;
 * `dismiss` hides the answer until more arrives. `null` as the path stops. `parse` must be stable.
 */
export function useActivity<T extends Readonly<{ count: number }>>(
	path: string | null,
	parse: (body: unknown) => T | null,
): Readonly<{ activity: T | null; dismiss: () => void }> {
	const [state, setState] = useState<Readonly<{ path: string; value: T }> | null>(null)

	useEffect(() => {
		if (path === null) return undefined
		let stopped = false
		let request: AbortController | null = null
		let timer: ReturnType<typeof setTimeout> | undefined
		let known = 0
		let failures = 0

		const schedule = (ms: number) => {
			clearTimeout(timer)
			timer = setTimeout(() => void ask(), ms)
		}
		const ask = async () => {
			if (stopped || request !== null || document.visibilityState !== 'visible') return
			const controller = new AbortController()
			request = controller
			const started = Date.now()
			let next: number
			try {
				const response = await fetch(longPollPath(path, known), {
					headers: { accept: 'application/json' },
					cache: 'no-store',
					credentials: 'same-origin',
					signal: controller.signal,
				})
				if (!response.ok) throw new Error(`activity ${response.status}`)
				const value = parse(await response.json())
				if (value === null) throw new Error('activity: unexpected answer')
				const changed = value.count !== known
				known = value.count
				failures = 0
				if (!stopped && changed) setState(value.count > 0 ? { path, value } : null)
				next = !changed && Date.now() - started < ACTIVITY_HELD_MS ? ACTIVITY_POLL_MS : 0
			} catch {
				// Hidden or gone: the request was cancelled on purpose; visibility starts it again.
				if (stopped || controller.signal.aborted) return
				failures += 1
				next = Math.min(ACTIVITY_RETRY_MS * 2 ** (failures - 1), ACTIVITY_MAX_DELAY_MS)
			} finally {
				if (request === controller) request = null
			}
			if (!stopped) schedule(next)
		}
		// A hidden tab holds no request; back on it, ask again at once.
		const onVisibility = () => {
			if (document.visibilityState !== 'visible') {
				clearTimeout(timer)
				request?.abort()
				request = null
				return
			}
			if (request === null) schedule(0)
		}

		schedule(0)
		document.addEventListener('visibilitychange', onVisibility)
		return () => {
			stopped = true
			clearTimeout(timer)
			request?.abort()
			document.removeEventListener('visibilitychange', onVisibility)
		}
	}, [path, parse])

	const dismiss = useCallback(() => setState(null), [])
	return { activity: state !== null && state.path === path ? state.value : null, dismiss }
}

/** Which page shows a floor and which floor it replies inside (`/threads/:ref/floors/:floor`). */
export function parseFloorLocation(
	body: unknown,
): Readonly<{ page: number; parentFloor: number | null }> | null {
	if (typeof body !== 'object' || body === null) return null
	if (!('page' in body) || !('parentFloor' in body)) return null
	const { page, parentFloor } = body
	if (typeof page !== 'number' || !Number.isSafeInteger(page) || page < 1) return null
	if (
		parentFloor !== null &&
		(typeof parentFloor !== 'number' || !Number.isSafeInteger(parentFloor))
	) {
		return null
	}
	return { page, parentFloor }
}
