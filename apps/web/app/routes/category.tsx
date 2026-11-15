import { MessagesSquare, PenSquare } from 'lucide-react'
import { useRouteLoaderData } from 'react-router'

import type { Route } from './+types/category'
import { ThreadRow } from '../components/forum/rows'
import { ButtonAnchor, ButtonLink } from '../components/ui/button'
import { Crumbs, EmptyState, PageHeader, Panel, SectionLabel } from '../components/ui/display'
import { Pager } from '../components/ui/pager'
import { forumApi, orThrow, pageParam } from '../lib/forum-api.server'
import { keepOnThemeChange } from '../lib/revalidate'
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

export async function loader({ request, params }: Route.LoaderArgs) {
	return orThrow(await forumApi.categoryThreads(request, params.slug, pageParam(request)))
}

export const shouldRevalidate = keepOnThemeChange

export default function Category({ loaderData }: Route.ComponentProps) {
	const { category, threads, can } = loaderData
	const forum = useRouteLoaderData<typeof rootLoader>('root')?.meta
	const newThread = `/c/${category.slug}/new`
	// Guests who could log in are offered that instead of a missing button.
	const loginToPost =
		!can.createThread && forum?.viewer.user === null && forum.auth.loginAvailable
			? `/api/forum/auth/login?returnTo=${encodeURIComponent(newThread)}`
			: undefined
	const action = can.createThread ? (
		<ButtonLink to={newThread} tone="primary">
			<PenSquare aria-hidden />
			发布主题
		</ButtonLink>
	) : loginToPost !== undefined ? (
		<ButtonAnchor href={loginToPost}>登录后发布</ButtonAnchor>
	) : undefined
	return (
		<>
			<Crumbs items={[{ label: '版块', to: '/' }, { label: category.name }]} />
			<PageHeader title={category.name} description={category.description} actions={action} />
			<SectionLabel>主题 · {threads.total}</SectionLabel>
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
						<ThreadRow key={thread.id} thread={thread} />
					))}
				</Panel>
			)}
			<Pager page={threads.page} pageSize={threads.pageSize} total={threads.total} />
		</>
	)
}
