import type { CategoryDto } from '@pluxum/domain'
import {
	Bell,
	Hash,
	LayoutGrid,
	NotebookPen,
	PanelLeftClose,
	PanelLeftOpen,
	Plus,
	ShieldCheck,
	type LucideIcon,
} from 'lucide-react'
import { useRef } from 'react'
import { Link, Outlet, useLocation, useParams, useRouteLoaderData } from 'react-router'
import { useLingui } from '@lingui/react/macro'

import type { Route } from './+types/forum-stage'
import { PaletteTrigger } from '../components/palette/palette-trigger'
import { BrandMark } from '../components/shell/logo-mark'
import { SiteFooterCompact } from '../components/shell/site-footer'
import { UserMenu } from '../components/shell/user-menu'
import { useRailPreference, toggleRail } from '../components/shell/rail-state'
import { useSmoothScroll } from '../components/stage/smooth-scroll'
import { StageLink, useStage } from '../components/stage/stage'
import { IconButton } from '../components/ui/button'
import { railMode, railWidthClass } from '../lib/rail'
import { forumApi, orThrow } from '../lib/forum-api.server'
import { stageShouldRevalidate } from '../lib/revalidate'
import type { loader as rootLoader } from '../root'
import { siteOf } from '../lib/site'
import { STREAM_LABEL } from '../lib/stream'

/**
 * The stage frame around every list and detail route. It owns the category navigation: a column
 * beside every list or page that asks for it, the same from the home page to a detail, so moving
 * between them never moves it. Pages without the column (depth 0) render as they are.
 */
export async function loader({ request }: Route.LoaderArgs) {
	return { categories: orThrow(await forumApi.categories(request)).items }
}

/** A page that fills its pane grows with the window: reading width on laptops, more on big screens. */
const WIDE_PAGE = 'max-w-[1180px] 2xl:max-w-[1400px] min-[1920px]:max-w-[1600px]'

/*
 * The rail keeps one geometry whether it is full or folded: every glyph sits in a 24px slot whose
 * centre is 32px from the left edge, which is the centre of the folded 64px column. Folding then
 * only narrows the column and fades the labels, so nothing jumps sideways while it animates.
 */
const RAIL_ITEM =
	'relative flex h-11 items-center gap-3 overflow-hidden pr-5 pl-5 whitespace-nowrap transition-colors'
const RAIL_ITEM_ACTIVE = 'bg-selected text-ink-strong font-bold'
const RAIL_ITEM_IDLE = 'text-ink hover:bg-hover hover:text-ink-strong active:bg-pressed'
/** A label of the rail: fades out while the rail shows only icons. */
const RAIL_LABEL =
	'transition-opacity duration-200 rail-mini:pointer-events-none rail-mini:opacity-0'

/**
 * The accent bar of the rail's current destination. It carries a view-transition name, so moving
 * from one destination to another slides the bar along the rail.
 */
function RailIndicator() {
	return (
		<span
			aria-hidden
			style={{
				viewTransitionName: 'rail-indicator',
				viewTransitionClass: 'indicator',
			}}
			className="bg-accent absolute inset-y-0 left-0 w-0.5"
		/>
	)
}

export const shouldRevalidate = stageShouldRevalidate

