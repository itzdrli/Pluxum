import { msg } from '@lingui/core/macro'
import { MessagesSquare, Plus } from 'lucide-react'
import { useRouteLoaderData } from 'react-router'
import { useLingui } from '@lingui/react/macro'

import type { Route } from './+types/category'
import { NoteCard } from '../components/forum/note-card'
import { ThreadRow } from '../components/forum/rows'
import { MobileCategoryBar } from '../components/shell/mobile-stage-bar'
import {
	FoldListButton,
	StageLink,
	StageSplit,
	useOpenThreadRef,
	useStageLinks,
} from '../components/stage/stage'
import { useDock } from '../components/dock/composer-dock'
import { Button, ButtonAnchor, IconButton } from '../components/ui/button'
import { EmptyState, PageHeader, PaneBar, Panel } from '../components/ui/display'
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
import { CategoryHeaderSlots } from '../slots/slots'
import { pageTitle } from '../lib/site'

export const handle = defineStage({ layer: 'list', nav: true, backLabel: msg`返回列表` })

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
	const { t } = useLingui()
	const { category, threads, can } = loaderData
	const categoryName = category.name
	const openRef = useOpenThreadRef()
	const { detail } = useStageLinks()
	const forum = useRouteLoaderData<typeof rootLoader>('root')?.meta
	const dock = useDock()
	const newThread = `/c/${category.slug}/new`
	// The stream holds notes, which are posted from the home page's box, not the topic composer.
	const isStream = category.kind === 'stream'
	const canCreate = can.createThread && !isStream

	// Guests who could log in are offered that instead of a missing button.
	const loginToPost =
		!can.createThread && !isStream && forum?.viewer.user === null && forum.auth.loginAvailable
			? `/api/forum/auth/login?returnTo=${encodeURIComponent(newThread)}`
			: undefined
	const action = (compact: boolean) =>
		canCreate && compact ? (
			// The narrow list's head has room for the icon only.
			<IconButton label={t`发布主题`} onPress={() => dock.openThread(category.slug)}>
				<Plus aria-hidden />
			</IconButton>
		) : canCreate ? (
			<Button
				tone="primary"
				size={compact ? 'sm' : 'md'}
				onPress={() => dock.openThread(category.slug)}
			>
				<Plus aria-hidden />
				{t`发布主题`}
			</Button>
		) : loginToPost !== undefined ? (
			<ButtonAnchor href={loginToPost} size={compact ? 'sm' : 'md'}>
				{t`登录后发布`}
			</ButtonAnchor>
		) : undefined

	return (
		<StageSplit label={t`${categoryName} 主题列表`} short={category.name}>
			{(detailOpen) => (
				<>
					{detailOpen ? (
						// The list's head beside a detail (wide screens only: phones show the detail alone).
						<PaneBar className="gap-2!">
							<StageLink
								to={`/c/${category.slug}`}
								prefetch="intent"
								className="text-ink-strong hover:text-accent min-w-0 truncate text-heading font-bold"
							>
								{category.name}
							</StageLink>
							<span className="ml-auto flex shrink-0 items-center">
								{canCreate || loginToPost !== undefined ? action(true) : null}
								<FoldListButton />
							</span>
						</PaneBar>
					) : (
						<PageHeader
							title={category.name}
							description={category.description}
							actions={<div className="max-lg:hidden">{action(false)}</div>}
						/>
					)}
					<CategoryHeaderSlots category={category} />
					{threads.items.length === 0 ? (
						<EmptyState
							icon={MessagesSquare}
							title={
								threads.total > 0
									? t`这一页没有内容`
									: isStream
										? t`还没有动态`
										: t`这个版块还没有主题`
							}
							hint={threads.total === 0 && canCreate ? t`来发布第一个主题吧。` : undefined}
							action={threads.total === 0 ? action(detailOpen) : undefined}
						/>
					) : (
						<Panel
							as="ul"
							className="divide-line divide-y max-lg:-mx-4 max-lg:rounded-none max-lg:border-x-0"
						>
							{threads.items.map((thread) =>
								thread.kind === 'note' ? (
									<NoteCard
										key={thread.id}
										thread={thread}
										href={detail(thread.ref)}
										isActive={thread.ref === openRef || thread.id === openRef}
									/>
								) : (
									<ThreadRow
										key={thread.id}
										thread={thread}
										href={detail(thread.ref)}
										isActive={thread.ref === openRef || thread.id === openRef}
									/>
								),
							)}
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
							canCreateThread={canCreate}
							loginToPost={loginToPost}
						/>
					)}
				</>
			)}
		</StageSplit>
	)
}
