import { useSyncExternalStore } from 'react'
import { useRouteLoaderData } from 'react-router'

import type { loader as rootLoader } from '../root'

// Times are shown in the visitor's own time zone. The server cannot know it, so the browser keeps
// it in a cookie (written once, after the first page): later server-rendered pages already use it.
// A first visit is rendered in the default zone and corrects itself once the page hydrates.

/** Cookie that remembers the visitor's IANA time zone, e.g. `Europe/Berlin`. */
export const TIME_ZONE_COOKIE = 'forum_tz'

/** What the server uses when it does not know the visitor's zone yet. */
export const DEFAULT_TIME_ZONE = 'Asia/Shanghai'

export function isTimeZone(value: unknown): value is string {
	if (typeof value !== 'string' || value === '' || value.length > 64) return false
	try {
		return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone !== ''
	} catch {
		return false
	}
}

/** The zone named by the request's cookie, or the default. */
export function timeZoneFromRequest(request: Pick<Request, 'headers'>): string {
	for (const part of (request.headers.get('cookie') ?? '').split(';')) {
		const separator = part.indexOf('=')
		if (separator > 0 && part.slice(0, separator).trim() === TIME_ZONE_COOKIE) {
			const value = decodeURIComponent(part.slice(separator + 1).trim())
			return isTimeZone(value) ? value : DEFAULT_TIME_ZONE
		}
	}
	return DEFAULT_TIME_ZONE
}

export function timeZoneCookie(zone: string): string {
	return `${TIME_ZONE_COOKIE}=${encodeURIComponent(zone)}; Path=/; Max-Age=31536000; SameSite=Lax`
}

/** The browser's own zone, or null where it cannot say. */
export function browserTimeZone(): string | null {
	const zone: unknown = Intl.DateTimeFormat().resolvedOptions().timeZone
	return isTimeZone(zone) ? zone : null
}

/** Remembers the browser's zone for the server's next render (a no-op when already stored). */
export function rememberTimeZone(known: string) {
	const zone = browserTimeZone()
	if (zone === null || zone === known) return
	// oxlint-disable-next-line unicorn/no-document-cookie -- the zone cookie is meant to be readable and writable here.
	document.cookie = timeZoneCookie(zone)
}

const noSubscription = () => () => undefined

/**
 * The zone to show times in: the browser's, and while hydrating, the server's, so the markup the
 * server sent and the first client render agree. Differing times are then redrawn.
 */
export function useTimeZone(): string {
	const fromServer = useRouteLoaderData<typeof rootLoader>('root')?.timeZone ?? DEFAULT_TIME_ZONE
	return useSyncExternalStore(
		noSubscription,
		() => browserTimeZone() ?? fromServer,
		() => fromServer,
	)
}
