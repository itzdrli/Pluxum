import type { CategoryDto } from '@pluxum/domain'
import { Hash, LayoutGrid, Plus } from 'lucide-react'
import { Outlet, useParams, useRouteLoaderData } from 'react-router'

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

const RAIL_ITEM = 'flex items-center gap-2.5 border-l-2 px-3 py-2 transition-colors'
const RAIL_ITEM_ACTIVE = 'border-l-accent bg-selected text-ink-strong font-bold'
const RAIL_ITEM_IDLE = 'text-ink hover:bg-hover hover:text-ink-strong border-l-transparent'

export const shouldRevalidate = stageShouldRevalidate

export default function ForumStage({ loaderData }: Route.ComponentProps) {
	const { categories } = loaderData
	const stage = useStage()
	const params = useParams()
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
					atHome={stage.depth === 0}
				/>
				<SiteFooterCompact />
			</aside>
			{stage.depth === 0 ? (
				// A page beside the column: one scrolling pane with a reading width.
				<div className="min-w-0 flex-1 px-4 py-4 lg:overflow-y-auto lg:px-8 lg:py-6">
					<div className="mx-auto w-full max-w-[1200px]">
						<Outlet />
					</div>
				</div>
			) : (
				<Outlet />
			)}
		</div>
	)
}

function CategoryNavPanel({
	categories,
	activeSlug,
	canManageCategories,
	atHome,
}: {
	categories: readonly CategoryDto[]
	activeSlug: string | undefined
	canManageCategories: boolean
	atHome: boolean
}) {
	return (
		<>
			<div className="border-line-soft flex h-11 shrink-0 items-center justify-between gap-2 border-b px-3">
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
			<ul className="flex-1 overflow-y-auto py-1.5">
				<li>
					<StageLink
						to="/"
						prefetch="intent"
						aria-current={atHome ? 'page' : undefined}
						className={`${RAIL_ITEM} ${atHome ? RAIL_ITEM_ACTIVE : RAIL_ITEM_IDLE}`}
					>
						<LayoutGrid
							aria-hidden
							size={14}
							className={atHome ? 'text-accent shrink-0' : 'text-ink-weak shrink-0'}
						/>
						<span className="min-w-0 flex-1 truncate">概览</span>
					</StageLink>
				</li>
				{categories.length === 0 ? (
					<li className="text-ink-weak px-3 py-4 text-meta">还没有版块</li>
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
										size={14}
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
