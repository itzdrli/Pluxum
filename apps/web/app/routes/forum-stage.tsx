import type { CategoryDto } from '@pluxum/domain'
import { Bell, Hash, LayoutGrid, Plus, ShieldCheck, type LucideIcon } from 'lucide-react'
import { Link, Outlet, useLocation, useParams, useRouteLoaderData } from 'react-router'

import type { Route } from './+types/forum-stage'
import { PaletteTrigger } from '../components/palette/palette-trigger'
import { LogoMark } from '../components/shell/logo-mark'
import { SiteFooterCompact } from '../components/shell/site-footer'
import { UserMenu } from '../components/shell/user-menu'
import { railCollapsed, railWidth, StageLink, useStage } from '../components/stage/stage'
import { forumApi, orThrow } from '../lib/forum-api.server'
import { stageShouldRevalidate } from '../lib/revalidate'
import type { loader as rootLoader } from '../root'
import { siteOf } from '../lib/site'

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
const RAIL_ITEM = 'flex items-center gap-3 border-l-2 pr-5 pl-7 h-11 transition-colors'
const RAIL_ITEM_ACTIVE = 'border-l-accent bg-selected text-ink-strong font-bold'
const RAIL_ITEM_IDLE = 'text-ink hover:bg-hover hover:text-ink-strong border-l-transparent'
/** The rail item's layout while the column shows only icons (lg up to xl, a detail open). */
const RAIL_ITEM_COLLAPSED = 'lg:max-xl:justify-center lg:max-xl:px-0'
/** Hidden while the column shows only icons. */
const COLLAPSED_HIDDEN = 'lg:max-xl:hidden'

export const shouldRevalidate = stageShouldRevalidate

