import type { PostDto } from '@forum/domain'
import { Button, Chip, Label, TextArea, TextField } from '@heroui/react'
import { data, Form, redirect, useNavigation, useRouteLoaderData } from 'react-router'

import type { Route } from './+types/thread'
import { Crumbs, FormError, Pager, Timestamp } from '../components/ui'
import { pageCount } from '../lib/format'
import { forumApi, orThrow, pageParam, textField } from '../lib/forum-api.server'
import type { loader as rootLoader } from '../root'

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: `${loaderData ? `${loaderData.thread.title} · ` : ''}Pluxel Forum` }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
	return orThrow(await forumApi.thread(request, params.id, pageParam(request)))
}

// Posts a reply, then lands on the page that now holds it.
export async function action({ request, params }: Route.ActionArgs) {
	const form = await request.formData()
	const result = await forumApi.createPost(request, params.id, textField(form, 'body'))
	if (!result.ok) return data({ error: result.error.message }, { status: result.status })
	const { posts } = orThrow(await forumApi.thread(request, params.id))
	const last = pageCount(posts.total, posts.pageSize)
	return redirect(`/t/${params.id}${last > 1 ? `?page=${last}` : ''}#post-${result.value.id}`)
}

export default function Thread({ loaderData, actionData }: Route.ComponentProps) {
	const { thread, category, posts, can } = loaderData
	const firstNumber = (posts.page - 1) * posts.pageSize + 1
	return (
		<>
			<Crumbs
				items={[
					{ label: '版块', to: '/' },
					{ label: category.name, to: `/c/${category.slug}` },
					{ label: thread.title },
				]}
			/>
			<div className="mb-4">
				<h1 className="text-xl font-bold break-words">{thread.title}</h1>
				<div className="text-muted mt-2 flex flex-wrap items-center gap-2 text-xs">
					{thread.pinned && (
						<Chip size="sm" color="accent">
							置顶
						</Chip>
					)}
					{thread.locked && <Chip size="sm">已锁定</Chip>}
					<span>{thread.replyCount} 回复</span>
				</div>
			</div>
			{posts.items.length === 0 ? (
				<p className="border-border text-muted rounded-xl border px-5 py-10 text-center text-sm">
					这一页没有内容。
				</p>
			) : (
				<ol className="flex flex-col gap-3">
					{posts.items.map((post, index) => (
						<Post key={post.id} post={post} number={firstNumber + index} />
					))}
				</ol>
			)}
			<Pager page={posts.page} pageSize={posts.pageSize} total={posts.total} />
			{can.reply ? (
				// Keyed by the post count so the field empties once a reply has landed.
				<ReplyForm key={posts.total} error={actionData?.error} />
			) : (
				<p className="text-muted mt-6 text-sm">
					{thread.locked ? '主题已锁定，不能再回复。' : '登录后才能回复。'}
				</p>
			)}
		</>
	)
}

function Post({ post, number }: { post: PostDto; number: number }) {
	return (
		<li id={`post-${post.id}`} className="border-border bg-surface scroll-mt-4 rounded-xl border">
			<div className="border-border text-muted flex items-center justify-between gap-3 border-b px-5 py-2 text-xs">
				<span>
					<span className="text-foreground text-sm font-medium">{post.author.displayName}</span>
					{' · '}
					<Timestamp iso={post.createdAt} />
					{post.editedAt !== null && !post.deleted && ' · 已编辑'}
				</span>
				<a href={`#post-${post.id}`} className="hover:text-foreground tabular-nums">
					#{number}
				</a>
			</div>
			{post.deleted ? (
				<p className="text-muted px-5 py-4 text-sm italic">这条回复已被删除。</p>
			) : (
				// Posts are plain text until the Markdown renderer plugin exists (M3).
				<p className="px-5 py-4 text-sm leading-relaxed break-words whitespace-pre-wrap">
					{post.body}
				</p>
			)}
		</li>
	)
}

function ReplyForm({ error }: { error: string | undefined }) {
	const limits = useRouteLoaderData<typeof rootLoader>('root')?.meta?.limits
	const submitting = useNavigation().state === 'submitting'
	return (
		<Form method="post" className="mt-6 flex flex-col gap-3">
			<FormError message={error} />
			<TextField name="body" isRequired maxLength={limits?.postBodyMax} fullWidth>
				<Label>回复</Label>
				<TextArea rows={5} />
			</TextField>
			<div>
				<Button type="submit" isPending={submitting}>
					发表回复
				</Button>
			</div>
		</Form>
	)
}
