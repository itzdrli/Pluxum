import {
	type ComponentProps,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react'
import {
	Link,
	Outlet,
	useLocation,
	useMatches,
	useNavigate,
	useNavigation,
	useParams,
} from 'react-router'

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'

import { toggleFocusReading, useFocusReading } from '../../lib/focus'
import { jumpPaneTo, useSmoothScroll } from './smooth-scroll'
import { IconButton } from '../ui/button'

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

/**
 * The thread open beside the list, as the list should show it: while a move to another thread of
 * the same list is under way that one already counts, so a J/K or a click lights the row at once
 * and the detail follows when its data arrives.
 */
export function useOpenThreadRef(): string | undefined {
	const params = useParams()
	const pending = useNavigation().location?.pathname
	const next = pending === undefined ? null : /\/t\/([^/]+)\/?$/.exec(pending)
	return next?.[1] ?? params.id
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
	const { pathname } = useLocation()
	const previous = useRef<{ stage: ResolvedStage; pathname: string } | null>(null)
	useLayoutEffect(() => {
		const from = previous.current
		previous.current = { stage, pathname }
		let motion: StageMotion = from === null ? 'none' : stageMotion(from.stage, stage)
		// Another standalone page (the overview, notifications, moderation) takes the same pane.
		if (motion === 'none' && from !== null && stage.depth === 0 && from.pathname !== pathname) {
			motion = 'page'
		}
		const root = document.documentElement
		root.dataset.stageMotion = motion
		root.dataset.stageDepth = String(stage.depth)
	}, [stage, pathname])
	return null
}

// Every pane opens with its head (`pane-bar`, wide screens), so panes have no top padding there.
// They clip sideways: the head's background and line reach past its column to the pane's edges.
const LIST_WIDE =
	'min-w-0 flex-1 px-4 py-5 [view-transition-name:stage-list] lg:overflow-x-hidden lg:overflow-y-auto lg:px-10 lg:pt-0 lg:pb-7'
const LIST_NARROW =
	'border-line-soft bg-page shrink-0 border-r pb-5 [view-transition-name:stage-list-side] max-lg:hidden lg:overflow-x-hidden lg:overflow-y-auto'
/** The narrow list's width, open and folded away (focus reading). */
const LIST_NARROW_OPEN = 'w-[280px] px-4 xl:w-[320px] 2xl:w-[380px]'
const LIST_NARROW_FOLDED = 'w-0 px-0 border-transparent opacity-0'
/**
 * The narrow list's content keeps (about) its open width while the pane folds, so it is clipped
 * rather than rewrapped line by line. 16px less than the room inside, for a classic scrollbar.
 */
const LIST_NARROW_CONTENT = 'min-w-[231px] xl:min-w-[271px] 2xl:min-w-[331px]'
/** Folding and unfolding animate the width, as the category column does. */
const FOLD_MOTION =
	'transition-[width,padding,opacity,border-color] duration-300 ease-[var(--stage-ease)]'
const DETAIL =
	'bg-page min-w-0 flex-1 px-4 py-5 [view-transition-name:stage-detail] lg:overflow-x-hidden lg:overflow-y-auto lg:px-10 lg:pt-0 lg:pb-7'

/**
 * Folds the list beside a detail away (focus reading) — it sits in the list's own head, next to
 * what it folds. The `[` shortcut does the same.
 */
export function FoldListButton() {
	return (
		<IconButton label="收起主题列表（[）" onPress={toggleFocusReading}>
			<PanelLeftClose aria-hidden />
		</IconButton>
	)
}

/**
 * The list layer's panes: the list on its own at depth 1, and list + detail (the child route) at
 * depth 2. The list pane is the same element at both depths, so its scroll position survives
 * opening and closing details. Its two layouts carry different view-transition names: they are
 * too different to morph into each other, so one leaves while the other comes in. `children` renders the list and learns whether a detail is open.
 */
export function StageSplit({
	label,
	short,
	children,
}: {
	/** Names the list pane for assistive technology. */
	label: string
	/** What the folded list's strip reads: a word or a name, not a sentence. Defaults to `label`. */
	short?: string
	children: (detailOpen: boolean) => React.ReactNode
}) {
	const stage = useStage()
	const location = useLocation()
	const detailOpen = stage.depth === 2
	const focus = useFocusReading() && detailOpen

	// Another list (path, filters or page) starts at the top; opening a detail keeps the scroll.
	const listRef = useRef<HTMLElement>(null)
	const scrolledList = useRef(stage.listKey)
	useLayoutEffect(() => {
		if (scrolledList.current === stage.listKey) return
		scrolledList.current = stage.listKey
		if (listRef.current !== null) jumpPaneTo(listRef.current, 0)
	}, [stage.listKey])

	// A new detail, or another page of it, starts at the top unless the URL points at a post.
	const detailPage = new URLSearchParams(location.search).get('page') ?? '1'
	const detailRef = useRef<HTMLDivElement>(null)
	useSmoothScroll(listRef)
	useSmoothScroll(detailRef, detailOpen)
	const scrolledDetail = useRef<string | null>(null)
	useLayoutEffect(() => {
		const key = stage.detailKey === null ? null : `${stage.detailKey}?page=${detailPage}`
		if (scrolledDetail.current === key) return
		scrolledDetail.current = key
		if (key === null || location.hash.startsWith('#post-')) return
		if (detailRef.current !== null) jumpPaneTo(detailRef.current, 0)
	}, [stage.detailKey, detailPage, location.hash])

	// Folding animates only once the page has painted: focus reading is restored from storage right
	// after hydration, and the list should simply be folded on arrival, not fold before your eyes.
	const [settled, setSettled] = useState(false)
	useEffect(() => {
		let second = 0
		const first = requestAnimationFrame(() => {
			second = requestAnimationFrame(() => setSettled(true))
		})
		return () => {
			cancelAnimationFrame(first)
			cancelAnimationFrame(second)
		}
	}, [])
	const motion = settled ? FOLD_MOTION : ''

	return (
		<div className="flex min-h-0 w-full flex-1 lg:overflow-hidden">
			{/* The folded list leaves a strip where it was, with the way to open it again. It is there
			    whenever a detail is open, at no width until the list folds, so it can grow in. */}
			{detailOpen && (
				<div
					inert={!focus}
					className={`border-line-soft bg-page flex shrink-0 flex-col items-center overflow-hidden border-r max-lg:hidden ${motion} ${
						focus ? 'w-10' : 'w-0 border-transparent opacity-0'
					}`}
				>
					<div className="flex h-[var(--h-pane-bar)] shrink-0 items-center">
						<IconButton label="展开主题列表（[）" onPress={toggleFocusReading}>
							<PanelLeftOpen aria-hidden />
						</IconButton>
					</div>
					<span
						title={label}
						className="text-ink-weak mt-2 max-h-[8em] overflow-hidden text-meta tracking-widest text-ellipsis whitespace-nowrap [writing-mode:vertical-rl]"
					>
						{short ?? label}
					</span>
				</div>
			)}
			<section
				ref={listRef}
				aria-label={label}
				data-list-pane
				inert={focus}
				className={
					detailOpen
						? `${LIST_NARROW} ${motion} ${focus ? LIST_NARROW_FOLDED : LIST_NARROW_OPEN}`
						: LIST_WIDE
				}
			>
				<div
					className={
						detailOpen
							? `@container/threads ${LIST_NARROW_CONTENT}`
							: '@container/threads mx-auto max-w-[1040px]'
					}
				>
					{children(detailOpen)}
				</div>
			</section>
			{detailOpen && (
				<div ref={detailRef} data-focus={focus} className={`group/detail ${DETAIL}`}>
					{/* Three surfaces: the pane is the page tone, the posts and the reply box are panels raised
					    on it, and the editor is a well sunk into its panel. */}
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
