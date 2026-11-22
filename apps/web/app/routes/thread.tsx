import { parseFloorNumber, type PostDto, type ThreadDto } from '@pluxum/domain'
import { Lock, MessageSquare, Reply, Trash2, X } from 'lucide-react'
import { Fragment, useEffect, useMemo, useState } from 'react'
import {
	data,
	Form,
	redirect,
	useLocation,
	useNavigate,
	useNavigation,
	useRevalidator,
	useRouteLoaderData,
	useSubmit,
} from 'react-router'
import type { I18n } from '@lingui/core'
import { t as tm } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'

import type { Route } from './+types/thread'
import { Composer } from '../components/composer/composer'
import { useDock } from '../components/dock/composer-dock'
import { NewActivityPrompt } from '../components/forum/new-activity'
import { PostCard } from '../components/forum/post'
import { ThreadFlags } from '../components/forum/rows'
import { MobileThreadBar } from '../components/shell/mobile-stage-bar'
import { StageLink, useStage, useStageNavigate } from '../components/stage/stage'
import { Button, ButtonAnchor, ButtonLink } from '../components/ui/button'
import {
	Crumbs,
	EmptyState,
	FormError,
	Notice,
	PageHeader,
	PaneBar,
	Panel,
	Tag,
} from '../components/ui/display'
import { NativeSelect, TextInputField } from '../components/ui/field'
import { ActionMenu, ConfirmDialog, type MenuItem } from '../components/ui/overlay'
import { Pager } from '../components/ui/pager'
import {
	activityLabelCount,
	parseFloorLocation,
	parseThreadActivity,
	threadActivityPath,
	useActivity,
} from '../lib/activity'
import { pageCount } from '../lib/format'
import { forumApi, orThrow, pageParam, textField } from '../lib/forum-api.server'
import { useFocusReading } from '../lib/focus'
import { ThreadContext } from '../lib/thread-context'
import { defineStage, listPathOf, pagePathOf } from '../lib/stage'
import type { loader as rootLoader } from '../root'
import { STREAM_LABEL } from '../lib/stream'
import type { loader as forumStageLoader } from './forum-stage'
import {
	PostAfterSlots,
	PostBeforeSlots,
	ThreadSidebarSlots,
	ThreadViewSlots,
	useHasFilledSlot,
} from '../slots/slots'
import { i18nOfRoot } from '../lib/i18n'
import { i18nFromRequest } from '../lib/i18n.server'
import { pageTitle, socialImageMeta, threadCardUrl } from '../lib/site'
import { loginHref as signInHref } from '../lib/login'

// Mounted under every list route (category, search, profile); the list decides where closing goes.
// `socialImage`: the root layout leaves og:image to this page's meta (a card of the thread).
export const handle = { ...defineStage({ layer: 'detail' }), socialImage: true }