export default function ForumStage({ loaderData }: Route.ComponentProps) {
	const { t } = useLingui()
	const { categories } = loaderData
	const stage = useStage()
	const params = useParams()
	const location = useLocation()
	const pathname = location.pathname
	const root = useRouteLoaderData<typeof rootLoader>('root')
	const canManageCategories = root?.meta?.viewer.can.manageCategories === true
	const preference = useRailPreference()
	const mode = railMode(preference, stage.depth)
	// Approximate for `auto` (folded on laptops only); it only picks where the account menu opens.
	const collapsed = mode !== 'full'
	const pageRef = useRef<HTMLDivElement>(null)
	useSmoothScroll(pageRef, stage.nav && stage.depth === 0)

	if (!stage.nav) return <Outlet />

	const siteName = siteOf(root).name
	return (
		<div
			data-stage-depth={stage.depth}
			className="relative flex min-h-0 w-full flex-1 lg:overflow-hidden"
		>
			<aside
				aria-label={t`版块导航`}
				data-rail={mode}
				className={`${railWidthClass(mode)} border-line-soft bg-sunken flex min-h-0 shrink-0 flex-col overflow-x-hidden border-r transition-[width] duration-300 ease-[var(--stage-ease)] [view-transition-name:stage-nav] max-lg:hidden`}
			>
				{/* Wide screens have no top bar: the frame's way home, its search and the account live
				    in this column, top and bottom, and every pane opens with a head of its own. */}
				<div className="group/head relative flex h-[var(--h-pane-bar)] shrink-0 items-center pr-3 pl-[18px]">
					<Link
						to="/"
						viewTransition
						aria-label={t`${siteName} 首页`}
						className={`text-ink-strong flex min-w-0 items-center gap-2.5 font-bold transition-opacity ${
							preference === 'mini'
								? 'group-hover/head:opacity-0 group-has-[:focus-visible]/head:opacity-0'
								: ''
						}`}
					>
						<BrandMark className="size-7 shrink-0" />
						<span className={`text-heading truncate ${RAIL_LABEL}`}>{siteName}</span>
					</Link>
					{preference === 'mini' ? (
						// Folded: the logo turns into the way to open the rail on hover, as in most editors.
						<IconButton
							label={t`展开侧栏（\\）`}
							key="expand"
							className="absolute top-1/2 left-3 -translate-y-1/2 opacity-0 group-hover/head:opacity-100 focus-visible:opacity-100"
							onPress={() => toggleRail(preference)}
						>
							<PanelLeftOpen aria-hidden />
						</IconButton>
					) : (
						<IconButton
							key="collapse"
							label={t`收起侧栏（\\）`}
							className={`text-ink-weak ml-auto shrink-0 ${RAIL_LABEL}`}
							onPress={() => toggleRail(preference)}
						>
							<PanelLeftClose aria-hidden />
						</IconButton>
					)}
				</div>
				<div className="shrink-0 px-3 pb-3">
					<PaletteTrigger
						variant="rail"
						collapsed={collapsed}
						active={pathname === '/search' || pathname.startsWith('/search/')}
					/>
				</div>
				<CategoryNavPanel
					categories={categories}
					activeSlug={params.slug}
					canManageCategories={canManageCategories}
					pathname={pathname}
					root={root}
					collapsed={collapsed}
				/>
				{/* The account first, the fine print last: the row people use sits above the one they don't. */}
				<div className="border-line-soft shrink-0 border-t">
					<UserMenu
						meta={root?.meta ?? null}
						here={`${pathname}${location.search}`}
						variant="rail"
						collapsed={collapsed}
					/>
				</div>
				<div className="flex shrink-0 flex-col rail-mini:hidden">
					<SiteFooterCompact />
				</div>
			</aside>
			{stage.depth === 0 ? (
				// A page beside the column: one scrolling pane with a reading width, opening with its head.
				<div
					ref={pageRef}
					className="min-w-0 flex-1 px-4 py-5 [view-transition-name:stage-page] lg:overflow-x-hidden lg:overflow-y-auto lg:px-10 lg:pt-0 lg:pb-8"
				>
					<div className={`mx-auto w-full ${stage.wide ? WIDE_PAGE : 'max-w-[1040px]'}`}>
						<Outlet />
					</div>
				</div>
			) : (
				<Outlet />
			)}
		</div>
	)
}

/** A destination of the frame: the overview, search, notifications, moderation. */
function RailLink({
	to,
	icon: Icon,
	label,
	active,
	badge,
	collapsed,
}: {
	to: string
	icon: LucideIcon
	label: string
	active: boolean
	badge?: number
	collapsed: boolean
}) {
	return (
		<li>
			<StageLink
				to={to}
				prefetch="intent"
				aria-current={active ? 'page' : undefined}
				title={collapsed ? label : undefined}
				className={`${RAIL_ITEM} ${active ? RAIL_ITEM_ACTIVE : RAIL_ITEM_IDLE}`}
			>
				{active && <RailIndicator />}
				<span className="flex size-6 shrink-0 items-center justify-center">
					<Icon aria-hidden size={16} className={active ? 'text-accent' : 'text-ink-weak'} />
				</span>
				<span className={`min-w-0 flex-1 truncate ${RAIL_LABEL}`}>{label}</span>
				{badge !== undefined && badge > 0 && (
					<span className="bg-accent text-page animate-pop-in min-w-5 shrink-0 rounded-[2px] px-1 text-center text-micro leading-5 font-bold tabular-nums transition-[top,left,right] rail-mini:absolute rail-mini:top-1 rail-mini:left-9">
						{badge > 99 ? '99+' : badge}
					</span>
				)}
			</StageLink>
		</li>
	)
}

