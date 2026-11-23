import { meetsAccess } from '@pluxum/domain'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useParams, useRouteLoaderData } from 'react-router'

import { toggleFocusReading } from '../../lib/focus'
import { appHotkeys } from '../../lib/hotkeys'
import type { loader as rootLoader } from '../../root'
import type { loader as forumStageLoader } from '../../routes/forum-stage'
import { toggleRail, useRailPreference } from './rail-state'
import { useStage, useStageNavigate } from '../stage/stage'

/** The thread links of the list pane, in the order they are listed. */
function listedThreads(): HTMLAnchorElement[] {
	return [...document.querySelectorAll<HTMLAnchorElement>('[data-list-pane] a[data-thread-link]')]
}

/**
 * The page-wide shortcuts: J / K open the next / previous thread of the list, `[` folds the list
 * away for focus reading, `\` folds the category column to its icons, C opens the new-thread page
 * (of the category in view, else the first), R starts a reply in the dock and G then H / N / M go
 * to the overview, the notifications or the messages. Typing in a field, an open dialog or a menu
 * keeps the keys (the hotkeys library and the dialogs' KeyboardScope see to it). Draws nothing.
 */
export function GlobalShortcuts() {
	const navigate = useStageNavigate()
	// The boards a new thread can go to; the stream takes notes, written in the note box.
	const categories = useRouteLoaderData<typeof forumStageLoader>('routes/forum-stage')?.categories
	const stage = useStage()
	const params = useParams()
	const viewer = useRouteLoaderData<typeof rootLoader>('root')?.meta?.viewer
	const signedIn = viewer?.user != null
	const rail = useRailPreference()

	const step = (by: 1 | -1) => {
		const links = listedThreads()
		if (links.length === 0) return
		const current = links.findIndex((link) => link.getAttribute('aria-current') === 'page')
		const next = current < 0 ? (by > 0 ? 0 : links.length - 1) : current + by
		const link = links[next]
		const href = link?.getAttribute('href')
		if (link === undefined || href == null) return
		link.scrollIntoView({ block: 'nearest' })
		void navigate(href)
	}
	useHotkey(appHotkeys['list.next'], () => step(1))
	useHotkey(appHotkeys['list.previous'], () => step(-1))

	useHotkey(appHotkeys['view.focus'], () => toggleFocusReading(), { enabled: stage.depth === 2 })
	// Folds the category column to its icons, or opens it again (wide screens only).
	useHotkey(
		appHotkeys['view.rail'],
		() => {
			if (window.matchMedia('(min-width: 1024px)').matches) toggleRail(rail)
		},
		{ enabled: stage.nav },
	)

	const boards = (categories ?? []).filter((category) =>
		meetsAccess(viewer?.roles ?? [], category.access, 'post'),
	)
	const board = boards.find((category) => category.slug === params.slug) ?? boards[0]
	useHotkey(appHotkeys['thread.new'], () => void navigate(`/c/${board?.slug}/new`), {
		enabled: signedIn && board !== undefined,
	})
	useHotkey(appHotkeys['thread.reply'], () => {
		document.querySelector<HTMLElement>('[data-shortcut="reply"]')?.click()
	})

	useHotkey(appHotkeys['go.home'], () => void navigate('/'))
	useHotkey(appHotkeys['go.notifications'], () => void navigate('/notifications'), {
		enabled: signedIn,
	})
	useHotkey(appHotkeys['go.messages'], () => void navigate('/messages'), { enabled: signedIn })
	return null
}
