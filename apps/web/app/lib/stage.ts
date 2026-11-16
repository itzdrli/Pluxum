/**
 * The stage: one interaction model shared by every forum page.
 *
 * A route joins the stage by exporting `handle = defineStage(...)` with one of three layers:
 *
 *   page    a standalone page (home, notifications, moderation). Depth 0. A page may ask for the
 *           category column (`nav`), as the home page does.
 *   list    a list of threads that can open one beside it (category, search, profile). Depth 1.
 *   detail  what a list opens in its detail pane (a thread, the new-thread form). Depth 2.
 *
 * A detail route is mounted as a child of its list route (`<list>/t/:id`), so the list stays
 * mounted, keeps its scroll and skips refetching while details switch. Everything the shell, the
 * panes, the mobile bars and the motion need (depth, close link, detail links, which panes show)
 * is derived here from the matched handles and the URL, never from per-page path checks.
 *
 * Pure module: no React, so loaders, `shouldRevalidate` and tests can use it.
 */

import { floorPageOf } from '@pluxum/domain'

/** Query parameter of the list's own page while a detail is open; `?page=` belongs to the detail. */
export const LIST_PAGE_PARAM = 'cpage'

export type StageDepth = 0 | 1 | 2

export type StagePageSpec = Readonly<{
	layer: 'page'
	/** Shows the category column beside the page, so the page is a pane of the same frame. */
	nav?: boolean
}>

export type StageListSpec = Readonly<{
	layer: 'list'
	/** Shows the category column beside the list, at depth 1 and 2 alike. */
	nav?: boolean
	/**
	 * Query parameters that define the list (filters, the search query). They are carried into
	 * detail links and back, and a change to any of them reloads the list. The list page
	 * (`LIST_PAGE_PARAM`) is always carried.
	 */
	carry?: readonly string[]
	/** Label of the mobile "back to list" control, e.g. 列表 / 结果. */
	backLabel: string
}>

export type StageDetailSpec = Readonly<{ layer: 'detail' }>

export type StageSpec = StagePageSpec | StageListSpec | StageDetailSpec

/** Declares how a route takes part in the stage; export the result as the route's `handle`. */
export function defineStage<const T extends StageSpec>(spec: T): Readonly<{ stage: T }> {
	return { stage: spec }
}

export type StageMatch = Readonly<{ id: string; pathname: string; handle: unknown }>

export type ResolvedStage = Readonly<{
	depth: StageDepth
	/** Whether the category navigation shows. */
	nav: boolean
	/** Desktop renders full height with panes that scroll on their own. */
	split: boolean
	/** The list without any detail: where closing a detail goes. */
	listHref: string | null
	/** Pathname of the list, the base for detail links. */
	listPath: string | null
	backLabel: string
	/** Identity of the list content: changes when its path, filters or page change. */
	listKey: string | null
	/** Identity of the open detail (pathname without query), null at depth < 2. */
	detailKey: string | null
}>

function isStageSpec(value: unknown): value is StageSpec {
	if (typeof value !== 'object' || value === null || !('layer' in value)) return false
	return value.layer === 'page' || value.layer === 'list' || value.layer === 'detail'
}

function specOf(handle: unknown): StageSpec | undefined {
	if (typeof handle !== 'object' || handle === null || !('stage' in handle)) return undefined
	return isStageSpec(handle.stage) ? handle.stage : undefined
}

function trimSlash(pathname: string): string {
	return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
}

function parsePositivePage(raw: string | null): number {
	return raw !== null && /^[1-9]\d{0,5}$/.test(raw) ? Number(raw) : 1
}

/**
 * The 1-based page of the list: `?cpage=` wherever it appears, or the plain `?page=` while no
 * detail is open (a list on its own paginates with `?page=`, as old links do).
 */
export function listPageOf(url: URL, detailOpen: boolean): number {
	if (url.searchParams.has(LIST_PAGE_PARAM)) {
		return parsePositivePage(url.searchParams.get(LIST_PAGE_PARAM))
	}
	return detailOpen ? 1 : parsePositivePage(url.searchParams.get('page'))
}

/** Whether a pathname is a detail inside a list (`…/t/:id` or `…/new`). */
export function isDetailPath(pathname: string): boolean {
	return /\/(?:t\/[^/]+|new)\/?$/.test(pathname)
}

/**
 * The page path a loader or action request stands for. Client navigations fetch `<path>.data`
 * (and `/_root.data` for `/`), and `request.url` keeps that suffix, so a redirect built from it
 * would send the browser to a `.data` URL that matches no thread.
 */
export function pagePathOf(url: URL): string {
	if (url.pathname === '/_root.data') return '/'
	return url.pathname.replace(/\.data$/, '')
}

/** The list a detail pathname belongs to: `/search/t/7` → `/search`, `/c/a/new` → `/c/a`. */
export function listPathOf(pathname: string): string {
	return trimSlash(pathname).replace(/\/(?:t\/[^/]+|new)$/, '') || '/'
}

