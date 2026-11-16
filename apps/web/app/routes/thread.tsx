import { Lock, MessageSquare, PanelLeftClose, PanelLeftOpen, Reply, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
	data,
	Form,
	redirect,
	useLocation,
	useNavigate,
	useNavigation,
	useRouteLoaderData,
	useSubmit,
} from 'react-router'

import type { Route } from './+types/thread'
import { Composer } from '../components/composer/composer'
import { useDock } from '../components/dock/composer-dock'
import { PostCard } from '../components/forum/post'
import { ThreadFlags } from '../components/forum/rows'
import { MobileThreadBar } from '../components/shell/mobile-stage-bar'
import { StageLink, useStage, useStageNavigate } from '../components/stage/stage'
import { Button, ButtonAnchor, ButtonLink, IconButton } from '../components/ui/button'
import {
	Crumbs,
	EmptyState,
	FormError,
	Notice,
	PageHeader,
	Panel,
	Tag,
} from '../components/ui/display'
import { TextInputField } from '../components/ui/field'
import { ActionMenu, ConfirmDialog, type MenuItem } from '../components/ui/overlay'
import { Pager } from '../components/ui/pager'
import { pageCount } from '../lib/format'
import { toggleFocusReading, useFocusReading } from '../lib/focus'
import { forumApi, orThrow, pageParam, textField } from '../lib/forum-api.server'
import { defineStage, listPathOf, pagePathOf } from '../lib/stage'
import type { loader as rootLoader } from '../root'
import { ThreadSidebarSlots, ThreadViewSlots, useHasFilledSlot } from '../slots/slots'
import { pageTitle } from '../lib/site'

// Mounted under every list route (category, search, profile); the list decides where closing goes.
export const handle = defineStage({ layer: 'detail' })

export function meta({ loaderData, matches }: Route.MetaArgs): Route.MetaDescriptors {
	const root = matches[0].loaderData
	if (!loaderData) return [{ title: pageTitle(root) }]
	return [
		{ title: pageTitle(root, loaderData.thread.title) },
		{
			tagName: 'link',
			rel: 'canonical',
			href: `/c/${loaderData.category.slug}/t/${loaderData.thread.ref}`,
		},
	]
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const detail = orThrow(await forumApi.thread(request, params.id, pageParam(request)))
	const wrongCategory = params.slug !== undefined && detail.category.slug !== params.slug
	const wrongRef = params.id !== detail.thread.ref
	if (wrongCategory || wrongRef) {
		const url = new URL(request.url)
		const base = params.slug !== undefined ? `/c/${detail.category.slug}` : listPathOf(url.pathname)
		throw redirect(`${base}/t/${detail.thread.ref}${url.search}`)
	}
	return detail
}

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
			// Land on the page that now holds the reply, in the same list (`?cpage=`, search filters).
			const { posts } = orThrow(await forumApi.thread(request, params.id))
			const last = pageCount(posts.total, posts.pageSize)
			const url = new URL(request.url)
			if (last > 1) url.searchParams.set('page', String(last))
			else url.searchParams.delete('page')
			return redirect(`${pagePathOf(url)}${url.search}#post-${result.value.number}`)
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
			const result = await forumApi.deleteThread(request, params.id)
			if (!result.ok) return failed(intent, result)
			// Back to the list the thread was opened from, on the same list page and filters.
			const url = new URL(request.url)
			url.searchParams.delete('page')
			return redirect(`${listPathOf(url.pathname)}${url.search}`)
		}
		default:
			return failed(intent, { status: 400, error: { message: '未知的操作。' } })
	}
}

