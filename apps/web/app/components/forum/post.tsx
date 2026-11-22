import type { PageDto, PostDto } from '@pluxum/domain'
import { ChevronDown, ChevronUp, MessageSquareReply, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Form, Link, useActionData, useNavigation } from 'react-router'
import { Trans, useLingui } from '@lingui/react/macro'

import { withoutLeadingTitle } from '../../lib/post-html'
import { PostFooterSlots, usePostMenuSlots } from '../../slots/slots'
import { Composer } from '../composer/composer'
import { Button } from '../ui/button'
import { FormError, Tag, Timestamp } from '../ui/display'
import { imagesForClick, useLightbox } from '../ui/lightbox'
import { ActionMenu, ConfirmDialog, type MenuItem } from '../ui/overlay'
import { EditedMark } from './post-history'
import { UserAvatar } from './user-avatar'

/**
 * One post of a thread. Editing happens in place; deleting asks first. Both post to the thread
 * route's action with an `intent`.
 */
export function PostCard({
	post,
	number,
	byThreadAuthor,
	opening,
	threadTitle,
	bodyMax,
	threadAuthorId,
	canReply = false,
}: {
	post: PostDto
	/** Position in the thread, 1 for the opening post. */
	number: number
	byThreadAuthor: boolean
	/** The opening post goes away only with its thread, so it has no delete of its own. */
	opening: boolean
	/** The thread's title: an opening post that starts by repeating it drops that line. */
	threadTitle: string
	bodyMax: number | undefined
	/** Marks replies inside the floor by the thread's author. */
	threadAuthorId?: string
	/** Whether the viewer may answer inside this floor. */
	canReply?: boolean
}) {
	const { t } = useLingui()
	// Who the floor's reply box answers (the floor or one reply in it), opened at a reply count.
	// Posting changes the count, which closes the box.
	const [answering, setAnswering] = useState<Readonly<{ post: PostDto; total: number }> | null>(
		null,
	)
	const repliesTotal = post.replies?.total ?? 0
	const answer = answering !== null && answering.total === repliesTotal ? answering.post : null
	const answerTo = (target: PostDto) => setAnswering({ post: target, total: repliesTotal })
	const nested = post.replies !== undefined && !opening
	// The edit time the editor was opened at. A saved edit comes back with a new one, which closes it.
	const [editingFrom, setEditingFrom] = useState<string | null | undefined>(undefined)
	const editing = editingFrom !== undefined && editingFrom === post.editedAt
	const setEditing = (open: boolean) => setEditingFrom(open ? post.editedAt : undefined)
	const [confirming, setConfirming] = useState(false)
	const lightbox = useLightbox()
	const [copied, setCopied] = useState(false)
	const ext = usePostMenuSlots(post)
	// Order: share, then what extensions add (report), then the author's own edit and delete.
	const items: MenuItem[] = [
		{
			id: 'copy-link',
			label: t`复制本楼链接`,
			onAction: () => {
				const url = new URL(window.location.href)
				url.hash = `post-${post.number}`
				void navigator.clipboard?.writeText(url.toString())
				setCopied(true)
				window.setTimeout(() => setCopied(false), 2000)
			},
		},
		...ext.items,
	]
	if (!post.deleted && post.can.edit) {
		items.push({ id: 'edit', label: t`编辑`, icon: Pencil, onAction: () => setEditing(true) })
	}
	if (!post.deleted && post.can.delete && !opening) {
		items.push({
			id: 'delete',
			label: t`删除`,
			icon: Trash2,
			danger: true,
			onAction: () => setConfirming(true),
		})
	}
	return (
		<li
			id={`post-${post.number}`}
			// What the thread's floor timeline reads off the page.
			data-floor={number}
			data-floor-author={post.author.displayName}
			data-floor-time={post.createdAt}
			// Phones: an edge-to-edge list divided by lines; wide screens: one panel per post.
			className={`border-line-soft bg-panel group scroll-mt-20 border-b lg:rounded-[2px] lg:border-b-0${!opening && !editing ? ' post-card-cv' : ''}`}
			// Images in the body and the attachment strip open in the viewer, all of this post's in turn.
			onClick={(event) => {
				const found = lightbox ? imagesForClick(event, event.currentTarget) : null
				if (lightbox && found) {
					event.preventDefault()
					lightbox(found.images, found.index)
				}
			}}
		>
			<div className="flex items-center gap-3 pt-4 pr-3 pl-4 lg:pl-5">
				<Link to={`/u/${post.author.handle}`} viewTransition tabIndex={-1} aria-hidden>
					<UserAvatar user={post.author} />
				</Link>
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 items-center gap-2">
						<Link
							to={`/u/${post.author.handle}`}
							viewTransition
							className="text-ink-strong truncate font-bold hover:underline"
						>
							{post.author.displayName}
						</Link>
						{byThreadAuthor && (
							<Tag>
								<Trans>楼主</Trans>
							</Tag>
						)}
					</div>
					<div className="text-ink-weak flex items-center gap-1.5 text-meta">
						<Timestamp iso={post.createdAt} />
						{post.editedAt !== null && !post.deleted && (
							<>
								<span aria-hidden>·</span>
								<EditedMark post={post} />
							</>
						)}
						<span aria-hidden>·</span>
						<a
							href={`#post-${post.number}`}
							className="hover:text-ink-strong tabular-nums"
							aria-label={t`第 ${number} 楼的链接`}
						>
							#{number}
						</a>
						{copied && <span role="status">· {t`已复制链接`}</span>}
					</div>
				</div>
				{nested && canReply && !post.deleted && (
					<Button
						tone="ghost"
						size="sm"
						className="text-ink-weak"
						aria-label={t`回复第 ${number} 楼`}
						onPress={() => answerTo(post)}
					>
						<MessageSquareReply aria-hidden />
						<span className="max-sm:sr-only">
							<Trans context="verb">回复</Trans>
						</span>
					</Button>
				)}
				<ActionMenu label={t`第 ${number} 楼的操作`} items={items} />
				{ext.slots}
			</div>
			{post.deleted ? (
				<p className="text-ink-weak px-4 pt-3 pb-5 italic lg:px-5">
					<Trans>这条回复已被删除。</Trans>
				</p>
			) : editing ? (
				<EditPost post={post} bodyMax={bodyMax} onDone={() => setEditing(false)} />
			) : (
				// The forum core has already filtered this HTML against its allowlist.
				<div
					className={`post-body px-4 pt-3 pb-5 lg:px-5${post.bodyFormat === 'plain' ? ' post-body--plain' : ''}`}
					dangerouslySetInnerHTML={{
						__html: opening ? withoutLeadingTitle(post.bodyHtml, threadTitle) : post.bodyHtml,
					}}
				/>
			)}
			{!post.deleted && !editing && <PostFooterSlots post={post} />}
			{nested && post.replies !== undefined && (
				<FloorReplies
					floor={post}
					replies={post.replies}
					threadAuthorId={threadAuthorId}
					canReply={canReply}
					bodyMax={bodyMax}
					answer={answer}
					onAnswer={answerTo}
					onCancelAnswer={() => setAnswering(null)}
				/>
			)}
			<ConfirmDialog
				isOpen={confirming}
				onOpenChange={setConfirming}
				title={t`删除这条回复？`}
				confirmLabel={t`删除`}
				fields={{ intent: 'delete-post', postId: post.id }}
			/>
		</li>
	)
}