/** Query string that identifies the list: its carried parameters and its page. */
function listQuery(
	url: URL,
	carry: readonly string[],
	detailOpen = isDetailPath(url.pathname),
): string {
	const params = new URLSearchParams()
	for (const name of carry) {
		const value = url.searchParams.get(name)
		if (value !== null && value !== '') params.set(name, value)
	}
	const page = listPageOf(url, detailOpen)
	if (page > 1) params.set(LIST_PAGE_PARAM, String(page))
	const query = params.toString()
	return query === '' ? '' : `?${query}`
}

/** Computes the stage from the matched routes (outermost first) and the current URL. */
export function resolveStage(matches: readonly StageMatch[], url: URL): ResolvedStage {
	let list: { match: StageMatch; spec: StageListSpec } | undefined
	let detail: StageMatch | undefined
	let page: StagePageSpec | undefined
	for (const match of matches) {
		const spec = specOf(match.handle)
		if (spec === undefined) continue
		if (spec.layer === 'list') list = { match, spec }
		else if (spec.layer === 'detail') detail = match
		else page = spec
	}

	if (list === undefined) {
		return {
			depth: 0,
			nav: page?.nav === true,
			split: page?.nav === true,
			listHref: null,
			listPath: null,
			backLabel: '返回',
			listKey: null,
			detailKey: null,
		}
	}

	const carry = list.spec.carry ?? []
	const listPath = trimSlash(list.match.pathname)
	const query = listQuery(url, carry, detail !== undefined)
	const depth: StageDepth = detail === undefined ? 1 : 2
	return {
		depth,
		nav: list.spec.nav === true,
		split: true,
		listHref: `${listPath}${query}`,
		listPath,
		backLabel: list.spec.backLabel,
		listKey: `${listPath}${query}`,
		detailKey: detail === undefined ? null : trimSlash(url.pathname),
	}
}

/**
 * Link that opens thread `threadRef` in the detail pane of the current list.
 * When `postRef` is a 1-based floor number (`number`), it also sets `?page=` when the floor is
 * past page 1, or links to `/t/<threadRef>/<floor>` when no list is active.
 */
export function stageDetailHref(
	stage: Pick<ResolvedStage, 'listPath' | 'listHref'>,
	threadRef: string,
	postRef?: string | number,
): string {
	const floor =
		typeof postRef === 'number' && Number.isSafeInteger(postRef) && postRef >= 1
			? postRef
			: undefined
	const hash = postRef === undefined ? '' : `#post-${postRef}`
	if (stage.listPath === null || stage.listHref === null) {
		return floor !== undefined && floor > 1 ? `/t/${threadRef}/${floor}` : `/t/${threadRef}${hash}`
	}
	const base = stage.listPath === '/' ? '' : stage.listPath
	const query = stage.listHref.slice(stage.listPath.length)
	if (floor !== undefined) {
		const page = floorPageOf(floor)
		if (page > 1) {
			const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query)
			params.set('page', String(page))
			return `${base}/t/${threadRef}?${params.toString()}${hash}`
		}
	}
	return `${base}/t/${threadRef}${query}${hash}`
}

/** How the stage moves between two states; drives the CSS of the view transition. */
export type StageMotion = 'push' | 'pop' | 'detail' | 'list' | 'none'

export function stageMotion(
	from: Pick<ResolvedStage, 'depth' | 'listKey' | 'detailKey'>,
	to: Pick<ResolvedStage, 'depth' | 'listKey' | 'detailKey'>,
): StageMotion {
	if (to.depth > from.depth) return 'push'
	if (to.depth < from.depth) return 'pop'
	if (from.listKey !== to.listKey) return 'list'
	if (from.detailKey !== to.detailKey) return 'detail'
	return 'none'
}

/**
 * `shouldRevalidate` for a list route: switching or paginating details inside the same list keeps
 * the list as it is; a change of the list's path, carried parameters or page, any write action
 * and an explicit `revalidate()` reload it. Theme and extension actions never do.
 */
export function listShouldRevalidate(carry: readonly string[] = []) {
	return (args: {
		currentUrl: URL
		nextUrl: URL
		formMethod?: string
		formAction?: string
		defaultShouldRevalidate: boolean
	}): boolean => {
		const { currentUrl, nextUrl, formMethod, formAction, defaultShouldRevalidate } = args
		if (formAction?.startsWith('/ext/') === true) return false
		const sameUrl =
			currentUrl.pathname === nextUrl.pathname &&
			currentUrl.search === nextUrl.search &&
			currentUrl.hash === nextUrl.hash
		if (!formMethod && sameUrl) return defaultShouldRevalidate
		if (formMethod && formMethod !== 'GET') return defaultShouldRevalidate
		const sameList =
			listPathOf(currentUrl.pathname) === listPathOf(nextUrl.pathname) &&
			listQuery(currentUrl, carry) === listQuery(nextUrl, carry)
		return sameList ? false : defaultShouldRevalidate
	}
}