export default function ForumStage({ loaderData }: Route.ComponentProps) {
	const { categories } = loaderData
	const stage = useStage()
	const params = useParams()
	const location = useLocation()
	const pathname = location.pathname
	const root = useRouteLoaderData<typeof rootLoader>('root')
	const canManageCategories = root?.meta?.viewer.can.manageCategories === true
	const collapsed = railCollapsed(stage)

	if (!stage.nav) return <Outlet />

	return (
		<div
			data-stage-depth={stage.depth}
			className="relative flex min-h-0 w-full flex-1 lg:overflow-hidden"
		>
			<aside
				aria-label="版块导航"
				className={`${railWidth(collapsed)} border-line-soft bg-sunken flex min-h-0 shrink-0 flex-col border-r [view-transition-name:stage-nav] max-lg:hidden`}
			>
				{/* Wide screens have no top bar: the frame's way home, its search and the account live
				    in this column, top and bottom, and every pane opens with a head of its own. */}
				<div
					className={`flex h-[var(--h-pane-bar)] shrink-0 items-center pl-5 ${collapsed ? 'lg:max-xl:justify-center lg:max-xl:pl-0' : ''}`}
				>
					<Link
						to="/"
						viewTransition
						aria-label={`${siteOf(root).name} 首页`}
						className="text-ink-strong flex items-center gap-2.5 font-bold"
					>
						<LogoMark className="size-7 shrink-0" />
						<span className={`text-heading ${collapsed ? COLLAPSED_HIDDEN : ''}`}>
							{siteOf(root).name}
						</span>
					</Link>
				</div>
				<div className={`shrink-0 px-3 pb-3 ${collapsed ? 'lg:max-xl:px-0' : ''}`}>
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
				<div className={`flex shrink-0 flex-col ${collapsed ? COLLAPSED_HIDDEN : ''}`}>
					<SiteFooterCompact />
				</div>
				<div className="border-line-soft shrink-0 border-t">
					<UserMenu
						meta={root?.meta ?? null}
						here={`${pathname}${location.search}`}
						variant="rail"
						collapsed={collapsed}
					/>
				</div>
			</aside>
			{stage.depth === 0 ? (
				// A page beside the column: one scrolling pane with a reading width, opening with its head.
				<div className="min-w-0 flex-1 px-4 py-5 lg:overflow-x-hidden lg:overflow-y-auto lg:px-10 lg:pt-0 lg:pb-8">
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
				className={`relative ${RAIL_ITEM} ${active ? RAIL_ITEM_ACTIVE : RAIL_ITEM_IDLE} ${collapsed ? RAIL_ITEM_COLLAPSED : ''}`}
			>
				<Icon
					aria-hidden
					size={16}
					className={active ? 'text-accent shrink-0' : 'text-ink-weak shrink-0'}
				/>
				<span className={`min-w-0 flex-1 truncate ${collapsed ? 'lg:max-xl:sr-only' : ''}`}>
					{label}
				</span>
				{badge !== undefined && badge > 0 && (
					<span
						className={`bg-accent text-page min-w-5 shrink-0 rounded-[2px] px-1 text-center text-micro leading-5 font-bold tabular-nums ${
							collapsed ? 'lg:max-xl:absolute lg:max-xl:top-1 lg:max-xl:right-1.5' : ''
						}`}
					>
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
	const meta = root?.meta
	// Staff reach the moderation page from the frame too, not only from the account menu.
	const moderationOn =
		meta != null &&
		(meta.viewer.roles.includes('moderator') || meta.viewer.roles.includes('admin')) &&
		meta.uiSlots.some((slot) => slot.extId === 'forum-moderation')
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
					label="概览"
					active={pathname === '/'}
					collapsed={collapsed}
				/>
				{notificationsOn && (
					<RailLink
						to="/notifications"
						icon={Bell}
						label="通知"
						active={pathname === '/notifications'}
						badge={root?.unreadNotifications}
						collapsed={collapsed}
					/>
				)}
				{moderationOn && (
					<RailLink
						to="/moderation"
						icon={ShieldCheck}
						label="审核"
						active={pathname === '/moderation'}
						collapsed={collapsed}
					/>
				)}
			</ul>
			<div
				className={`border-line-soft flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4 ${collapsed ? COLLAPSED_HIDDEN : ''}`}
			>
				<span className="section-label">版块 · {categories.length}</span>
				<div className="flex items-center gap-1">
					{canManageCategories && (
						<StageLink
							to="/?new=1"
							aria-label="新建版块"
							title="新建版块"
							className="text-ink-weak hover:bg-hover hover:text-ink-strong inline-flex size-control-sm items-center justify-center rounded-[2px]"
						>
							<Plus aria-hidden size={14} />
						</StageLink>
					)}
				</div>
			</div>
			<ul className="flex-1 overflow-y-auto py-2">
				{categories.length === 0 ? (
					<li className="text-ink-weak px-4 py-5 text-meta">还没有版块</li>
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
									className={`${RAIL_ITEM} ${isActive ? RAIL_ITEM_ACTIVE : RAIL_ITEM_IDLE} ${collapsed ? RAIL_ITEM_COLLAPSED : ''}`}
								>
									<Hash
										aria-hidden
										size={16}
										className={`shrink-0 ${isActive ? 'text-accent' : 'text-ink-weak'} ${collapsed ? COLLAPSED_HIDDEN : ''}`}
									/>
									{/* Icons only: every category would be the same 「#」, so each shows its first character. */}
									{collapsed && (
										<span
											aria-hidden
											className={`hidden size-6 shrink-0 items-center justify-center rounded-[2px] text-ui font-bold lg:max-xl:inline-flex ${
												isActive ? 'text-accent' : 'bg-control text-ink-strong'
											}`}
										>
											{Array.from(cat.name)[0] ?? '#'}
										</span>
									)}
									<span
										className={`min-w-0 flex-1 truncate ${collapsed ? 'lg:max-xl:sr-only' : ''}`}
									>
										{cat.name}
									</span>
									<span
										className={`text-ink-weak shrink-0 text-meta tabular-nums ${collapsed ? COLLAPSED_HIDDEN : ''}`}
									>
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
