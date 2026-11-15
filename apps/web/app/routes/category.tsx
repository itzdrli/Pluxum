import { MessagesSquare, PenSquare } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link, Outlet, useLocation, useParams, useRouteLoaderData } from 'react-router'

import type { Route } from './+types/category'
import { ThreadRow } from '../components/forum/rows'
import { MobileCategoryBar } from '../components/shell/mobile-stage-bar'
import { ButtonAnchor, ButtonLink } from '../components/ui/button'
import { Crumbs, EmptyState, PageHeader, Panel, SectionLabel } from '../components/ui/display'
import { Pager } from '../components/ui/pager'
import { forumApi, orThrow, pageParam } from '../lib/forum-api.server'
import { categoryStageShouldRevalidate } from '../lib/revalidate'
import type { loader as rootLoader } from '../root'

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
	if (!loaderData) return [{ title: 'Pluxel Forum' }]
	const { category } = loaderData
	return [
		{ title: `${category.name} · Pluxel Forum` },
		...(category.description === ''
			? []
			: [{ name: 'description', content: category.description }]),
	]
}

function isDetailPath(pathname: string): boolean {
	return /\/(?:t\/[^/]+|new)\/?$/.test(pathname)
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const url = new URL(request.url)
	const page = url.searchParams.has('cpage')
		? pageParam(request, 'cpage')
		: !isDetailPath(url.pathname)
			? pageParam(request, 'page')
			: 1
	return orThrow(await forumApi.categoryThreads(request, params.slug, page))
}

export const shouldRevalidate = categoryStageShouldRevalidate

export default function Category({ loaderData }: Route.ComponentProps) {
	const { category, threads, can } = loaderData
	const params = useParams()
	const location = useLocation()
	const forum = useRouteLoaderData<typeof rootLoader>('root')?.meta
	const newThread = `/c/${category.slug}/new`

	const activeThreadId = params.id
	const isCreatingThread = /\/new\/?$/.test(location.pathname)
	const hasDetailPane = activeThreadId !== undefined || isCreatingThread
	const threadPage = new URLSearchParams(location.search).get('page') ?? '1'

	const listPaneRef = useRef<HTMLElement>(null)
	useEffect(() => {
		if (category.slug !== '' && threads.page >= 1) {
			listPaneRef.current?.scrollTo({ top: 0 })
		}
	}, [category.slug, threads.page])

	const detailPaneRef = useRef<HTMLDivElement>(null)
	useEffect(() => {
		if (
			(activeThreadId === undefined && !isCreatingThread) ||
			threadPage === '' ||
			location.hash.startsWith('#post-')
		) {
			return
		}
		detailPaneRef.current?.scrollTo({ top: 0 })
	}, [activeThreadId, isCreatingThread, threadPage, location.hash])

	// Guests who could log in are offered that instead of a missing button.
	const loginToPost =
		!can.createThread && forum?.viewer.user === null && forum.auth.loginAvailable
			? `/api/forum/auth/login?returnTo=${encodeURIComponent(newThread)}`
			: undefined
	const action = can.createThread ? (
		<ButtonLink to={newThread} prefetch="intent" tone="primary" size={hasDetailPane ? 'sm' : 'md'}>
			<PenSquare aria-hidden />
			发布主题
		</ButtonLink>
	) : loginToPost !== undefined ? (
		<ButtonAnchor href={loginToPost} size={hasDetailPane ? 'sm' : 'md'}>
			登录后发布
		</ButtonAnchor>
	) : undefined

	const pane2Class = hasDetailPane
		? 'border-line bg-panel/35 w-[310px] shrink-0 border-r px-3 py-4 max-lg:hidden lg:overflow-y-auto xl:w-[360px] 2xl:w-[400px]'
		: 'min-w-0 flex-1 px-4 py-5 lg:overflow-y-auto lg:px-8'

	return (
		<div className="flex min-h-0 w-full flex-1 lg:overflow-hidden">
			<section ref={listPaneRef} aria-label={`${category.name} 主题列表`} className={pane2Class}>
				<div
					className={
						hasDetailPane ? '@container/threads' : '@container/threads mx-auto max-w-[1040px]'
					}
				>
					{hasDetailPane ? (
						<header className="mb-3 flex items-center justify-between gap-2">
							<div className="min-w-0">
								<Link
									to={`/c/${category.slug}`}
									prefetch="intent"
									className="text-ink-strong hover:text-accent block truncate text-[15px] font-bold"
								>
									{category.name}
								</Link>
								<p className="text-ink-weak text-[12px] tabular-nums">{threads.total} 主题</p>
							</div>
							{action !== undefined && <div className="shrink-0">{action}</div>}
						</header>
					) : (
						<>
							<Crumbs items={[{ label: '版块', to: '/' }, { label: category.name }]} />
							<PageHeader
								title={category.name}
								description={category.description}
								actions={action}
							/>
							<SectionLabel>主题 · {threads.total}</SectionLabel>
						</>
					)}
					{threads.items.length === 0 ? (
						<EmptyState
							icon={MessagesSquare}
							title={threads.total === 0 ? '这个版块还没有主题' : '这一页没有内容'}
							hint={threads.total === 0 && can.createThread ? '来发布第一个主题吧。' : undefined}
							action={threads.total === 0 ? action : undefined}
						/>
					) : (
						<Panel as="ul" className="divide-line divide-y">
							{threads.items.map((thread) => (
								<ThreadRow
									key={thread.id}
									thread={thread}
									categorySlug={category.slug}
									categoryPage={threads.page}
									isActive={thread.id === activeThreadId}
								/>
							))}
						</Panel>
					)}
					<Pager
						page={threads.page}
						pageSize={threads.pageSize}
						total={threads.total}
						paramName="cpage"
					/>
				</div>
			</section>

			{hasDetailPane ? (
				<div
					ref={detailPaneRef}
					className="bg-page min-w-0 flex-1 px-4 py-5 lg:overflow-y-auto lg:px-8"
				>
					<Outlet />
				</div>
			) : (
				<MobileCategoryBar
					category={category}
					canCreateThread={can.createThread}
					loginToPost={loginToPost}
				/>
			)}
		</div>
	)
}
