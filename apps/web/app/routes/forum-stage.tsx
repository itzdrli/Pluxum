import type { CategoryDto } from '@forum/domain'
import { Hash, PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation, useParams, useRouteLoaderData } from 'react-router'

import type { Route } from './+types/forum-stage'
import { forumApi, orThrow } from '../lib/forum-api.server'
import { stageShouldRevalidate } from '../lib/revalidate'
import type { loader as rootLoader } from '../root'

export type StageDepth = 0 | 1 | 2

export async function loader({ request }: Route.LoaderArgs) {
	return { categories: orThrow(await forumApi.categories(request)).items }
}

export const shouldRevalidate = stageShouldRevalidate

export function computeStageDepth(
	params: Readonly<{ slug?: string; id?: string }>,
	pathname: string,
): StageDepth {
	if (params.slug === undefined) return 0
	if (params.id !== undefined || /\/new\/?$/.test(pathname)) return 2
	return 1
}

export default function ForumStage({ loaderData }: Route.ComponentProps) {
	const { categories } = loaderData
	const params = useParams()
	const location = useLocation()
	const root = useRouteLoaderData<typeof rootLoader>('root')
	const canManageCategories = root?.meta?.viewer.can.manageCategories === true

	const depth = computeStageDepth(params, location.pathname)

	const [drawerOpen, setDrawerOpen] = useState(false)
	const [lastPath, setLastPath] = useState(location.pathname)
	if (lastPath !== location.pathname) {
		setLastPath(location.pathname)
		if (drawerOpen) setDrawerOpen(false)
	}

	useEffect(() => {
		if (!drawerOpen) return undefined
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && !event.defaultPrevented) {
				event.preventDefault()
				setDrawerOpen(false)
			}
		}
		window.addEventListener('keydown', onKeyDown, { capture: true })
		return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
	}, [drawerOpen])

	if (depth === 0) {
		return <Outlet />
	}

	return (
		<div
			data-stage-depth={depth}
			className="relative mx-auto flex min-h-0 w-full max-w-[1760px] flex-1 max-lg:pb-[calc(4.25rem+env(safe-area-inset-bottom))] lg:overflow-hidden"
		>
			{depth === 1 ? (
				<aside
					aria-label="版块导航"
					className="border-line bg-panel flex min-h-0 w-[260px] shrink-0 flex-col border-r max-lg:hidden xl:w-[288px]"
				>
					<CategoryNavPanel
						categories={categories}
						activeSlug={params.slug}
						canManageCategories={canManageCategories}
					/>
				</aside>
			) : (
				<div
					className={`relative z-30 w-[76px] shrink-0 select-none max-lg:hidden xl:w-[92px]${drawerOpen ? '' : ' group/peek'}`}
				>
					{!drawerOpen ? (
						<>
							<div
								aria-hidden
								style={{
									maskImage: 'linear-gradient(to right, rgb(0 0 0 / 0.45), #000 55%)',
								}}
								className="border-line bg-panel pointer-events-none absolute inset-y-2 left-0 flex w-[260px] origin-left translate-x-[-73%] scale-[0.95] flex-col overflow-hidden rounded-[2px] border opacity-45 transition-[transform,opacity] duration-200 ease-out group-focus-within/peek:translate-x-[-50%] group-focus-within/peek:scale-[0.97] group-focus-within/peek:opacity-80 group-hover/peek:translate-x-[-50%] group-hover/peek:scale-[0.97] group-hover/peek:opacity-80 xl:w-[288px] xl:translate-x-[-70%] xl:group-focus-within/peek:translate-x-[-50%] xl:group-hover/peek:translate-x-[-50%]"
							>
								<CategoryNavPanel
									categories={categories}
									activeSlug={params.slug}
									canManageCategories={canManageCategories}
									inert
								/>
							</div>
							<button
								type="button"
								onClick={() => setDrawerOpen(true)}
								aria-label="展开版块列表快速切换"
								title="展开版块列表"
								className="absolute inset-0 z-20 flex cursor-pointer items-center justify-end pr-2"
							>
								<span className="border-line bg-panel text-ink-weak group-focus-visible/peek:border-accent group-focus-visible/peek:text-ink-strong group-focus-within/peek:border-accent group-focus-within/peek:text-ink-strong group-hover/peek:border-accent group-hover/peek:text-ink-strong flex flex-col items-center gap-1.5 rounded-[2px] border px-1.5 py-2.5 transition-colors">
									<PanelLeftOpen aria-hidden size={14} />
									<span className="bg-line group-focus-visible/peek:bg-accent group-focus-within/peek:bg-accent group-hover/peek:bg-accent h-5 w-0.5 rounded-[2px] transition-colors" />
								</span>
							</button>
						</>
					) : (
						<>
							<div
								aria-hidden
								onClick={() => setDrawerOpen(false)}
								className="bg-page/55 fixed inset-0 z-20"
							/>
							<aside
								aria-label="版块切换抽屉"
								className="border-line bg-panel shadow-overlay absolute inset-y-2 left-2 z-30 flex w-[272px] translate-x-0 scale-100 flex-col overflow-hidden rounded-[2px] border opacity-100 xl:w-[296px]"
							>
								<CategoryNavPanel
									categories={categories}
									activeSlug={params.slug}
									canManageCategories={canManageCategories}
									onSelectCategory={() => setDrawerOpen(false)}
									onCloseDrawer={() => setDrawerOpen(false)}
								/>
							</aside>
						</>
					)}
				</div>
			)}
			<Outlet />
		</div>
	)
}

function CategoryNavPanel({
	categories,
	activeSlug,
	canManageCategories,
	inert,
	onSelectCategory,
	onCloseDrawer,
}: {
	categories: readonly CategoryDto[]
	activeSlug: string | undefined
	canManageCategories: boolean
	inert?: boolean
	onSelectCategory?: () => void
	onCloseDrawer?: () => void
}) {
	return (
		<>
			<div className="border-line flex h-11 shrink-0 items-center justify-between gap-2 border-b px-3">
				<span className="section-label">版块 · {categories.length}</span>
				<div className="flex items-center gap-1">
					{canManageCategories && (
						<Link
							to="/?new=1"
							tabIndex={inert ? -1 : undefined}
							onClick={onSelectCategory}
							aria-label="新建版块"
							title="新建版块"
							className="text-ink-weak hover:bg-hover hover:text-ink-strong inline-flex size-7 items-center justify-center rounded-[2px]"
						>
							<Plus aria-hidden size={14} />
						</Link>
					)}
					{onCloseDrawer !== undefined && (
						<button
							type="button"
							onClick={onCloseDrawer}
							aria-label="收起版块列表"
							title="收起版块列表"
							className="text-ink-weak hover:bg-hover hover:text-ink-strong inline-flex size-7 cursor-pointer items-center justify-center rounded-[2px]"
						>
							<PanelLeftClose aria-hidden size={14} />
						</button>
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
								<Link
									to={`/c/${cat.slug}`}
									prefetch="intent"
									tabIndex={inert ? -1 : undefined}
									onClick={onSelectCategory}
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
								</Link>
							</li>
						)
					})
				)}
			</ul>
		</>
	)
}
