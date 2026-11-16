import { MessagesSquare, Plus } from 'lucide-react'
import { useParams, useRouteLoaderData } from 'react-router'

import type { Route } from './+types/category'
import { ThreadRow } from '../components/forum/rows'
import { MobileCategoryBar } from '../components/shell/mobile-stage-bar'
import { StageLink, StageSplit, useStageLinks } from '../components/stage/stage'
import { ButtonAnchor, ButtonLink } from '../components/ui/button'
import { Crumbs, EmptyState, PageHeader, Panel, SectionLabel } from '../components/ui/display'
import { Pager } from '../components/ui/pager'
import { forumApi, orThrow } from '../lib/forum-api.server'
import {
	defineStage,
	isDetailPath,
	LIST_PAGE_PARAM,
	listPageOf,
	listShouldRevalidate,
} from '../lib/stage'
import type { loader as rootLoader } from '../root'
import { pageTitle } from '../lib/site'

export const handle = defineStage({ layer: 'list', nav: true, backLabel: '列表' })

export function meta({ loaderData, matches }: Route.MetaArgs): Route.MetaDescriptors {
	const root = matches[0].loaderData
	if (!loaderData) return [{ title: pageTitle(root) }]
	const { category } = loaderData
	return [
		{ title: pageTitle(root, category.name) },
		...(category.description === ''
			? []
			: [{ name: 'description', content: category.description }]),
	]
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const url = new URL(request.url)
	return orThrow(
		await forumApi.categoryThreads(
			request,
			params.slug,
			listPageOf(url, isDetailPath(url.pathname)),
		),
	)
}

// Switching or paginating threads inside the same category page keeps the thread list.
export const shouldRevalidate = listShouldRevalidate()

export default function Category({ loaderData }: Route.ComponentProps) {
	const { category, threads, can } = loaderData
	const params = useParams()
	const { detail } = useStageLinks()
	const forum = useRouteLoaderData<typeof rootLoader>('root')?.meta
	const newThread = `/c/${category.slug}/new`

	// Guests who could log in are offered that instead of a missing button.
	const loginToPost =
		!can.createThread && forum?.viewer.user === null && forum.auth.loginAvailable
			? `/api/forum/auth/login?returnTo=${encodeURIComponent(newThread)}`
			: undefined
	const action = (compact: boolean) =>
		can.createThread ? (
			<ButtonLink to={newThread} prefetch="intent" tone="primary" size={compact ? 'sm' : 'md'}>
				<Plus aria-hidden />
				发布主题
			</ButtonLink>
		) : loginToPost !== undefined ? (
			<ButtonAnchor href={loginToPost} size={compact ? 'sm' : 'md'}>
				登录后发布
			</ButtonAnchor>
		) : undefined

	return (
		<StageSplit label={`${category.name} 主题列表`}>
			{(detailOpen) => (
				<>
					{detailOpen ? (
						<header className="mb-3 flex items-center justify-between gap-2">
							<div className="min-w-0">
								<StageLink
									to={`/c/${category.slug}`}
									prefetch="intent"
									className="text-ink-strong hover:text-accent block truncate text-heading font-bold"
								>
									{category.name}
								</StageLink>
								<p className="text-ink-weak text-meta tabular-nums">{threads.total} 主题</p>
							</div>
							{can.createThread || loginToPost !== undefined ? (
								<div className="shrink-0">{action(true)}</div>
							) : null}
						</header>
					) : (
						<>
							{/* Phones have the way back and the post button in the bottom bar. */}
							<div className="max-lg:hidden">
								<Crumbs items={[{ label: '版块', to: '/' }]} />
							</div>
							<PageHeader
								title={category.name}
								description={category.description}
								actions={<div className="max-lg:hidden">{action(false)}</div>}
							/>
							<div className="max-lg:hidden">
								<SectionLabel>主题 · {threads.total}</SectionLabel>
							</div>
						</>
					)}
					{threads.items.length === 0 ? (
						<EmptyState
							icon={MessagesSquare}
							title={threads.total === 0 ? '这个版块还没有主题' : '这一页没有内容'}
							hint={threads.total === 0 && can.createThread ? '来发布第一个主题吧。' : undefined}
							action={threads.total === 0 ? action(detailOpen) : undefined}
						/>
					) : (
						<Panel
							as="ul"
							className="divide-line divide-y max-lg:-mx-4 max-lg:rounded-none max-lg:border-x-0"
						>
							{threads.items.map((thread) => (
								<ThreadRow
									key={thread.id}
									thread={thread}
									href={detail(thread.ref)}
									isActive={thread.ref === params.id || thread.id === params.id}
								/>
							))}
						</Panel>
					)}
					<Pager
						page={threads.page}
						pageSize={threads.pageSize}
						total={threads.total}
						paramName={LIST_PAGE_PARAM}
					/>
					{!detailOpen && (
						<MobileCategoryBar
							category={category}
							canCreateThread={can.createThread}
							loginToPost={loginToPost}
						/>
					)}
				</>
			)}
		</StageSplit>
	)
}
