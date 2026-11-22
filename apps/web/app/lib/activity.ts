// Live updates without moving the page: open lists and threads ask the forum API every so often
// whether others wrote something since the newest activity they show, and offer a prompt that
// loads it. Polling a tiny, uncached endpoint (`private, no-store`) is all Cloudflare passes
// through reliably; a long-lived stream would be buffered or cut there.

import { useCallback, useEffect, useState } from 'react'

/** How often a visible page asks. Hidden tabs do not ask at all. */
export const ACTIVITY_POLL_MS = 30_000
/** Failures back off, doubling up to this. */
const ACTIVITY_MAX_DELAY_MS = 5 * 60_000

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
 * Polls `path` while the tab is visible and returns its latest answer with something new in it
 * (`count > 0`), or null. A new `path` (the page reloaded its data) starts over at null; `dismiss`
 * hides the answer until the next poll. `null` as the path stops polling. `parse` must be stable.
 */
export function useActivity<T extends Readonly<{ count: number }>>(
	path: string | null,
	parse: (body: unknown) => T | null,
): Readonly<{ activity: T | null; dismiss: () => void }> {
	const [state, setState] = useState<Readonly<{ path: string; value: T }> | null>(null)

	useEffect(() => {
		if (path === null) return undefined
		let stopped = false
		let inFlight = false
		let timer: ReturnType<typeof setTimeout> | undefined
		let delay = ACTIVITY_POLL_MS
		// The page's data was just loaded, which counts as the first look.
		let lastLook = Date.now()
		const controller = new AbortController()

		const schedule = (ms: number) => {
			clearTimeout(timer)
			timer = setTimeout(() => void poll(), ms)
		}
		const poll = async () => {
			if (stopped || inFlight || document.visibilityState !== 'visible') return
			inFlight = true
			try {
				const response = await fetch(path, {
					headers: { accept: 'application/json' },
					cache: 'no-store',
					credentials: 'same-origin',
					signal: controller.signal,
				})
				if (!response.ok) throw new Error(`activity ${response.status}`)
				const value = parse(await response.json())
				if (value === null) throw new Error('activity: unexpected answer')
				if (!stopped) setState(value.count > 0 ? { path, value } : null)
				delay = ACTIVITY_POLL_MS
			} catch {
				if (stopped) return
				delay = Math.min(delay * 2, ACTIVITY_MAX_DELAY_MS)
			} finally {
				inFlight = false
				lastLook = Date.now()
			}
			if (!stopped) schedule(delay)
		}
		// Back on a hidden tab: ask right away when a look is due, else when it will be.
		const onVisibility = () => {
			if (document.visibilityState !== 'visible') {
				clearTimeout(timer)
				return
			}
			if (!inFlight) schedule(Math.max(0, lastLook + delay - Date.now()))
		}

		schedule(delay)
		document.addEventListener('visibilitychange', onVisibility)
		return () => {
			stopped = true
			clearTimeout(timer)
			controller.abort()
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
