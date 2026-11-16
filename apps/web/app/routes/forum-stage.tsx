import type { CategoryDto } from '@pluxum/domain'
import { Bell, Hash, LayoutGrid, Plus, Search, type LucideIcon } from 'lucide-react'
import { Outlet, useLocation, useParams, useRouteLoaderData } from 'react-router'

import type { Route } from './+types/forum-stage'
import { SiteFooterCompact } from '../components/shell/site-footer'
import { RAIL_WIDTH, StageLink, useStage } from '../components/stage/stage'
import { forumApi, orThrow } from '../lib/forum-api.server'
import { stageShouldRevalidate } from '../lib/revalidate'
import type { loader as rootLoader } from '../root'

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

export const shouldRevalidate = stageShouldRevalidate

export default function ForumStage({ loaderData }: Route.ComponentProps) {
	const { categories } = loaderData
	const stage = useStage()
	const params = useParams()
	const pathname = useLocation().pathname
	const root = useRouteLoaderData<typeof rootLoader>('root')
	const canManageCategories = root?.meta?.viewer.can.manageCategories === true

	if (!stage.nav) return <Outlet />

	return (
		<div
			data-stage-depth={stage.depth}
			className="relative flex min-h-0 w-full flex-1 lg:overflow-hidden"
		>
			<aside
				aria-label="版块导航"
				className={`${RAIL_WIDTH} border-line-soft bg-sunken flex min-h-0 shrink-0 flex-col border-r [view-transition-name:stage-nav] max-lg:hidden`}
			>
				<CategoryNavPanel
					categories={categories}
					activeSlug={params.slug}
					canManageCategories={canManageCategories}
					pathname={pathname}
					root={root}
				/>
				<SiteFooterCompact />
			</aside>
			{stage.depth === 0 ? (
				// A page beside the column: one scrolling pane with a reading width.
				// The overview starts with a row of its own, level with the first rail row under the bar; the
				// other pages open with a title that keeps a little air above it.
				<div
					className={`min-w-0 flex-1 px-4 py-5 lg:overflow-y-auto lg:px-10 lg:pb-8 ${pathname === '/' ? 'lg:pt-0' : 'lg:pt-3'}`}
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

/** A destination of the frame: the overview, search, notifications. */
function RailLink({
	to,
	icon: Icon,
	label,
	active,
	badge,
}: {
	to: string
	icon: LucideIcon
	label: string
	active: boolean
	badge?: number
}) {
	return (
		<li>
			<StageLink
				to={to}
				prefetch="intent"
				aria-current={active ? 'page' : undefined}
				className={`${RAIL_ITEM} ${active ? RAIL_ITEM_ACTIVE : RAIL_ITEM_IDLE}`}
			>
				<Icon
					aria-hidden
					size={16}
					className={active ? 'text-accent shrink-0' : 'text-ink-weak shrink-0'}
				/>
				<span className="min-w-0 flex-1 truncate">{label}</span>
				{badge !== undefined && badge > 0 && (
					<span className="bg-accent text-page min-w-5 shrink-0 rounded-[2px] px-1 text-center text-micro leading-5 font-bold tabular-nums">
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
}: {
	categories: readonly CategoryDto[]
	activeSlug: string | undefined
	canManageCategories: boolean
	pathname: string
	root: ReturnType<typeof useRouteLoaderData<typeof rootLoader>>
}) {
	const meta = root?.meta
	const notificationsOn =
		meta?.viewer.user != null &&
		meta.uiSlots.some(
			(slot) => slot.slot === 'shell.actions' && slot.extId === 'forum-notifications',
		)
	return (
		<>
			<ul className="border-line-soft border-b pb-2">
				<RailLink to="/" icon={LayoutGrid} label="概览" active={pathname === '/'} />
				{meta?.search.available === true && (
					<RailLink
						to="/search"
						icon={Search}
						label="搜索"
						active={pathname === '/search' || pathname.startsWith('/search/')}
					/>
				)}
				{notificationsOn && (
					<RailLink
						to="/notifications"
						icon={Bell}
						label="通知"
						active={pathname === '/notifications'}
						badge={root?.unreadNotifications}
					/>
				)}
			</ul>
			<div className="border-line-soft flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4">
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
									className={`${RAIL_ITEM} ${isActive ? RAIL_ITEM_ACTIVE : RAIL_ITEM_IDLE}`}
								>
									<Hash
										aria-hidden
										size={16}
										className={isActive ? 'text-accent shrink-0' : 'text-ink-weak shrink-0'}
									/>
									<span className="min-w-0 flex-1 truncate">{cat.name}</span>
									<span className="text-ink-weak shrink-0 text-meta tabular-nums">
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