function CategoryNavPanel({
	categories,
	activeSlug,
	canManageCategories,
	pathname,
	root,
	collapsed,
}: {
	categories: readonly CategoryDto[]
	activeSlug: string | undefined
	canManageCategories: boolean
	pathname: string
	root: ReturnType<typeof useRouteLoaderData<typeof rootLoader>>
	collapsed: boolean
}) {
	const { t, i18n } = useLingui()
	const meta = root?.meta
	// Staff reach the moderation page from the frame too, not only from the account menu.
	const moderationOn =
		meta != null &&
		(meta.viewer.roles.includes('moderator') || meta.viewer.roles.includes('admin')) &&
		meta.uiSlots.some((slot) => slot.extId === 'forum-moderation')
	const stream = meta?.stream ?? null
	const notificationsOn =
		meta?.viewer.user != null &&
		meta.uiSlots.some(
			(slot) => slot.slot === 'shell.actions' && slot.extId === 'forum-notifications',
		)
	return (
		<>
			<ul className="border-line-soft border-b pb-2">
				<RailLink
					to="/"
					icon={LayoutGrid}
					label={t`概览`}
					active={pathname === '/'}
					collapsed={collapsed}
				/>
				{/* The stream is no category among the others: its notes are a destination of their own. */}
				{stream !== null && (
					<RailLink
						to={`/c/${stream.slug}`}
						icon={NotebookPen}
						label={i18n._(STREAM_LABEL)}
						active={activeSlug === stream.slug}
						collapsed={collapsed}
					/>
				)}
				{notificationsOn && (
					<RailLink
						to="/notifications"
						icon={Bell}
						label={t`通知`}
						active={pathname === '/notifications'}
						badge={root?.unreadNotifications}
						collapsed={collapsed}
					/>
				)}
				{moderationOn && (
					<RailLink
						to="/moderation"
						icon={ShieldCheck}
						label={t`审核`}
						active={pathname === '/moderation'}
						collapsed={collapsed}
					/>
				)}
			</ul>
			{/* Folding closes this head to nothing, so the categories glide up instead of jumping. */}
			<div className="border-line-soft flex h-12 shrink-0 items-center justify-between gap-2 overflow-hidden border-b pr-3 pl-5 whitespace-nowrap transition-[height,opacity,border-color] duration-300 ease-[var(--stage-ease)] rail-mini:h-0 rail-mini:border-transparent rail-mini:opacity-0">
				<span className="section-label">
					{t`版块`} · {categories.length}
				</span>
				<div className="flex items-center gap-1">
					{canManageCategories && (
						<StageLink
							to="/?new=1"
							aria-label={t`新建版块`}
							title={t`新建版块`}
							tabIndex={collapsed ? -1 : undefined}
							className="text-ink-weak hover:bg-hover hover:text-ink-strong inline-flex size-control-sm items-center justify-center rounded-[2px]"
						>
							<Plus aria-hidden size={14} />
						</StageLink>
					)}
				</div>
			</div>
			<ul className="flex-1 overflow-x-hidden overflow-y-auto py-2">
				{categories.length === 0 ? (
					<li className={`text-ink-weak px-5 py-5 text-meta ${RAIL_LABEL}`}>{t`还没有版块`}</li>
				) : (
					categories.map((cat) => {
						const isActive = cat.slug === activeSlug
						return (
							<li key={cat.id}>
								<StageLink
									to={`/c/${cat.slug}`}
									prefetch="intent"
									aria-current={isActive ? 'page' : undefined}
									title={collapsed ? cat.name : undefined}
									className={`${RAIL_ITEM} ${isActive ? RAIL_ITEM_ACTIVE : RAIL_ITEM_IDLE}`}
								>
									{isActive && <RailIndicator />}
									{/* Icons only: every category would be the same 「#」, so the slot cross-fades to the
									    category's first character. */}
									<span className="relative flex size-6 shrink-0 items-center justify-center">
										<Hash
											aria-hidden
											size={16}
											className={`transition-opacity duration-200 rail-mini:opacity-0 ${isActive ? 'text-accent' : 'text-ink-weak'}`}
										/>
										<span
											aria-hidden
											className={`absolute inset-0 flex items-center justify-center rounded-[2px] text-ui font-bold opacity-0 transition-opacity duration-200 rail-mini:opacity-100 ${
												isActive ? 'text-accent' : 'bg-control text-ink-strong'
											}`}
										>
											{Array.from(cat.name)[0] ?? '#'}
										</span>
									</span>
									<span className={`min-w-0 flex-1 truncate ${RAIL_LABEL}`}>{cat.name}</span>
									<span className={`text-ink-weak shrink-0 text-meta tabular-nums ${RAIL_LABEL}`}>
										{cat.threadCount}
									</span>
								</StageLink>
							</li>
						)
					})
				)}
			</ul>
		</>
	)
}
