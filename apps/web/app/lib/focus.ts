// Focus reading: the list pane folds away and the thread takes its place in a wider, centred
// column. The choice is the visitor's and lasts, so it is kept in this browser.

import { useSyncExternalStore } from 'react'

const KEY = 'forum_focus_reading'

let focused = false
let loaded = false
const listeners = new Set<() => void>()

function load(): boolean {
	if (!loaded) {
		loaded = true
		try {
			focused = window.localStorage.getItem(KEY) === '1'
		} catch {
			focused = false
		}
	}
	return focused
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

/** Switches focus reading on or off, for every part of the page that follows it. */
export function setFocusReading(next: boolean): void {
	load()
	focused = next
	try {
		window.localStorage.setItem(KEY, next ? '1' : '0')
	} catch {
		// Storage can be unavailable; the choice then lasts until the page is left.
	}
	for (const listener of listeners) listener()
}

export function toggleFocusReading(): void {
	setFocusReading(!load())
}

/** Whether focus reading is on. The server and the first client render say no; it then catches up. */
export function useFocusReading(): boolean {
	return useSyncExternalStore(subscribe, load, () => false)
}
