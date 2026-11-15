import {
	Lock,
	LockOpen,
	LogIn,
	MessageSquare,
	Pencil,
	Pin,
	PinOff,
	Send,
	Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { data, Form, redirect, useNavigation, useRouteLoaderData, useSubmit } from 'react-router'

import type { Route } from './+types/thread'
import { PostCard } from '../components/forum/post'
import { ThreadFlags } from '../components/forum/rows'
import { Button, ButtonAnchor } from '../components/ui/button'
import { Crumbs, EmptyState, FormError, Notice, PageHeader, Panel } from '../components/ui/display'
import { TextAreaField, TextInputField } from '../components/ui/field'
import { ActionMenu, ConfirmDialog, type MenuItem } from '../components/ui/overlay'
import { Pager } from '../components/ui/pager'
import { pageCount } from '../lib/format'
import { forumApi, orThrow, pageParam, textField } from '../lib/forum-api.server'
import { keepOnThemeChange } from '../lib/revalidate'
import type { loader as rootLoader } from '../root'

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: `${loaderData ? `${loaderData.thread.title} · ` : ''}Pluxel Forum` }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
	return orThrow(await forumApi.thread(request, params.id, pageParam(request)))
}

export const shouldRevalidate = keepOnThemeChange

type ActionFailure = Readonly<{ intent: string; error: string; postId?: string }>

function failed(
	intent: string,
	result: { status: number; error: { message: string } },
	postId?: string,
) {
	const body: ActionFailure = { intent, error: result.error.message, postId }
	return data(body, { status: result.status })
}

// Every change to a thread posts here with an `intent`; the API decides what the visitor may do.
export async function action({ request, params }: Route.ActionArgs) {
	const form = await request.formData()
	const intent = textField(form, 'intent') || 'reply'
	const postId = textField(form, 'postId')
	switch (intent) {
		case 'reply': {
			const result = await forumApi.createPost(request, params.id, textField(form, 'body'))
			if (!result.ok) return failed(intent, result)
			// Land on the page that now holds the reply.
			const { posts } = orThrow(await forumApi.thread(request, params.id))
			const last = pageCount(posts.total, posts.pageSize)
			return redirect(`/t/${params.id}${last > 1 ? `?page=${last}` : ''}#post-${result.value.id}`)
		}
		case 'edit-post': {
			const result = await forumApi.updatePost(request, postId, textField(form, 'body'))
			return result.ok ? null : failed(intent, result, postId)
		}
		case 'delete-post': {
			const result = await forumApi.deletePost(request, postId)
			return result.ok ? null : failed(intent, result, postId)
		}
		case 'rename': {
			const result = await forumApi.updateThread(request, params.id, {
				title: textField(form, 'title'),
			})
			return result.ok ? null : failed(intent, result)
		}
		case 'pin':
		case 'unpin':
		case 'lock':
		case 'unlock': {
			const patch =
				intent === 'pin' || intent === 'unpin'
					? { pinned: intent === 'pin' }
					: { locked: intent === 'lock' }
			const result = await forumApi.updateThread(request, params.id, patch)
			return result.ok ? null : failed(intent, result)
		}
		case 'delete-thread': {
			const { category } = orThrow(await forumApi.thread(request, params.id))
			const result = await forumApi.deleteThread(request, params.id)
			return result.ok ? redirect(`/c/${category.slug}`) : failed(intent, result)
		}
		default:
			return failed(intent, { status: 400, error: { message: '未知的操作。' } })
	}
}