/** How many replies of a floor one request fetches when the visitor asks for the rest. */
const REPLY_PAGE = 50

/** A page of replies as the API answers it (the API checks the shape of every post). */
function isReplyPage(value: unknown): value is PageDto<PostDto> {
	return (
		typeof value === 'object' &&
		value !== null &&
		'items' in value &&
		Array.isArray(value.items) &&
		'total' in value &&
		typeof value.total === 'number'
	)
}

/**
 * The replies inside a floor ("楼中楼"), one level deep: the first few come with the page and
 * "展开" fetches the rest. Each can be answered (the answer stays in this floor and names who it
 * answers), edited or deleted like a post; the box for answering sits at the end of the block.
 */
function FloorReplies({
	floor,
	replies,
	threadAuthorId,
	canReply,
	bodyMax,
	answer,
	onAnswer,
	onCancelAnswer,
}: {
	floor: PostDto
	replies: Readonly<{ items: PostDto[]; total: number }>
	threadAuthorId: string | undefined
	canReply: boolean
	bodyMax: number | undefined
	answer: PostDto | null
	onAnswer: (target: PostDto) => void
	onCancelAnswer: () => void
}) {
	const { t } = useLingui()
	// The whole list once fetched; null shows the replies the page came with.
	const [fetched, setFetched] = useState<PostDto[] | null>(null)
	const [loading, setLoading] = useState(false)
	const [failed, setFailed] = useState(false)
	const shown = fetched ?? replies.items
	const hidden = replies.total - shown.length

	const fetchAll = async (signal?: AbortSignal) => {
		setLoading(true)
		setFailed(false)
		try {
			const all: PostDto[] = []
			for (let page = 1; ; page++) {
				// oxlint-disable-next-line no-await-in-loop -- pages come in order, rarely more than one.
				const response = await fetch(
					`/api/forum/posts/${encodeURIComponent(floor.id)}/replies?page=${page}&pageSize=${REPLY_PAGE}`,
					{ headers: { accept: 'application/json' }, signal },
				)
				if (!response.ok) throw new Error(`replies: ${response.status}`)
				// oxlint-disable-next-line no-await-in-loop -- see above.
				const body: unknown = await response.json()
				if (!isReplyPage(body)) throw new Error('replies: unexpected answer')
				all.push(...body.items)
				if (all.length >= body.total || body.items.length === 0) break
			}
			setFetched(all)
		} catch {
			if (!signal?.aborted) setFailed(true)
		} finally {
			if (!signal?.aborted) setLoading(false)
		}
	}

	// The page reloaded (a reply was posted, edited or deleted): an unfolded list follows it.
	const expanded = fetched !== null
	useEffect(() => {
		if (!expanded) return undefined
		const controller = new AbortController()
		void fetchAll(controller.signal)
		return () => controller.abort()
		// oxlint-disable-next-line react-hooks/exhaustive-deps -- refetch only when the page's replies change.
	}, [replies])

	if (shown.length === 0 && answer === null) return null
	return (
		<div className="floor-replies bg-control/60 mx-4 mb-4 rounded-[2px] px-3 py-1 lg:mx-5">
			{shown.length > 0 && (
				<ul className="divide-line-soft divide-y">
					{shown.map((reply) => (
						<FloorReply
							key={reply.id}
							reply={reply}
							byThreadAuthor={reply.author.id === threadAuthorId}
							canReply={canReply}
							bodyMax={bodyMax}
							onAnswer={() => onAnswer(reply)}
						/>
					))}
				</ul>
			)}
			{(hidden > 0 || expanded) && (
				<div className="flex items-center gap-3 py-2 text-meta">
					{hidden > 0 ? (
						<button
							type="button"
							className="text-accent inline-flex cursor-pointer items-center gap-1 hover:underline disabled:opacity-60"
							disabled={loading}
							onClick={() => void fetchAll()}
						>
							<ChevronDown aria-hidden size={14} />
							{loading ? t`加载中…` : t`展开剩余 ${hidden} 条回复`}
						</button>
					) : (
						<button
							type="button"
							className="text-ink-weak hover:text-ink-strong inline-flex cursor-pointer items-center gap-1"
							onClick={() => setFetched(null)}
						>
							<ChevronUp aria-hidden size={14} />
							<Trans>收起</Trans>
						</button>
					)}
					{failed && (
						<span className="text-danger">
							<Trans>加载失败，请重试。</Trans>
						</span>
					)}
				</div>
			)}
			{answer !== null && (
				<AnswerInFloor
					target={answer}
					bodyMax={bodyMax}
					// Keyed by the target and count: a posted reply or another target starts afresh.
					key={`${answer.id}-${replies.total}`}
					onCancel={onCancelAnswer}
				/>
			)}
		</div>
	)
}

