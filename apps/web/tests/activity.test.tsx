import { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import {
	ACTIVITY_POLL_MS,
	activityLabelCount,
	listActivityPath,
	newestInstant,
	parseFloorLocation,
	parseListActivity,
	parseThreadActivity,
	threadActivityPath,
	useActivity,
	type ListActivity,
} from '../app/lib/activity'

describe('activity helpers', () => {
	it('takes the newest instant, or the epoch for an empty page', () => {
		expect(
			newestInstant(['2026-11-20T10:00:00.000Z', '2026-11-22T08:30:00.000Z', 'nonsense']),
		).toBe('2026-11-22T08:30:00.000Z')
		expect(newestInstant([])).toBe('1970-01-01T00:00:00.000Z')
	})

	it('builds the API paths, leaving defaults out', () => {
		const since = '2026-11-22T08:30:00.000Z'
		expect(listActivityPath(since, {})).toBe(
			'/api/forum/activity?since=2026-11-22T08%3A30%3A00.000Z',
		)
		expect(listActivityPath(since, { sort: 'new', scope: 'following' })).toBe(
			'/api/forum/activity?since=2026-11-22T08%3A30%3A00.000Z&sort=new&scope=following',
		)
		expect(listActivityPath(since, { category: 'general', sort: 'active', scope: 'all' })).toBe(
			'/api/forum/activity?since=2026-11-22T08%3A30%3A00.000Z&category=general',
		)
		expect(threadActivityPath('1001-hello', since)).toBe(
			'/api/forum/threads/1001-hello/activity?since=2026-11-22T08%3A30%3A00.000Z',
		)
	})

	it('accepts only the shapes the API answers', () => {
		expect(parseListActivity({ count: 3 })).toEqual({ count: 3 })
		expect(parseListActivity({ count: -1 })).toBeNull()
		expect(parseListActivity({ total: 3 })).toBeNull()
		expect(parseThreadActivity({ count: 2, floor: 7 })).toEqual({ count: 2, floor: 7 })
		expect(parseThreadActivity({ count: 0, floor: null })).toEqual({ count: 0, floor: null })
		expect(parseThreadActivity({ count: 2 })).toBeNull()
		expect(parseFloorLocation({ threadRef: '1001', floor: 7, page: 2, parentFloor: null })).toEqual(
			{ page: 2, parentFloor: null },
		)
		expect(parseFloorLocation({ page: 0, parentFloor: null })).toBeNull()
		expect(activityLabelCount(5)).toBe('5')
		expect(activityLabelCount(100)).toBe('99+')
	})
})

/** What the probe component last saw, recorded after each render. */
const probe: { seen: Array<ListActivity | null>; dismiss: () => void } = {
	seen: [],
	dismiss: () => undefined,
}

function Probe({ path }: { path: string | null }) {
	const { activity, dismiss } = useActivity(path, parseListActivity)
	useEffect(() => {
		probe.seen.push(activity)
		probe.dismiss = dismiss
	})
	return null
}

async function advance(ms: number) {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms)
	})
}

describe('useActivity', () => {
	let container: HTMLDivElement
	let fetchMock: Mock<(input: string) => Promise<Response>>
	let hidden = false

	beforeEach(() => {
		vi.useFakeTimers()
		Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
		hidden = false
		vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() =>
			hidden ? 'hidden' : 'visible',
		)
		fetchMock = vi.fn<(input: string) => Promise<Response>>(() =>
			Promise.resolve(Response.json({ count: 2 })),
		)
		vi.stubGlobal('fetch', fetchMock)
		container = document.createElement('div')
		document.body.append(container)
	})

	afterEach(() => {
		container.remove()
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
		vi.useRealTimers()
	})

	it('asks on a timer while visible, pauses while hidden and starts over for a new path', async () => {
		const root = createRoot(container)
		await act(async () => root.render(<Probe path="/api/forum/activity?since=a" />))
		expect(fetchMock).not.toHaveBeenCalled()
		expect(probe.seen.at(-1)).toBeNull()

		await advance(ACTIVITY_POLL_MS)
		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/forum/activity?since=a')
		expect(probe.seen.at(-1)).toEqual({ count: 2 })

		await act(async () => probe.dismiss())
		expect(probe.seen.at(-1)).toBeNull()

		// Hidden: no requests; back on the tab, a look that is due happens at once.
		hidden = true
		document.dispatchEvent(new Event('visibilitychange'))
		await advance(ACTIVITY_POLL_MS * 3)
		expect(fetchMock).toHaveBeenCalledTimes(1)
		hidden = false
		document.dispatchEvent(new Event('visibilitychange'))
		await advance(0)
		expect(fetchMock).toHaveBeenCalledTimes(2)

		// The page reloaded its data: the old answer no longer applies.
		await act(async () => root.render(<Probe path="/api/forum/activity?since=b" />))
		expect(probe.seen.at(-1)).toBeNull()

		// Nothing new reads as null; null as the path stops asking.
		fetchMock.mockImplementation(() => Promise.resolve(Response.json({ count: 0 })))
		await advance(ACTIVITY_POLL_MS)
		expect(probe.seen.at(-1)).toBeNull()
		const calls = fetchMock.mock.calls.length
		await act(async () => root.render(<Probe path={null} />))
		await advance(ACTIVITY_POLL_MS * 2)
		expect(fetchMock).toHaveBeenCalledTimes(calls)
		await act(async () => root.unmount())
	})

	it('backs off after failures', async () => {
		fetchMock.mockImplementation(() => Promise.resolve(new Response('', { status: 503 })))
		const root = createRoot(container)
		await act(async () => root.render(<Probe path="/api/forum/activity?since=a" />))
		await advance(ACTIVITY_POLL_MS)
		expect(fetchMock).toHaveBeenCalledTimes(1)
		// The next look waits twice as long.
		await advance(ACTIVITY_POLL_MS)
		expect(fetchMock).toHaveBeenCalledTimes(1)
		await advance(ACTIVITY_POLL_MS)
		expect(fetchMock).toHaveBeenCalledTimes(2)
		expect(probe.seen.at(-1)).toBeNull()
		await act(async () => root.unmount())
	})
})
