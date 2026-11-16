import type { CategoryDto } from '@pluxum/domain'
import { Hash, Plus } from 'lucide-react'
import { Outlet, useParams, useRouteLoaderData } from 'react-router'

import type { Route } from './+types/forum-stage'
import { StageLink, useStage } from '../components/stage/stage'
import { forumApi, orThrow } from '../lib/forum-api.server'
import { stageShouldRevalidate } from '../lib/revalidate'
import type { loader as rootLoader } from '../root'

/**
 * The stage frame around every list and detail route. It owns the category navigation: a column
 * beside every list that asks for it, the same at depth 1 and 2, so opening or closing a detail
 * never moves it. Pages (depth 0) render as they are.
 */
export async function loader({ request }: Route.LoaderArgs) {
	return { categories: orThrow(await forumApi.categories(request)).items }
}

export const shouldRevalidate = stageShouldRevalidate

export default function ForumStage({ loaderData }: Route.ComponentProps) {
	const { categories } = loaderData
	const stage = useStage()
	const params = useParams()
	const root = useRouteLoaderData<typeof rootLoader>('root')
	const canManageCategories = root?.meta?.viewer.can.manageCategories === true

	if (stage.depth === 0) return <Outlet />

	return (
		<div
			data-stage-depth={stage.depth}
			className="relative mx-auto flex min-h-0 w-full max-w-[1760px] flex-1 lg:overflow-hidden"
		>
			{stage.nav && (
				<aside
					aria-label="版块导航"
					className="border-line bg-panel flex min-h-0 w-[220px] shrink-0 flex-col border-r [view-transition-name:stage-nav] max-lg:hidden xl:w-[260px] 2xl:w-[288px]"
				>
					<CategoryNavPanel
						categories={categories}
						activeSlug={params.slug}
						canManageCategories={canManageCategories}
					/>
				</aside>
			)}
			<Outlet />
		</div>
	)
}

function CategoryNavPanel({
	categories,
	activeSlug,
	canManageCategories,
}: {
	categories: readonly CategoryDto[]
	activeSlug: string | undefined
	canManageCategories: boolean
}) {
	return (
		<>
			<div className="border-line flex h-11 shrink-0 items-center justify-between gap-2 border-b px-3">
				<span className="section-label">版块 · {categories.length}</span>
				<div className="flex items-center gap-1">
					{canManageCategories && (
						<StageLink
							to="/?new=1"
							aria-label="新建版块"
							title="新建版块"
							className="text-ink-weak hover:bg-hover hover:text-ink-strong inline-flex size-7 items-center justify-center rounded-[2px]"
						>
							<Plus aria-hidden size={14} />
						</StageLink>
					)}
				</div>
			</div>
			<ul className="flex-1 overflow-y-auto py-1.5">
				{categories.length === 0 ? (
					<li className="text-ink-weak px-3 py-4 text-[12px]">还没有版块</li>
				) : (
					categories.map((cat) => {
						const isActive = cat.slug === activeSlug
						return (
							<li key={cat.id}>
								<StageLink
									to={`/c/${cat.slug}`}
									prefetch="intent"
									aria-current={isActive ? 'page' : undefined}
									className={`flex items-center gap-2.5 border-l-2 px-3 py-2 transition-colors ${
										isActive
											? 'border-l-accent bg-selected text-ink-strong font-bold'
											: 'text-ink hover:bg-hover hover:text-ink-strong border-l-transparent'
									}`}
								>
									<Hash
										aria-hidden
										size={14}
										className={isActive ? 'text-accent shrink-0' : 'text-ink-weak shrink-0'}
									/>
									<span className="min-w-0 flex-1 truncate">{cat.name}</span>
									<span className="text-ink-weak shrink-0 text-[12px] tabular-nums">
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
