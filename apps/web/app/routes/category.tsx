import { msg } from '@lingui/core/macro'
import { MessagesSquare, Plus } from 'lucide-react'
import { useState } from 'react'
import { useRevalidator, useRouteLoaderData } from 'react-router'
import { useLingui } from '@lingui/react/macro'

import type { Route } from './+types/category'
import { NewActivityPrompt } from '../components/forum/new-activity'
import { NoteCard, NoteComposer } from '../components/forum/note-card'
import { ThreadRow } from '../components/forum/rows'
import { MobileCategoryBar } from '../components/shell/mobile-stage-bar'
import {
	FoldListButton,
	StageLink,
	StageSplit,
	useOpenThreadRef,
	useStageLinks,
	useStageNavigate,
} from '../components/stage/stage'
import { Button, ButtonAnchor, IconButton } from '../components/ui/button'
import { EmptyState, PageHeader, PaneBar, Panel } from '../components/ui/display'
import { Pager } from '../components/ui/pager'
import {
	activityLabelCount,
	listActivityPath,
	newestInstant,
	parseListActivity,
	useActivity,
} from '../lib/activity'
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
import { i18nOfRoot } from '../lib/i18n'
import { STREAM_LABEL } from '../lib/stream'
import { loginHref } from '../lib/login'

export const handle = defineStage({ layer: 'list', nav: true, backLabel: msg`返回列表` })

export function meta({ loaderData, matches }: Route.MetaArgs): Route.MetaDescriptors {
	const root = matches[0].loaderData
	if (!loaderData) return [{ title: pageTitle(root) }]
	const { category } = loaderData
	// The stream carries the interface's word for notes and no blurb of its own.
	const isStream = category.kind === 'stream'
	return [
		{ title: pageTitle(root, isStream ? i18nOfRoot(root)._(STREAM_LABEL) : category.name) },
		...(isStream || category.description === ''
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
	const { t, i18n } = useLingui()
	const { category, threads, can } = loaderData
	// The stream is built in: its name is the interface's word for notes, and it has no blurb.
	const isStream = category.kind === 'stream'
	const categoryName = isStream ? i18n._(STREAM_LABEL) : category.name
	const openRef = useOpenThreadRef()
	const { detail } = useStageLinks()
	const forum = useRouteLoaderData<typeof rootLoader>('root')?.meta
	const navigate = useStageNavigate()
	const newThread = `/c/${category.slug}/new`
	// The stream holds notes, written in the note box (here and on the home page), not the topic composer.
	const canCreate = can.createThread && !isStream
	const canPostNote = isStream && forum?.viewer.can.postNote === true
	const [fresh, setFresh] = useState<string | null>(null)
	// 「N 条新内容」 on the first page: what others wrote since the newest thread shown.
	const revalidator = useRevalidator()
	const { activity, dismiss: dismissActivity } = useActivity(
		threads.page === 1
			? listActivityPath(newestInstant(threads.items.map((item) => item.lastPostAt)), {
					category: category.slug,
				})
			: null,
		parseListActivity,
	)
	const newCount = activity === null ? '' : activityLabelCount(activity.count)
	const loadActivity = async () => {
		await revalidator.revalidate()
		dismissActivity()
	}

	// Guests who could log in are offered that instead of a missing button.
	const loginToPost =
		!can.createThread && !isStream && forum?.viewer.user === null && forum.auth.loginAvailable
			? loginHref(forum.auth, newThread)
			: undefined
	const action = (compact: boolean) =>
		canCreate && compact ? (
			// The narrow list's head has room for the icon only.
			<IconButton label={t`发布主题`} onPress={() => void navigate(newThread)}>
				<Plus aria-hidden />
			</IconButton>
		) : canCreate ? (
			<Button tone="primary" size={compact ? 'sm' : 'md'} onPress={() => void navigate(newThread)}>
				<Plus aria-hidden />
				{t`发布主题`}
			</Button>
		) : loginToPost !== undefined ? (
			<ButtonAnchor href={loginToPost} size={compact ? 'sm' : 'md'}>
				{t`登录后发布`}
			</ButtonAnchor>
		) : undefined

	return (
		<StageSplit label={t`${categoryName} 主题列表`} short={categoryName}>
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
								{categoryName}
							</StageLink>
							<span className="ml-auto flex shrink-0 items-center">
								{canCreate || loginToPost !== undefined ? action(true) : null}
								<FoldListButton />
							</span>
						</PaneBar>
					) : (
						<PageHeader
							title={categoryName}
							description={isStream ? '' : category.description}
							actions={<div className="max-lg:hidden">{action(false)}</div>}
						/>
					)}
					<CategoryHeaderSlots category={category} />
					{canPostNote && <NoteComposer max={forum?.limits.noteBodyMax} onPosted={setFresh} />}
					<NewActivityPrompt
						label={activity === null ? null : t`${newCount} 条新内容`}
						onLoad={loadActivity}
						reveal="top"
					/>
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
										fresh={thread.id === fresh}
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
