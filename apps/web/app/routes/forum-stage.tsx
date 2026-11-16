import type { CategoryDto } from '@pluxum/domain'
import { Hash, PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useParams, useRouteLoaderData } from 'react-router'

import type { Route } from './+types/forum-stage'
import { StageLink, useStage } from '../components/stage/stage'
import { forumApi, orThrow } from '../lib/forum-api.server'
import { stageShouldRevalidate } from '../lib/revalidate'
import type { loader as rootLoader } from '../root'

/**
 * The stage frame around every list and detail route. It owns the category navigation: a column
 * beside a list that asks for it (depth 1), and the peek strip / drawer next to a detail (depth 2).
 * Pages (depth 0) render as they are.
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

	const navProps = { categories, activeSlug: params.slug, canManageCategories }
	return (
		<div
			data-stage-depth={stage.depth}
			className="relative mx-auto flex min-h-0 w-full max-w-[1760px] flex-1 lg:overflow-hidden"
		>
			{stage.nav &&
				(stage.depth === 1 ? (
					<aside
						aria-label="版块导航"
						className="border-line bg-panel flex min-h-0 w-[260px] shrink-0 flex-col border-r [view-transition-name:stage-nav] max-lg:hidden xl:w-[288px]"
					>
						<CategoryNavPanel {...navProps} />
					</aside>
				) : (
					<CategoryPeekDrawer {...navProps} />
				))}
			<Outlet />
		</div>
	)
}

type NavProps = {
	categories: readonly CategoryDto[]
	activeSlug: string | undefined
	canManageCategories: boolean
}

/**
 * Depth 2: the category column folds into a strip at the left edge that peeks out on hover and
 * opens as a drawer. The panel stays mounted in all three states so every change between them is
 * one continuous transition (see `.stage-peek` in app.css) instead of a remount.
 */
function CategoryPeekDrawer(props: NavProps) {
	const location = useLocation()
	const [open, setOpen] = useState(false)
	const [lastPath, setLastPath] = useState(location.pathname)
	if (lastPath !== location.pathname) {
		setLastPath(location.pathname)
		if (open) setOpen(false)
	}

	const triggerRef = useRef<HTMLButtonElement>(null)
	const panelRef = useRef<HTMLElement>(null)
	const wasOpen = useRef(false)
	useEffect(() => {
		if (open) {
			panelRef.current
				?.querySelector<HTMLElement>('[aria-current="page"], a, button')
				?.focus({ preventScroll: true })
		} else if (wasOpen.current && panelRef.current?.contains(document.activeElement)) {
			triggerRef.current?.focus({ preventScroll: true })
		}
		wasOpen.current = open
	}, [open])

	useEffect(() => {
		if (!open) return undefined
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && !event.defaultPrevented) {
				event.preventDefault()
				setOpen(false)
			}
		}
		window.addEventListener('keydown', onKeyDown, { capture: true })
		return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
	}, [open])

	const state = open ? { 'data-open': '' } : {}
	return (
		<div className="stage-peek-slot relative z-30 w-[76px] shrink-0 select-none max-lg:hidden xl:w-[92px]">
			<div
				aria-hidden
				onClick={() => setOpen(false)}
				className="stage-peek-backdrop bg-page/55 fixed inset-0"
				{...state}
			/>
			<button
				ref={triggerRef}
				type="button"
				onClick={() => setOpen(true)}
				aria-label="展开版块列表快速切换"
				aria-expanded={open}
				title="展开版块列表"
				tabIndex={open ? -1 : undefined}
				className="stage-peek-trigger absolute inset-0 z-20 flex cursor-pointer items-center justify-end pr-2"
				{...state}
			>
				<span className="stage-peek-handle border-line bg-panel text-ink-weak flex flex-col items-center gap-1.5 rounded-[2px] border px-1.5 py-2.5">
					<PanelLeftOpen aria-hidden size={14} />
					<span className="stage-peek-grip bg-line h-5 w-0.5 rounded-[2px]" />
				</span>
			</button>
			<aside
				ref={panelRef}
				aria-label="版块切换抽屉"
				aria-hidden={!open}
				inert={!open}
				className="stage-peek border-line bg-panel absolute inset-y-2 left-2 z-30 flex w-[272px] flex-col overflow-hidden rounded-[2px] border [view-transition-name:stage-nav] xl:w-[296px]"
				{...state}
			>
				<CategoryNavPanel
					{...props}
					onSelectCategory={() => setOpen(false)}
					onCloseDrawer={() => setOpen(false)}
				/>
			</aside>
		</div>
	)
}

function CategoryNavPanel({
	categories,
	activeSlug,
	canManageCategories,
	onSelectCategory,
	onCloseDrawer,
}: NavProps & {
	onSelectCategory?: () => void
	onCloseDrawer?: () => void
}) {
	return (
		<>
			<div className="border-line flex h-11 shrink-0 items-center justify-between gap-2 border-b px-3">
				<span className="section-label">版块 · {categories.length}</span>
				<div className="flex items-center gap-1">
					{canManageCategories && (
						<StageLink
							to="/?new=1"
							onClick={onSelectCategory}
							aria-label="新建版块"
							title="新建版块"
							className="text-ink-weak hover:bg-hover hover:text-ink-strong inline-flex size-7 items-center justify-center rounded-[2px]"
						>
							<Plus aria-hidden size={14} />
						</StageLink>
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
								<StageLink
									to={`/c/${cat.slug}`}
									prefetch="intent"
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
								</StageLink>
							</li>
						)
					})
				)}
			</ul>
		</>
	)
}
