import { Chip } from '@heroui/react'
import { Link } from 'react-router'

import type { Route } from './+types/category'
import { ButtonLink, Crumbs, Pager, Timestamp } from '../components/ui'
import { forumApi, orThrow, pageParam } from '../lib/forum-api.server'

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

export default function Category({ loaderData }: Route.ComponentProps) {
	const { category, threads, can } = loaderData
	return (
		<>
			<Crumbs items={[{ label: '版块', to: '/' }, { label: category.name }]} />
			<div className="mb-4 flex items-start justify-between gap-4">
				<div className="min-w-0">
					<h1 className="text-xl font-bold break-words">{category.name}</h1>
					{category.description !== '' && (
						<p className="text-muted mt-1 text-sm break-words">{category.description}</p>
					)}
				</div>
				{can.createThread && <ButtonLink to={`/c/${category.slug}/new`}>发布主题</ButtonLink>}
			</div>
			{threads.items.length === 0 ? (
				<p className="border-border text-muted rounded-xl border px-5 py-10 text-center text-sm">
					{threads.total === 0 ? '这个版块还没有主题。' : '这一页没有内容。'}
				</p>
			) : (
				<ul className="border-border bg-surface divide-border divide-y rounded-xl border">
					{threads.items.map((thread) => (
						<li key={thread.id} className="flex items-center gap-4 px-5 py-3">
							<div className="min-w-0 flex-1">
								<div className="flex flex-wrap items-center gap-2">
									{thread.pinned && (
										<Chip size="sm" color="accent">
											置顶
										</Chip>
									)}
									{thread.locked && <Chip size="sm">已锁定</Chip>}
									<Link
										to={`/t/${thread.id}`}
										className="hover:text-accent font-medium break-words"
									>
										{thread.title}
									</Link>
								</div>
								<p className="text-muted mt-1 text-xs">
									{thread.author.displayName} · <Timestamp iso={thread.createdAt} />
								</p>
							</div>
							<div className="text-muted shrink-0 text-right text-xs">
								<p>
									<span className="text-foreground text-sm tabular-nums">{thread.replyCount}</span>{' '}
									回复
								</p>
								<p className="mt-1">
									<Timestamp iso={thread.lastPostAt} />
								</p>
							</div>
						</li>
					))}
				</ul>
			)}
			<Pager page={threads.page} pageSize={threads.pageSize} total={threads.total} />
		</>
	)
}
