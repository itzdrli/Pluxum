import { useEffect } from 'react'
import { useParams, useRouteLoaderData } from 'react-router'

import { toggleFocusReading } from '../../lib/focus'
import type { loader as rootLoader } from '../../root'
import { useDock } from '../dock/composer-dock'
import { toggleRail, useRailPreference } from './rail-state'
import { useStage, useStageNavigate } from '../stage/stage'

/** The keys that do something on their own: not while typing, not with a modifier, not in a dialog. */
function isFreeKey(event: KeyboardEvent): boolean {
	if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return false
	const target = event.target
	if (
		target instanceof HTMLElement &&
		(target.tagName === 'INPUT' ||
			target.tagName === 'TEXTAREA' ||
			target.tagName === 'SELECT' ||
			target.isContentEditable)
	) {
		return false
	}
	// A palette, a menu or a confirmation owns the keyboard while it is open.
	return document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]') === null
}

/** The thread links of the list pane, in the order they are listed. */
function listedThreads(): HTMLAnchorElement[] {
	return [...document.querySelectorAll<HTMLAnchorElement>('[data-list-pane] a[data-thread-link]')]
}

/**
 * Single-key shortcuts for reading: J / K open the next / previous thread of the list, `[` folds the
 * list away for focus reading, `\` folds the category column to its icons, C starts a thread and R a reply, in the dock. (Ctrl/Cmd+K and `/`
 * belong to the command palette.) Draws nothing.
 */
export function GlobalShortcuts() {
	const navigate = useStageNavigate()
	const dock = useDock()
	const stage = useStage()
	const params = useParams()
	const viewer = useRouteLoaderData<typeof rootLoader>('root')?.meta?.viewer
	const signedIn = viewer?.user != null
	const slug = params.slug
	const depth = stage.depth
	const rail = useRailPreference()

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (!isFreeKey(event)) return
			switch (event.key) {
				case 'j':
				case 'k': {
					const links = listedThreads()
					if (links.length === 0) return
					const current = links.findIndex((link) => link.getAttribute('aria-current') === 'page')
					const step = event.key === 'j' ? 1 : -1
					const next = current < 0 ? (step > 0 ? 0 : links.length - 1) : current + step
					const link = links[next]
					const href = link?.getAttribute('href')
					if (link === undefined || href === null) return
					event.preventDefault()
					link.scrollIntoView({ block: 'nearest' })
					void navigate(href)
					return
				}
				case '[': {
					if (depth !== 2) return
					event.preventDefault()
					toggleFocusReading()
					return
				}
				case '\\': {
					// Folds the category column to its icons, or opens it again (wide screens only).
					if (!stage.nav || !window.matchMedia('(min-width: 1024px)').matches) return
					event.preventDefault()
					toggleRail(rail)
					return
				}
				case 'c': {
					if (!signedIn) return
					event.preventDefault()
					dock.openThread(slug ?? null)
					return
				}
				case 'r': {
					const reply = document.querySelector<HTMLElement>('[data-shortcut="reply"]')
					if (reply === null) return
					event.preventDefault()
					reply.click()
					return
				}
				default:
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [navigate, dock, depth, signedIn, slug, rail, stage.nav])
	return null
}
