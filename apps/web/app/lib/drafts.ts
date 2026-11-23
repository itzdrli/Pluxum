// Drafts kept on the server by Pluxum Drafts: a box's text is saved as it is typed and comes back
// when the same box opens again, on any device. Without the plugin (or signed out) every call is
// a quiet no-op and boxes behave as before.
import { useDebouncer } from '@tanstack/react-pacer'
import { useEffect, useRef } from 'react'

const BASE = '/api/forum/ext/forum-drafts'

/** How long typing must pause before the text is saved. */
export const DRAFT_SAVE_DELAY_MS = 1200

/** Browsers refuse a keepalive request body over 64 KiB; a larger one is sent without it. */
const KEEPALIVE_MAX = 60_000

/** False once the plugin answered that it is not running, or that the visitor is signed out. */
let available = true

function unavailable(status: number): boolean {
	if (status === 404 || status === 401) available = false
	return !available
}

/** The saved text of a box, or `''` when there is none or it cannot be read. */
export async function fetchDraft(key: string, signal?: AbortSignal): Promise<string> {
	if (!available) return ''
	try {
		const response = await fetch(`${BASE}/get?key=${encodeURIComponent(key)}`, {
			headers: { accept: 'application/json' },
			signal,
		})
		if (unavailable(response.status) || !response.ok) return ''
		const body: unknown = await response.json()
		return typeof body === 'object' &&
			body !== null &&
			'body' in body &&
			typeof body.body === 'string'
			? body.body
			: ''
	} catch {
		return ''
	}
}

/** Saves the text of a box; blank text removes the draft. */
export async function storeDraft(key: string, body: string, keepalive = false): Promise<void> {
	if (!available) return
	const payload = JSON.stringify({ key, body })
	try {
		const response = await fetch(`${BASE}/save`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json' },
			body: payload,
			keepalive: keepalive && payload.length < KEEPALIVE_MAX,
		})
		unavailable(response.status)
	} catch {
		// Offline or leaving the page: the next save carries the text.
	}
}

/**
 * Keeps one field's text in step with its draft under `key`. When the field opens untouched,
 * a saved draft is handed to `restore`; afterwards each pause in typing saves the text. Submitting
 * the field's form stops saving (the server clears the draft once the post is out) until the text
 * changes again, which is what happens when the post was refused.
 */
export function useDraft({
	key,
	value,
	pristine,
	restore,
	formOf,
}: {
	/** Undefined: no draft for this field. */
	key: string | undefined
	value: string
	/** Whether the visitor has not typed in the field yet. */
	pristine: () => boolean
	restore: (body: string) => void
	/** The element whose form's submission ends the draft. */
	formOf: () => HTMLElement | null
}): void {
	// What the server holds for the key; null until it has been read.
	const saved = useRef<string | null>(null)
	const pending = useRef<string | null>(null)
	const submitted = useRef(false)
	const latestKey = useRef(key)
	const latestPristine = useRef(pristine)
	const latestRestore = useRef(restore)
	useEffect(() => {
		latestKey.current = key
		latestPristine.current = pristine
		latestRestore.current = restore
	})

	const flush = (keepalive = false) => {
		saver.cancel()
		const text = pending.current
		const target = latestKey.current
		pending.current = null
		if (text === null || target === undefined) return
		saved.current = text
		void storeDraft(target, text, keepalive)
	}
	// Each pause in typing saves; it reads the latest text through the ref, so it takes no arguments.
	const saver = useDebouncer(() => flush(), { wait: DRAFT_SAVE_DELAY_MS })

	useEffect(() => {
		if (key === undefined) return undefined
		const controller = new AbortController()
		saved.current = null
		submitted.current = false
		void (async () => {
			const body = await fetchDraft(key, controller.signal)
			if (controller.signal.aborted) return
			saved.current = body
			if (body.trim() !== '' && latestPristine.current()) latestRestore.current(body)
		})()
		const onSubmit = () => {
			submitted.current = true
			saver.cancel()
			pending.current = null
		}
		const onHide = () => flush(true)
		const form = formOf()?.closest('form')
		form?.addEventListener('submit', onSubmit)
		window.addEventListener('pagehide', onHide)
		return () => {
			controller.abort()
			form?.removeEventListener('submit', onSubmit)
			window.removeEventListener('pagehide', onHide)
			// Closing the box or moving on keeps what was typed.
			if (!submitted.current) flush(true)
		}
		// oxlint-disable-next-line react-hooks/exhaustive-deps -- once per key; the callbacks are read through refs.
	}, [key])

	useEffect(() => {
		// Before the draft is read, typing must not overwrite it with what the box started with.
		if (key === undefined || saved.current === null) return
		if (submitted.current) submitted.current = false
		if (value === saved.current) {
			pending.current = null
			saver.cancel()
			return
		}
		pending.current = value
		saver.maybeExecute()
		// oxlint-disable-next-line react-hooks/exhaustive-deps -- flush reads refs only.
	}, [key, value])
}
