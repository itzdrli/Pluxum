// Focus reading: the list pane folds away and the thread takes its place in a wider, centred
// column. The choice is the visitor's and lasts. It is kept in a cookie, like the theme and the
// rail, so a server-rendered page arrives already folded instead of folding after hydration.

import { useSyncExternalStore } from 'react'
import { useRouteLoaderData } from 'react-router'

import type { loader as rootLoader } from '../root'

export const FOCUS_COOKIE = 'forum_focus_reading'
/** Where the choice lived before the cookie; read once to carry it over. */
const LEGACY_STORAGE_KEY = 'forum_focus_reading'

function cookieValue(cookies: string): boolean | null {
	for (const part of cookies.split(';')) {
		const separator = part.indexOf('=')
		if (separator > 0 && part.slice(0, separator).trim() === FOCUS_COOKIE) {
			return part.slice(separator + 1).trim() === '1'
		}
	}
	return null
}

/** Whether the request's cookie asks for focus reading. */
export function focusFromRequest(request: Request): boolean {
	return cookieValue(request.headers.get('cookie') ?? '') === true
}

export function focusCookie(on: boolean): string {
	return `${FOCUS_COOKIE}=${on ? '1' : '0'}; Path=/; Max-Age=31536000; SameSite=Lax`
}

const listeners = new Set<() => void>()
let migrated = false

function writeCookie(on: boolean) {
	// oxlint-disable-next-line unicorn/no-document-cookie -- the focus cookie is meant to be readable and writable here.
	document.cookie = focusCookie(on)
}

/** The choice as the browser holds it now. */
function current(): boolean {
	const fromCookie = cookieValue(document.cookie)
	if (fromCookie !== null) return fromCookie
	// Once: a choice made before the cookie existed moves into it.
	if (!migrated) {
		migrated = true
		try {
			if (window.localStorage.getItem(LEGACY_STORAGE_KEY) === '1') {
				window.localStorage.removeItem(LEGACY_STORAGE_KEY)
				writeCookie(true)
				return true
			}
		} catch {
			// Storage can be unavailable; there is then nothing to carry over.
		}
	}
	return false
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

/** Switches focus reading on or off, for every part of the page that follows it. */
export function setFocusReading(next: boolean): void {
	writeCookie(next)
	for (const listener of listeners) listener()
}

export function toggleFocusReading(): void {
	setFocusReading(!current())
}

/** Whether focus reading is on: the cookie's answer, on the server and in the browser alike. */
export function useFocusReading(): boolean {
	const fromServer = useRouteLoaderData<typeof rootLoader>('root')?.focusReading ?? false
	return useSyncExternalStore(subscribe, current, () => fromServer)
}