export default function Thread({ loaderData, actionData }: Route.ComponentProps) {
	const { thread, category, posts, can } = loaderData
	const forum = useRouteLoaderData<typeof rootLoader>('root')?.meta
	const dock = useDock()
	const focusReading = useFocusReading()
	const submit = useSubmit()
	const stage = useStage()
	const navigate = useStageNavigate()
	const closeHref = stage.listHref ?? `/c/${category.slug}`
	const location = useLocation()
	const hasSidebar = useHasFilledSlot('thread.sidebar')
	// The title the rename form was opened for. A saved title differs from it, which closes the form.
	const [renamingFrom, setRenamingFrom] = useState<string | undefined>(undefined)
	const renaming = renamingFrom === thread.title
	const setRenaming = (open: boolean) => setRenamingFrom(open ? thread.title : undefined)
	const [confirmingDelete, setConfirmingDelete] = useState(false)
	const [copiedFor, setCopiedFor] = useState<string | undefined>(undefined)
	const copied = copiedFor === thread.ref
	// Failures of thread-level actions show above the posts; post-level ones show on the post.
	const threadError =
		actionData !== undefined &&
		actionData !== null &&
		actionData.postId === undefined &&
		actionData.intent !== 'reply'
			? actionData.error
			: undefined

	// Links from before floor numbers point at `#post-<post id>`; move them to the floor anchor.
	const replaceUrl = useNavigate()
	useEffect(() => {
		const legacyId = /^#post-([0-9a-f-]{36})$/i.exec(location.hash)?.[1]
		if (legacyId === undefined) return
		const target = posts.items.find((post) => post.id === legacyId)
		if (target === undefined) return
		void Promise.resolve(
			replaceUrl(`${location.pathname}${location.search}#post-${target.number}`, {
				replace: true,
				preventScrollReset: true,
			}),
		).then(() => document.getElementById(`post-${target.number}`)?.scrollIntoView())
	}, [location.hash, location.pathname, location.search, posts.items, replaceUrl])

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape' || event.defaultPrevented) return
			if (confirmingDelete || renaming) return
			if (
				document.querySelector(
					'[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
				) !== null
			) {
				return
			}
			const active = document.activeElement
			if (
				active instanceof HTMLElement &&
				(active.tagName === 'INPUT' ||
					active.tagName === 'TEXTAREA' ||
					active.tagName === 'SELECT' ||
					active.isContentEditable ||
					active.getAttribute('contenteditable') === 'true' ||
					active.closest('form') !== null)
			) {
				return
			}
			void navigate(closeHref)
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [closeHref, confirmingDelete, navigate, renaming])

	const menu: MenuItem[] = [
		{
			id: 'copy-link',
			label: '复制短链',
			onAction: () => {
				void navigator.clipboard?.writeText(`${window.location.origin}/t/${thread.ref}`)
				setCopiedFor(thread.ref)
				window.setTimeout(() => {
					setCopiedFor((current) => (current === thread.ref ? undefined : current))
				}, 2000)
			},
		},
	]
	if (can.edit) {
		menu.push({ id: 'rename', label: '修改标题', onAction: () => setRenaming(true) })
	}
	if (can.moderate) {
		menu.push(
			thread.pinned
				? {
						id: 'unpin',
						label: '取消置顶',
						onAction: () => submit({ intent: 'unpin' }, { method: 'post' }),
					}
				: {
						id: 'pin',
						label: '置顶',
						onAction: () => submit({ intent: 'pin' }, { method: 'post' }),
					},
			thread.locked
				? {
						id: 'unlock',
						label: '解除锁定',
						onAction: () => submit({ intent: 'unlock' }, { method: 'post' }),
					}
				: {
						id: 'lock',
						label: '锁定',
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

	const replyError = actionData?.intent === 'reply' ? actionData.error : undefined
	const loginHref =
		forum?.viewer.user === null && forum.auth.loginAvailable
			? `/api/forum/auth/login?returnTo=${encodeURIComponent(`${location.pathname}${location.search}`)}`
			: undefined

	const mainContent = (
		<>
			<ThreadViewSlots
				thread={thread}
				atEnd={posts.page >= pageCount(posts.total, posts.pageSize)}
			/>
			{/* Phones go back through the bottom bar, so the breadcrumb is for wide screens. */}
			<div className="max-lg:hidden">
				<Crumbs
					items={[
						{ label: '版块', to: '/' },
						{ label: category.name, to: `/c/${category.slug}` },
					]}
				/>
			</div>
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
							<StageLink
								to={`/c/${category.slug}`}
								prefetch="intent"
								className="hover:text-ink-strong lg:hidden"
							>
								{category.name}
							</StageLink>
							<ThreadFlags thread={thread} />
							<span className="flex items-center gap-1 tabular-nums">
								<MessageSquare aria-hidden size={12} />
								{thread.replyCount} 回复
							</span>
							{copied && (
								<span role="status">
									<Tag tone="accent">已复制短链</Tag>
								</span>
							)}
						</>
					}
					actions={
						// Phones reach these through the bottom bar's menu.
						<div className="flex items-center gap-1 max-lg:hidden">
							{can.reply && (
								<Button
									tone="ghost"
									size="sm"
									data-shortcut="reply"
									{...{ title: '回复（R）' }}
									onPress={() =>
										dock.openReply({
											threadId: thread.id,
											title: thread.title,
											action: `${location.pathname}${location.search}`,
										})
									}
								>
									<Reply aria-hidden />
									回复
								</Button>
							)}
							<IconButton
								label={focusReading ? '退出专注阅读（[）' : '专注阅读（[）'}
								aria-pressed={focusReading}
								onPress={toggleFocusReading}
							>
								{focusReading ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
							</IconButton>
							<ActionMenu label="主题操作" items={menu} size="md" />
							<ButtonLink
								to={closeHref}
								tone="ghost"
								aria-label="关闭主题"
								title="关闭主题"
								className="button--icon-only"
							>
								<X aria-hidden />
							</ButtonLink>
						</div>
					}
				/>
			)}
			{threadError !== undefined && !renaming && <FormError message={threadError} />}
			{posts.items.length === 0 ? (
				<EmptyState icon={MessageSquare} title="这一页没有内容" />
			) : (
				<ol className="border-line mt-5 flex flex-col gap-4 max-lg:-mx-4 max-lg:gap-0 max-lg:border-t">
					{posts.items.map((post, index) => (
						<PostCard
							key={post.id}
							post={post}
							number={post.number}
							byThreadAuthor={post.author.id === thread.author.id}
							// Posts are oldest first and the opening post cannot be deleted on its own.
							opening={posts.page === 1 && index === 0}
							threadTitle={thread.title}
							bodyMax={forum?.limits.postBodyMax}
						/>
					))}
				</ol>
			)}
			<Pager page={posts.page} pageSize={posts.pageSize} total={posts.total} />
			<ReplyArea
				canReply={can.reply}
				locked={thread.locked}
				loginHref={loginHref}
				// Keyed by thread + post count so rapid switches never leak drafts and replies reset cleanly.
				key={`${thread.id}-${posts.total}`}
				error={replyError}
				bodyMax={forum?.limits.postBodyMax}
			/>
			<MobileThreadBar
				threadId={thread.id}
				postsTotal={posts.total}
				canReply={can.reply}
				locked={thread.locked}
				loginHref={loginHref}
				replyError={replyError}
				bodyMax={forum?.limits.postBodyMax}
				menu={menu}
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

	if (hasSidebar) {
		return (
			// The side column is as wide as what it holds and folds away when its slots draw nothing. It
			// needs the room of a wide window, or of focus reading, which hides the list.
			<div className="mx-auto grid max-w-[1180px] 2xl:grid-cols-[minmax(0,1fr)_auto] group-data-[focus=true]/detail:xl:grid-cols-[minmax(0,1fr)_auto]">
				<div className="min-w-0">{mainContent}</div>
				<aside
					aria-label="主题侧栏"
					className="hidden w-[240px] min-w-0 flex-col gap-4 self-start empty:hidden! lg:sticky lg:top-6 2xl:ml-6 2xl:flex group-data-[focus=true]/detail:xl:ml-6 group-data-[focus=true]/detail:xl:flex"
				>
					<ThreadSidebarSlots thread={thread} />
				</aside>
			</div>
		)
	}

	return (
		<div className="mx-auto max-w-[880px] group-data-[focus=true]/detail:max-w-[1040px]">
			{mainContent}
		</div>
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
		<Form method="post" className="mb-5 flex flex-col gap-3">
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
				<Button tone="ghost" onPress={onCancel}>
					取消
				</Button>
				<Button tone="primary" type="submit" isPending={submitting}>
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
				<Notice icon={Lock} className="mt-6 max-lg:hidden">
					主题已锁定，不能再回复。
				</Notice>
			)
		}
		return (
			<Panel className="mt-8 flex flex-wrap items-center justify-between gap-4 px-5 py-4 max-lg:hidden">
				<span className="text-ink">登录后参与讨论。</span>
				{loginHref !== undefined && (
					<ButtonAnchor href={loginHref} tone="primary">
						登录
					</ButtonAnchor>
				)}
			</Panel>
		)
	}
	return (
		<Panel as="section" className="mt-6 p-5 max-lg:hidden">
			<h2 className="section-label mb-3">回复</h2>
			<Form method="post" className="flex flex-col gap-3">
				<input type="hidden" name="intent" value="reply" />
				{locked && (
					// Only moderators reach the form of a locked thread.
					<Notice icon={Lock}>主题已锁定，只有版主和管理员还能回复。</Notice>
				)}
				<FormError message={error} />
				<Composer
					label="回复内容"
					hideLabel
					required
					maxLength={bodyMax}
					rows={5}
					placeholder="写下你的回复"
					deferRich
				/>
				<div className="flex justify-end">
					<Button type="submit" tone="primary" isPending={submitting}>
						发表回复
					</Button>
				</div>
			</Form>
		</Panel>
	)
}