/** One reply inside a floor: compact, with who it answers before its text. */
function FloorReply({
	reply,
	byThreadAuthor,
	canReply,
	bodyMax,
	onAnswer,
}: {
	reply: PostDto
	byThreadAuthor: boolean
	canReply: boolean
	bodyMax: number | undefined
	onAnswer: () => void
}) {
	const { t } = useLingui()
	const [editingFrom, setEditingFrom] = useState<string | null | undefined>(undefined)
	const editing = editingFrom !== undefined && editingFrom === reply.editedAt
	const [confirming, setConfirming] = useState(false)
	const ext = usePostMenuSlots(reply)
	const replyNumber = reply.number
	const items: MenuItem[] = [
		{
			id: 'copy-link',
			label: t`复制链接`,
			onAction: () => {
				const url = new URL(window.location.href)
				url.hash = `post-${reply.number}`
				void navigator.clipboard?.writeText(url.toString())
			},
		},
		...ext.items,
	]
	if (reply.can.edit) {
		items.push({
			id: 'edit',
			label: t`编辑`,
			icon: Pencil,
			onAction: () => setEditingFrom(reply.editedAt),
		})
	}
	if (reply.can.delete) {
		items.push({
			id: 'delete',
			label: t`删除`,
			icon: Trash2,
			danger: true,
			onAction: () => setConfirming(true),
		})
	}
	return (
		// No `data-floor`: the floor timeline lists top-level floors only.
		<li id={`post-${reply.number}`} className="group scroll-mt-24 py-2">
			<div className="flex items-start gap-2">
				<Link to={`/u/${reply.author.handle}`} viewTransition tabIndex={-1} aria-hidden>
					<UserAvatar user={reply.author} size="sm" />
				</Link>
				<div className="min-w-0 flex-1">
					<p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-meta">
						<Link
							to={`/u/${reply.author.handle}`}
							viewTransition
							className="text-ink-strong font-bold hover:underline"
						>
							{reply.author.displayName}
						</Link>
						{byThreadAuthor && (
							<Tag>
								<Trans>楼主</Trans>
							</Tag>
						)}
						{reply.replyTo !== null && (
							<>
								<span className="text-ink-weak">
									<Trans context="replying to a user">回复</Trans>
								</span>
								<Link
									to={`/u/${reply.replyTo.handle}`}
									viewTransition
									className="text-ink-strong hover:underline"
								>
									{reply.replyTo.displayName}
								</Link>
							</>
						)}
					</p>
					{editing ? (
						<EditPost
							post={reply}
							bodyMax={bodyMax}
							onDone={() => setEditingFrom(undefined)}
							compact
						/>
					) : (
						<div
							className={`post-body mt-0.5${reply.bodyFormat === 'plain' ? ' post-body--plain' : ''}`}
							// The forum core has already filtered this HTML against its allowlist.
							dangerouslySetInnerHTML={{ __html: reply.bodyHtml }}
						/>
					)}
					<div className="text-ink-weak mt-0.5 flex items-center gap-2 text-meta">
						<Timestamp iso={reply.createdAt} />
						<EditedMark post={reply} />
						<a href={`#post-${reply.number}`} className="hover:text-ink-strong tabular-nums">
							#{reply.number}
						</a>
						{canReply && (
							<button
								type="button"
								className="hover:text-ink-strong cursor-pointer"
								onClick={onAnswer}
							>
								<Trans context="verb">回复</Trans>
							</button>
						)}
					</div>
				</div>
				<ActionMenu label={t`第 ${replyNumber} 楼的操作`} items={items} />
				{ext.slots}
			</div>
			<ConfirmDialog
				isOpen={confirming}
				onOpenChange={setConfirming}
				title={t`删除这条回复？`}
				confirmLabel={t`删除`}
				fields={{ intent: 'delete-post', postId: reply.id }}
			/>
		</li>
	)
}

