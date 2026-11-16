import { type ComponentProps, useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { Link, Outlet, useLocation, useMatches, useNavigate } from 'react-router'

import {
	type ResolvedStage,
	resolveStage,
	stageDetailHref,
	stageMotion,
	type StageMotion,
} from '../../lib/stage'

/** The stage of the current location, derived from the matched routes' `handle.stage`. */
export function useStage(): ResolvedStage {
	const matches = useMatches()
	const { pathname, search } = useLocation()
	return useMemo(
		() => resolveStage(matches, new URL(`${pathname}${search}`, 'http://stage.local')),
		[matches, pathname, search],
	)
}

/** The current stage and a link that opens a thread beside the current list. */
export function useStageLinks() {
	const stage = useStage()
	const detail = useCallback(
		(threadRef: string, postRef?: string | number) => stageDetailHref(stage, threadRef, postRef),
		[stage],
	)
	return { stage, detail }
}

/**
 * A router link that animates the stage with a view transition. Use it for every in-forum
 * navigation so moving between pages, lists and details all share the same motion.
 */
export function StageLink(props: ComponentProps<typeof Link>) {
	return <Link viewTransition {...props} />
}

/** `navigate()` with the stage's view transition. */
export function useStageNavigate() {
	const navigate = useNavigate()
	return useCallback(
		(to: string, options?: { replace?: boolean }) =>
			navigate(to, { ...options, viewTransition: true }),
		[navigate],
	)
}

/**
 * Publishes how the stage is moving on `<html data-stage-motion>` (push / pop / detail / list).
 * React Router commits the new route inside the view transition's update callback, and layout
 * effects run in that commit, so the attribute is in place before the transition's animations
 * are created. It covers back / forward navigations too, whose direction is only known here.
 */
export function StageMotionSync() {
	const stage = useStage()
	const previous = useRef<ResolvedStage | null>(null)
	useLayoutEffect(() => {
		const from = previous.current
		previous.current = stage
		const motion: StageMotion = from === null ? 'none' : stageMotion(from, stage)
		const root = document.documentElement
		root.dataset.stageMotion = motion
		root.dataset.stageDepth = String(stage.depth)
	}, [stage])
	return null
}

const LIST_WIDE =
	'min-w-0 flex-1 px-4 py-4 [view-transition-name:stage-list] lg:overflow-y-auto lg:px-8 lg:py-5'
const LIST_NARROW =
	'border-line bg-panel/35 w-[280px] shrink-0 border-r px-3 py-4 [view-transition-name:stage-list-side] max-lg:hidden lg:overflow-y-auto xl:w-[320px] 2xl:w-[380px]'
const DETAIL =
	'bg-page min-w-0 flex-1 px-4 py-4 [view-transition-name:stage-detail] lg:overflow-y-auto lg:px-8 lg:py-5'

/**
 * The list layer's panes: the list on its own at depth 1, and list + detail (the child route) at
 * depth 2. The list pane is the same element at both depths, so its scroll position survives
 * opening and closing details. Its two layouts carry different view-transition names: they are
 * too different to morph into each other, so one leaves while the other comes in. `children` renders the list and learns whether a detail is open.
 */
export function StageSplit({
	label,
	children,
}: {
	label: string
	children: (detailOpen: boolean) => React.ReactNode
}) {
	const stage = useStage()
	const location = useLocation()
	const detailOpen = stage.depth === 2

	// Another list (path, filters or page) starts at the top; opening a detail keeps the scroll.
	const listRef = useRef<HTMLElement>(null)
	const scrolledList = useRef(stage.listKey)
	useLayoutEffect(() => {
		if (scrolledList.current === stage.listKey) return
		scrolledList.current = stage.listKey
		listRef.current?.scrollTo({ top: 0 })
	}, [stage.listKey])

	// A new detail, or another page of it, starts at the top unless the URL points at a post.
	const detailPage = new URLSearchParams(location.search).get('page') ?? '1'
	const detailRef = useRef<HTMLDivElement>(null)
	const scrolledDetail = useRef<string | null>(null)
	useLayoutEffect(() => {
		const key = stage.detailKey === null ? null : `${stage.detailKey}?page=${detailPage}`
		if (scrolledDetail.current === key) return
		scrolledDetail.current = key
		if (key === null || location.hash.startsWith('#post-')) return
		detailRef.current?.scrollTo({ top: 0 })
	}, [stage.detailKey, detailPage, location.hash])

	return (
		<div className="flex min-h-0 w-full flex-1 lg:overflow-hidden">
			<section ref={listRef} aria-label={label} className={detailOpen ? LIST_NARROW : LIST_WIDE}>
				<div
					className={
						detailOpen ? '@container/threads' : '@container/threads mx-auto max-w-[1040px]'
					}
				>
					{children(detailOpen)}
				</div>
			</section>
			{detailOpen && (
				<div ref={detailRef} className={DETAIL}>
					<Outlet />
				</div>
			)}
		</div>
	)
}

/**
 * Space at the end of a mobile page for its fixed thumb-zone bar. Bars render it themselves, so
 * only pages that have a bar reserve the room.
 */
export function MobileBarSpacer() {
	return (
		<div
			aria-hidden
			className="h-[calc(var(--h-control)+2rem+env(safe-area-inset-bottom))] lg:hidden"
		/>
	)
}