export default function Thread({ loaderData, actionData }: Route.ComponentProps) {
	const { thread, category, posts, can } = loaderData
	const forum = useRouteLoaderData<typeof rootLoader>('root')?.meta
	const submit = useSubmit()
	// The title the rename form was opened for. A saved title differs from it, which closes the form.
	const [renamingFrom, setRenamingFrom] = useState<string | undefined>(undefined)
	const renaming = renamingFrom === thread.title
	const setRenaming = (open: boolean) => setRenamingFrom(open ? thread.title : undefined)
	const [confirmingDelete, setConfirmingDelete] = useState(false)
	const firstNumber = (posts.page - 1) * posts.pageSize + 1
	// Failures of thread-level actions show above the posts; post-level ones show on the post.
	const threadError =
		actionData !== undefined &&
		actionData !== null &&
		actionData.postId === undefined &&
		actionData.intent !== 'reply'
			? actionData.error
			: undefined

	const menu: MenuItem[] = []
	if (can.edit) {
		menu.push({ id: 'rename', label: '修改标题', icon: Pencil, onAction: () => setRenaming(true) })
	}
	if (can.moderate) {
		menu.push(
			thread.pinned
				? {
						id: 'unpin',
						label: '取消置顶',
						icon: PinOff,
						onAction: () => submit({ intent: 'unpin' }, { method: 'post' }),
					}
				: {
						id: 'pin',
						label: '置顶',
						icon: Pin,
						onAction: () => submit({ intent: 'pin' }, { method: 'post' }),
					},
			thread.locked
				? {
						id: 'unlock',
						label: '解除锁定',
						icon: LockOpen,
						onAction: () => submit({ intent: 'unlock' }, { method: 'post' }),
					}
				: {
						id: 'lock',
						label: '锁定',
						icon: Lock,
						onAction: () => submit({ intent: 'lock' }, { method: 'post' }),
					},
		)
	}
	if (can.delete) {
		menu.push({
			id: 'delete',
			label: '删除主题',
			icon: Trash2,
			danger: true,
			onAction: () => setConfirmingDelete(true),
		})
	}

	return (
		<>
			<Crumbs
				items={[
					{ label: '版块', to: '/' },
					{ label: category.name, to: `/c/${category.slug}` },
					{ label: thread.title },
				]}
			/>
			{renaming ? (
				<RenameThread
					title={thread.title}
					max={forum?.limits.threadTitleMax}
					error={actionData?.intent === 'rename' ? actionData.error : undefined}
					onCancel={() => setRenaming(false)}
				/>
			) : (
				<PageHeader
					title={thread.title}
					meta={
						<>
							<ThreadFlags thread={thread} />
							<span className="flex items-center gap-1 tabular-nums">
								<MessageSquare aria-hidden size={12} />
								{thread.replyCount} 回复
							</span>
						</>
					}
					actions={
						menu.length > 0 ? <ActionMenu label="主题操作" items={menu} size="md" /> : undefined
					}
				/>
			)}
			{threadError !== undefined && !renaming && <FormError message={threadError} />}
			{posts.items.length === 0 ? (
				<EmptyState icon={MessageSquare} title="这一页没有内容" />
			) : (
				<ol className="mt-4 flex flex-col gap-3">
					{posts.items.map((post, index) => (
						<PostCard
							key={post.id}
							post={post}
							number={firstNumber + index}
							byThreadAuthor={post.author.id === thread.author.id}
							// Posts are oldest first and the opening post cannot be deleted on its own.
							opening={posts.page === 1 && index === 0}
							bodyMax={forum?.limits.postBodyMax}
						/>
					))}
				</ol>
			)}
			<Pager page={posts.page} pageSize={posts.pageSize} total={posts.total} />
			<ReplyArea
				canReply={can.reply}
				locked={thread.locked}
				loginHref={
					forum?.viewer.user === null && forum.auth.loginAvailable
						? `/api/forum/auth/login?returnTo=${encodeURIComponent(`/t/${thread.id}`)}`
						: undefined
				}
				// Keyed by the post count so the field empties once a reply has landed.
				key={posts.total}
				error={actionData?.intent === 'reply' ? actionData.error : undefined}
				bodyMax={forum?.limits.postBodyMax}
			/>
			<ConfirmDialog
				isOpen={confirmingDelete}
				onOpenChange={setConfirmingDelete}
				title="删除这个主题？"
				body="主题和其中的全部回复都会从版块中消失。"
				confirmLabel="删除主题"
				fields={{ intent: 'delete-thread' }}
			/>
		</>
	)
}

function RenameThread({
	title,
	max,
	error,
	onCancel,
}: {
	title: string
	max: number | undefined
	error: string | undefined
	onCancel: () => void
}) {
	const submitting = useNavigation().formData?.get('intent') === 'rename'
	return (
		<Form method="post" className="mb-4 flex flex-col gap-2">
			<input type="hidden" name="intent" value="rename" />
			<FormError message={error} />
			<TextInputField
				name="title"
				label="标题"
				required
				maxLength={max}
				defaultValue={title}
				autoFocus
			/>
			<div className="flex justify-end gap-2">
				<Button tone="ghost" size="sm" onPress={onCancel}>
					取消
				</Button>
				<Button tone="primary" size="sm" type="submit" isPending={submitting}>
					保存标题
				</Button>
			</div>
		</Form>
	)
}

function ReplyArea({
	canReply,
	locked,
	loginHref,
	error,
	bodyMax,
}: {
	canReply: boolean
	locked: boolean
	loginHref: string | undefined
	error: string | undefined
	bodyMax: number | undefined
}) {
	const submitting = useNavigation().formData?.get('intent') === 'reply'
	if (!canReply) {
		if (locked) {
			return (
				<Notice icon={Lock} className="mt-6">
					主题已锁定，不能再回复。
				</Notice>
			)
		}
		return (
			<Panel className="mt-6 flex flex-wrap items-center justify-between gap-3 px-4 py-3">
				<span className="text-ink">登录后参与讨论。</span>
				{loginHref !== undefined && (
					<ButtonAnchor href={loginHref} tone="primary" size="sm">
						<LogIn aria-hidden />
						登录
					</ButtonAnchor>
				)}
			</Panel>
		)
	}
	return (
		<Panel as="section" className="mt-6 p-4">
			<h2 className="section-label mb-2">回复</h2>
			<Form method="post" className="flex flex-col gap-3">
				<input type="hidden" name="intent" value="reply" />
				{locked && (
					// Only moderators reach the form of a locked thread.
					<Notice icon={Lock}>主题已锁定，只有版主和管理员还能回复。</Notice>
				)}
				<FormError message={error} />
				<TextAreaField
					name="body"
					label="回复内容"
					hideLabel
					required
					maxLength={bodyMax}
					rows={5}
					placeholder="写下你的回复"
					hint="目前按纯文本显示，换行会保留。"
				/>
				<div className="flex justify-end">
					<Button type="submit" tone="primary" isPending={submitting}>
						<Send aria-hidden />
						发表回复
					</Button>
				</div>
			</Form>
		</Panel>
	)
}