/** The box at the end of a floor's replies that answers the floor or one reply in it. */
function AnswerInFloor({
	target,
	bodyMax,
	onCancel,
}: {
	target: PostDto
	bodyMax: number | undefined
	onCancel: () => void
}) {
	const { t } = useLingui()
	const targetName = target.author.displayName
	const navigation = useNavigation()
	const submitting =
		navigation.state === 'submitting' && navigation.formData?.get('parentId') === target.id
	const result = useActionData<{ error?: string; intent?: string; parentId?: string }>()
	const error =
		result?.intent === 'reply' && result.parentId === target.id ? result.error : undefined
	return (
		<Form method="post" className="flex flex-col gap-2 py-2">
			<input type="hidden" name="intent" value="reply" />
			<input type="hidden" name="parentId" value={target.id} />
			<FormError message={error} />
			<Composer
				label={t`回复 ${targetName}`}
				hideLabel
				required
				maxLength={bodyMax}
				rows={2}
				placeholder={t`回复 ${targetName}`}
				autoFocus
				deferRich
			/>
			<div className="flex justify-end gap-2">
				<Button tone="ghost" size="sm" onPress={onCancel}>
					<Trans>取消</Trans>
				</Button>
				<Button tone="primary" size="sm" type="submit" isPending={submitting}>
					<Trans context="verb">回复</Trans>
				</Button>
			</div>
		</Form>
	)
}

function EditPost({
	post,
	bodyMax,
	onDone,
	compact = false,
}: {
	post: PostDto
	bodyMax: number | undefined
	onDone: () => void
	/** Inside a floor's replies: no padding of its own. */
	compact?: boolean
}) {
	const { t } = useLingui()
	const navigation = useNavigation()
	const submitting =
		navigation.state === 'submitting' && navigation.formData?.get('postId') === post.id
	const result = useActionData<{ error?: string; postId?: string }>()
	const error = result?.postId === post.id ? result.error : undefined
	return (
		<Form
			method="post"
			className={`flex flex-col gap-3 ${compact ? 'py-2' : 'px-4 pt-3 pb-5 lg:px-5'}`}
		>
			<FormError message={error} />
			<input type="hidden" name="intent" value="edit-post" />
			<input type="hidden" name="postId" value={post.id} />
			<Composer
				label={t`编辑内容`}
				hideLabel
				required
				maxLength={bodyMax}
				defaultValue={post.body}
				// Only a Markdown rendering can tell whether the rich editor would change the post.
				renderedHtml={post.bodyFormat === 'markdown' ? post.bodyHtml : undefined}
				rows={Math.min(16, Math.max(4, post.body.split('\n').length + 1))}
				autoFocus
			/>
			<div className="flex justify-end gap-2">
				<Button tone="ghost" onPress={onDone}>
					<Trans>取消</Trans>
				</Button>
				<Button tone="primary" type="submit" isPending={submitting}>
					<Trans>保存</Trans>
				</Button>
			</div>
		</Form>
	)
}
