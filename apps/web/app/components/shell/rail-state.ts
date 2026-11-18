import { useSyncExternalStore } from 'react'
import { useRouteLoaderData } from 'react-router'

import { railCookie, type RailPreference } from '../../lib/rail'
import type { loader as rootLoader } from '../../root'

/*
 * Whether the visitor folded the rail, as chosen in this tab. Choosing writes the cookie (the
 * server reads it on the next request) and switches the rail at once, as the theme picker does.
 */
let chosen: RailPreference | null = null
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

export function setRailPreference(preference: RailPreference) {
	// oxlint-disable-next-line unicorn/no-document-cookie -- the rail cookie is meant to be readable and writable here.
	document.cookie = railCookie(preference)
	chosen = preference
	for (const listener of listeners) listener()
}

/** The rail preference to render: the one chosen in this tab, else the cookie's. */
export function useRailPreference(): RailPreference {
	const fromCookie = useRouteLoaderData<typeof rootLoader>('root')?.rail ?? 'full'
	const current = useSyncExternalStore(
		subscribe,
		() => chosen,
		() => null,
	)
	return current ?? fromCookie
}

/** Folds the rail to its icons, or opens it again. */
export function toggleRail(current: RailPreference) {
	setRailPreference(current === 'mini' ? 'full' : 'mini')
}