/** A post's Markdown as plain words for a meta description: no images, link targets or marks. */
function plainWords(markdown: string): string {
	return markdown
		.replaceAll(/!\[[^\]]*\]\([^)]*\)/g, ' ')
		.replaceAll(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replaceAll(/[#*_>`~|]+/g, ' ')
		.replaceAll(/\s+/g, ' ')
		.trim()
}

/** A note has no title: its page is named by the start of what it says. */
function headingOf(i18n: I18n, thread: ThreadDto, opening: PostDto | undefined): string {
	if (thread.kind === 'topic') return thread.title
	const text = opening?.body.replaceAll(/\s+/g, ' ').trim() ?? ''
	if (text === '') {
		const author = thread.author.displayName
		return tm(i18n)`${author} 的动态`
	}
	const chars = Array.from(text)
	return chars.length > 30 ? `${chars.slice(0, 30).join('')}…` : text
}

export function meta({ loaderData, matches }: Route.MetaArgs): Route.MetaDescriptors {
	const root = matches[0].loaderData
	const i18n = i18nOfRoot(root)
	if (!loaderData) return [{ title: pageTitle(root) }]
	const { thread, category } = loaderData
	const opening = loaderData.posts.items.find((post) => post.number === 1)
	const heading = headingOf(i18n, thread, opening)
	const canonical = `/c/${category.slug}/t/${thread.ref}`
	const card = threadCardUrl(root, thread.ref)
	const words = Array.from(opening?.deleted ? '' : plainWords(opening?.body ?? ''))
	const description = words.length > 150 ? `${words.slice(0, 150).join('')}…` : words.join('')
	return [
		{ title: pageTitle(root, heading) },
		{ tagName: 'link', rel: 'canonical', href: canonical },
		{ property: 'og:type', content: 'article' },
		{ property: 'og:title', content: heading },
		...(description === '' ? [] : [{ property: 'og:description', content: description }]),
		...(root?.origin === undefined
			? []
			: [{ property: 'og:url', content: `${root.origin}${canonical}` }]),
		...(card === undefined ? [] : socialImageMeta(card)),
	]
}

export async function loader({ request, params, url: location }: Route.LoaderArgs) {
	// Not `request.url`: on a client navigation that is the `.data` URL, no place to redirect to.
	const url = new URL(location)
	// `?floor=N` (from links that only know the floor) becomes the page that shows it, with the
	// floor it replies inside unfolded.
	const floor = parseFloorNumber(url.searchParams.get('floor') ?? '')
	if (floor !== null) {
		const located = orThrow(await forumApi.floorLocation(request, params.id, floor))
		url.searchParams.delete('floor')
		throw redirect(`${url.pathname}${floorSearch(url, located)}#post-${floor}`)
	}
	const expand = parseFloorNumber(url.searchParams.get('expand') ?? '') ?? undefined
	const detail = orThrow(await forumApi.thread(request, params.id, pageParam(request), expand))
	const wrongCategory = params.slug !== undefined && detail.category.slug !== params.slug
	const wrongRef = params.id !== detail.thread.ref
	if (wrongCategory || wrongRef) {
		const base = params.slug !== undefined ? `/c/${detail.category.slug}` : listPathOf(url.pathname)
		throw redirect(`${base}/t/${detail.thread.ref}${url.search}`)
	}
	return detail
}

/** The search of `url` with the page and unfolded floor that show a located floor. */
function floorSearch(
	url: URL,
	located: Readonly<{ page: number; parentFloor: number | null }>,
): string {
	const params = new URLSearchParams(url.search)
	if (located.page > 1) params.set('page', String(located.page))
	else params.delete('page')
	if (located.parentFloor !== null) params.set('expand', String(located.parentFloor))
	else params.delete('expand')
	return params.size > 0 ? `?${params}` : ''
}

/**
 * The path and search of the page that shows a floor, in the list `here` belongs to, or null when
 * the API cannot say.
 */
async function floorTarget(here: URL, threadRef: string, floor: number): Promise<string | null> {
	try {
		const response = await fetch(
			`/api/forum/threads/${encodeURIComponent(threadRef)}/floors/${floor}`,
			{ headers: { accept: 'application/json' }, cache: 'no-store', credentials: 'same-origin' },
		)
		const located = response.ok ? parseFloorLocation(await response.json()) : null
		return located === null ? null : `${here.pathname}${floorSearch(here, located)}`
	} catch {
		return null
	}
}

type ActionFailure = Readonly<{
	intent: string
	error: string
	postId?: string
	parentId?: string
}>

function failed(
	intent: string,
	result: { status: number; error: { message: string } },
	postId?: string,
	parentId?: string,
) {
	const body: ActionFailure = { intent, error: result.error.message, postId, parentId }
	return data(body, { status: result.status })
}

// Every change to a thread posts here with an `intent`; the API decides what the visitor may do.
export async function action({ request, params, url: location }: Route.ActionArgs) {
	const i18n = await i18nFromRequest(request)
	const form = await request.formData()
	const intent = textField(form, 'intent') || 'reply'
	const postId = textField(form, 'postId')
	switch (intent) {
		case 'reply': {
			const parentId = textField(form, 'parentId') || undefined
			const result = await forumApi.createPost(
				request,
				params.id,
				textField(form, 'body'),
				parentId,
			)
			if (!result.ok) return failed(intent, result, undefined, parentId)
			// Land on the page that now holds the reply (its floor unfolded when it is inside one), in
			// the same list (`?cpage=`, search filters).
			const url = new URL(location)
			const located = orThrow(await forumApi.floorLocation(request, params.id, result.value.number))
			return redirect(`${pagePathOf(url)}${floorSearch(url, located)}#post-${result.value.number}`)
		}
		case 'move': {
			const title = textField(form, 'title').trim()
			const result = await forumApi.updateThread(request, params.id, {
				categoryId: textField(form, 'categoryId'),
				...(title === '' ? {} : { title }),
			})
			// The page reloads under the thread's new category (and ref, when it got a title).
			return result.ok ? null : failed(intent, result)
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
			const url = new URL(location)
			url.searchParams.delete('page')
			return redirect(`${listPathOf(url.pathname)}${url.search}`)
		}
		default:
			return failed(intent, { status: 400, error: { message: tm(i18n)`未知的操作。` } })
	}
}

export default function Thread({ loaderData, actionData }: Route.ComponentProps) {
	const { t, i18n } = useLingui()
	const { thread, category, posts, can } = loaderData
	const noteAuthor = thread.author.displayName
	// The stream is built in: it carries the interface's word for notes, not its stored name.
	const categoryName = category.kind === 'stream' ? i18n._(STREAM_LABEL) : category.name
	const replyCount = thread.replyCount
	const forum = useRouteLoaderData<typeof rootLoader>('root')?.meta
	const dock = useDock()
	const submit = useSubmit()
	const stage = useStage()
	// The category's own list open beside the thread already names it, so the crumbs would repeat it.
	const focusReading = useFocusReading()
	const besideOwnList = stage.listPath === `/c/${category.slug}` && !focusReading
	const navigate = useStageNavigate()
	const closeHref = stage.listHref ?? `/c/${category.slug}`
	const location = useLocation()
	const hasSidebar = useHasFilledSlot('thread.sidebar')
	// The title the rename form was opened for. A saved title differs from it, which closes the form.
	const [renamingFrom, setRenamingFrom] = useState<string | undefined>(undefined)
	const renaming = renamingFrom === thread.title
	const setRenaming = (open: boolean) => setRenamingFrom(open ? thread.title : undefined)
	// The category the move form was opened in; arriving elsewhere closes it.
	const [movingFrom, setMovingFrom] = useState<string | undefined>(undefined)
	const moving = movingFrom === thread.categoryId
	const setMoving = (open: boolean) => setMovingFrom(open ? thread.categoryId : undefined)
	const boards = useRouteLoaderData<typeof forumStageLoader>('routes/forum-stage')?.categories ?? []
	const isNote = thread.kind === 'note'
	const threadContext = useMemo(() => ({ thread, can }), [thread, can])
	const opening = posts.items.find((post) => post.number === 1)
	const heading = headingOf(i18n, thread, opening)
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
			if (confirmingDelete || renaming || moving) return
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
	}, [closeHref, confirmingDelete, moving, navigate, renaming])

	// 「N 条新回复」: what others posted since the newest post this page knows of. Pressing it goes
	// to the first of them: on this page it reloads in place, else it opens the page that shows it.
	const revalidator = useRevalidator()
	const { activity, dismiss: dismissActivity } = useActivity(
		threadActivityPath(thread.ref, thread.lastPostAt),
		parseThreadActivity,
	)
	const newReplies = activity === null ? '' : activityLabelCount(activity.count)
	const loadNewReplies = async () => {
		const floor = activity?.floor ?? null
		const here = new URL(window.location.href)
		const target = floor === null ? null : await floorTarget(here, thread.ref, floor)
		if (target !== null && target !== `${here.pathname}${here.search}`) {
			await replaceUrl(`${target}#post-${floor}`, { replace: true })
			dismissActivity()
			return
		}
		await revalidator.revalidate()
		dismissActivity()
		if (floor !== null) {
			requestAnimationFrame(() =>
				document
					.getElementById(`post-${floor}`)
					?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
			)
		}
	}

	const menu: MenuItem[] = [
		{
			id: 'copy-link',
			label: t`复制短链`,
			onAction: () => {
				void navigator.clipboard?.writeText(`${window.location.origin}/t/${thread.ref}`)
				setCopiedFor(thread.ref)
				window.setTimeout(() => {
					setCopiedFor((current) => (current === thread.ref ? undefined : current))
				}, 2000)
			},
		},
	]
	if (can.edit && !isNote) {
		menu.push({ id: 'rename', label: t`修改标题`, onAction: () => setRenaming(true) })
	}
	if (can.move && boards.some((board) => board.id !== thread.categoryId)) {
		menu.push({
			id: 'move',
			label: isNote ? t`转为主题帖` : t`移动到其他版块`,
			onAction: () => setMoving(true),
		})
	}
	if (can.moderate) {
		menu.push(
			thread.pinned
				? {
						id: 'unpin',
						label: t`取消置顶`,
						onAction: () => submit({ intent: 'unpin' }, { method: 'post' }),
					}
				: {
						id: 'pin',
						label: t({ message: '置顶', context: 'menu action' }),
						onAction: () => submit({ intent: 'pin' }, { method: 'post' }),
					},
			thread.locked
				? {
						id: 'unlock',
						label: t`解除锁定`,
						onAction: () => submit({ intent: 'unlock' }, { method: 'post' }),
					}
				: {
						id: 'lock',
						label: t({ message: '锁定', context: 'menu action' }),
						onAction: () => submit({ intent: 'lock' }, { method: 'post' }),
					},
		)
	}
	if (can.delete) {
		menu.push({
			id: 'delete',
			label: t`删除主题`,
			icon: Trash2,
			danger: true,
			onAction: () => setConfirmingDelete(true),
		})
	}

	const replyError = actionData?.intent === 'reply' ? actionData.error : undefined
	const loginHref =
		forum?.viewer.user === null && forum.auth.loginAvailable
			? signInHref(forum.auth, `${location.pathname}${location.search}`)
			: undefined

	const threadActions = (
		// Phones reach these through the bottom bar's menu.
		<div className="flex items-center gap-1 max-lg:hidden">
			{can.reply && (
				<Button
					tone="ghost"
					size="sm"
					data-shortcut="reply"
					{...{ title: t`回复（R）` }}
					onPress={() =>
						dock.openReply({
							threadId: thread.id,
							title: heading,
							action: `${location.pathname}${location.search}`,
						})
					}
				>
					<Reply aria-hidden />
					<Trans context="verb">回复</Trans>
				</Button>
			)}
			<ActionMenu label={t`主题操作`} items={menu} size="md" />
			<ButtonLink
				to={closeHref}
				tone="ghost"
				aria-label={t`关闭主题`}
				title={t`关闭主题`}
				className="button--icon-only"
			>
				<X aria-hidden />
			</ButtonLink>
		</div>
	)

	const paneBar = (
		<>
			{/* The pane's head (wide screens): where the thread is, and what can be done with it. Phones
		    go back and act through the bottom bar. */}
			<PaneBar>
				{besideOwnList ? (
					<span className="flex-1" />
				) : (
					<Crumbs
						className="min-w-0 flex-1"
						items={[
							{ label: t`版块`, to: '/' },
							{ label: categoryName, to: `/c/${category.slug}` },
						]}
					/>
				)}
				{threadActions}
			</PaneBar>
		</>
	)

	const mainContent = (
		<>
			<ThreadViewSlots
				thread={thread}
				atEnd={posts.page >= pageCount(posts.total, posts.pageSize)}
			/>
			{moving ? (
				<MoveThread
					thread={thread}
					boards={boards.filter((board) => board.id !== thread.categoryId)}
					titleMax={forum?.limits.threadTitleMax}
					error={actionData?.intent === 'move' ? actionData.error : undefined}
					onCancel={() => setMoving(false)}
				/>
			) : renaming ? (
				<RenameThread
					title={thread.title}
					max={forum?.limits.threadTitleMax}
					error={actionData?.intent === 'rename' ? actionData.error : undefined}
					onCancel={() => setRenaming(false)}
				/>
			) : (
				<PageHeader
					bar={false}
					title={isNote ? t`${noteAuthor} 的动态` : thread.title}
					meta={
						<>
							<StageLink
								to={`/c/${category.slug}`}
								prefetch="intent"
								className="hover:text-ink-strong lg:hidden"
							>
								{categoryName}
							</StageLink>
							<ThreadFlags thread={thread} />
							<span className="flex items-center gap-1 tabular-nums">
								<MessageSquare aria-hidden size={12} />
								{t`${replyCount} 回复`}
							</span>
							{copied && (
								<span role="status">
									<Tag tone="accent">
										<Trans>已复制短链</Trans>
									</Tag>
								</span>
							)}
						</>
					}
				/>
			)}
			{threadError !== undefined && !renaming && !moving && <FormError message={threadError} />}
			<NewActivityPrompt
				label={activity === null ? null : t`${newReplies} 条新回复`}
				onLoad={loadNewReplies}
			/>
			{posts.items.length === 0 ? (
				<EmptyState icon={MessageSquare} title={t`这一页没有内容`} />
			) : (
				<ThreadContext.Provider value={threadContext}>
					<ol className="border-line mt-5 flex flex-col gap-4 max-lg:-mx-4 max-lg:gap-0 max-lg:border-t">
						{posts.items.map((post) => (
							<Fragment key={post.id}>
								<PostBeforeSlots post={post} thread={thread} />
								<PostCard
									post={post}
									number={post.number}
									byThreadAuthor={post.author.id === thread.author.id}
									// The opening post cannot be deleted on its own.
									opening={post.number === 1}
									threadTitle={thread.title}
									// A note's opening post keeps the note limit.
									bodyMax={
										isNote && post.number === 1
											? forum?.limits.noteBodyMax
											: forum?.limits.postBodyMax
									}
									threadAuthorId={thread.author.id}
									canReply={can.reply}
								/>
								<PostAfterSlots post={post} thread={thread} />
							</Fragment>
						))}
					</ol>
				</ThreadContext.Provider>
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
				title={t`删除这个主题？`}
				body={t`所有回复会一并删除。`}
				confirmLabel={t`删除主题`}
				fields={{ intent: 'delete-thread' }}
			/>
		</>
	)

	if (hasSidebar) {
		return (
			// The side column is as wide as what it holds and folds away when its slots draw nothing. It
			// needs the room of a wide window, or of focus reading, which hides the list.
			<div className="mx-auto max-w-[1180px]">
				{paneBar}
				<div className="grid 2xl:grid-cols-[minmax(0,1fr)_auto] group-data-[focus=true]/detail:xl:grid-cols-[minmax(0,1fr)_auto]">
					<div className="min-w-0">{mainContent}</div>
					<aside
						aria-label={t`主题侧栏`}
						className="hidden w-[240px] min-w-0 flex-col gap-4 self-start empty:hidden! lg:sticky lg:top-[calc(var(--h-pane-bar)+12px)] 2xl:ml-6 2xl:flex group-data-[focus=true]/detail:xl:ml-6 group-data-[focus=true]/detail:xl:flex"
					>
						<ThreadSidebarSlots thread={thread} />
					</aside>
				</div>
			</div>
		)
	}

	return (
		<div className="mx-auto max-w-[880px] transition-[max-width] duration-300 ease-[var(--stage-ease)] group-data-[focus=true]/detail:max-w-[1040px]">
			{paneBar}
			{mainContent}
		</div>
	)
}

/**
 * Moves the thread to another board. A note becomes a topic there and needs a title; a topic
 * keeps its title unless one is typed.
 */
function MoveThread({
	thread,
	boards,
	titleMax,
	error,
	onCancel,
}: {
	thread: ThreadDto
	boards: ReadonlyArray<Readonly<{ id: string; name: string }>>
	titleMax: number | undefined
	error: string | undefined
	onCancel: () => void
}) {
	const { t } = useLingui()
	const submitting = useNavigation().formData?.get('intent') === 'move'
	const isNote = thread.kind === 'note'
	return (
		<Form method="post" className="mb-5 flex flex-col gap-3">
			<input type="hidden" name="intent" value="move" />
			<FormError message={error} />
			<label className="flex flex-col gap-1.5">
				<span className="text-ink-strong text-ui font-bold">
					{isNote ? t`发到版块` : t`移到版块`}
				</span>
				<NativeSelect name="categoryId" required defaultValue={boards[0]?.id}>
					{boards.map((board) => (
						<option key={board.id} value={board.id}>
							{board.name}
						</option>
					))}
				</NativeSelect>
			</label>
			<TextInputField
				name="title"
				label={t`标题`}
				required={isNote}
				maxLength={titleMax}
				defaultValue={isNote ? '' : thread.title}
				hint={isNote ? t`转为主题帖后，正文和回复都会保留。` : undefined}
				autoFocus
			/>
			<div className="flex justify-end gap-2">
				<Button tone="ghost" onPress={onCancel}>
					<Trans>取消</Trans>
				</Button>
				<Button tone="primary" type="submit" isPending={submitting}>
					{isNote ? t`转为主题帖` : t`移动`}
				</Button>
			</div>
		</Form>
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
	const { t } = useLingui()
	const submitting = useNavigation().formData?.get('intent') === 'rename'
	return (
		<Form method="post" className="mb-5 flex flex-col gap-3">
			<input type="hidden" name="intent" value="rename" />
			<FormError message={error} />
			<TextInputField
				name="title"
				label={t`标题`}
				required
				maxLength={max}
				defaultValue={title}
				autoFocus
			/>
			<div className="flex justify-end gap-2">
				<Button tone="ghost" onPress={onCancel}>
					<Trans>取消</Trans>
				</Button>
				<Button tone="primary" type="submit" isPending={submitting}>
					<Trans>保存标题</Trans>
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
	const { t } = useLingui()
	const submitting = useNavigation().formData?.get('intent') === 'reply'
	if (!canReply) {
		if (locked) {
			return (
				<Notice icon={Lock} className="mt-6 max-lg:hidden">
					<Trans>主题已锁定</Trans>
				</Notice>
			)
		}
		return (
			<Panel className="mt-8 flex flex-wrap items-center justify-between gap-4 px-5 py-4 max-lg:hidden">
				<span className="text-ink">
					<Trans>登录后参与讨论。</Trans>
				</span>
				{loginHref !== undefined && (
					<ButtonAnchor href={loginHref} tone="primary">
						<Trans>登录</Trans>
					</ButtonAnchor>
				)}
			</Panel>
		)
	}
	return (
		<Panel as="section" className="mt-6 p-5 max-lg:hidden">
			<h2 className="section-label mb-3">
				<Trans context="noun">回复</Trans>
			</h2>
			<Form method="post" className="flex flex-col gap-3">
				<input type="hidden" name="intent" value="reply" />
				{locked && (
					// Only moderators reach the form of a locked thread.
					<Notice icon={Lock}>
						<Trans>主题已锁定，仅版主可回复</Trans>
					</Notice>
				)}
				<FormError message={error} />
				<Composer
					label={t`回复内容`}
					hideLabel
					required
					maxLength={bodyMax}
					rows={5}
					placeholder={t`写下你的回复`}
					deferRich
				/>
				<div className="flex justify-end">
					<Button type="submit" tone="primary" isPending={submitting}>
						<Trans>发表回复</Trans>
					</Button>
				</div>
			</Form>
		</Panel>
	)
}
