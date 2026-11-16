import type { PostDto } from '@pluxum/domain'
import { Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Form, Link, useActionData, useNavigation } from 'react-router'

import { withoutLeadingTitle } from '../../lib/post-html'
import { PostFooterSlots, usePostMenuSlots } from '../../slots/slots'
import { Composer } from '../composer/composer'
import { Button } from '../ui/button'
import { FormError, Tag, Timestamp } from '../ui/display'
import { imagesForClick, useLightbox } from '../ui/lightbox'
import { ActionMenu, ConfirmDialog, type MenuItem } from '../ui/overlay'
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
}) {
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
			label: '复制本楼链接',
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
		items.push({ id: 'edit', label: '编辑', icon: Pencil, onAction: () => setEditing(true) })
	}
	if (!post.deleted && post.can.delete && !opening) {
		items.push({
			id: 'delete',
			label: '删除',
			icon: Trash2,
			danger: true,
			onAction: () => setConfirming(true),
		})
	}
	return (
		<li
			id={`post-${post.number}`}
			// Phones: an edge-to-edge list divided by lines; wide screens: one panel per post.
			className={`border-line-soft bg-panel group scroll-mt-16 border-b lg:rounded-[4px] lg:border-b-0${!opening && !editing ? ' post-card-cv' : ''}`}
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
				<Link to={`/u/${post.author.handle}`} tabIndex={-1} aria-hidden>
					<UserAvatar user={post.author} />
				</Link>
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 items-center gap-2">
						<Link
							to={`/u/${post.author.handle}`}
							className="text-ink-strong truncate font-bold hover:underline"
						>
							{post.author.displayName}
						</Link>
						{byThreadAuthor && <Tag>楼主</Tag>}
					</div>
					<div className="text-ink-weak flex items-center gap-1.5 text-meta">
						<Timestamp iso={post.createdAt} />
						{post.editedAt !== null && !post.deleted && (
							<span title={`编辑于 ${post.editedAt}`}>· 已编辑</span>
						)}
						<span aria-hidden>·</span>
						<a
							href={`#post-${post.number}`}
							className="hover:text-ink-strong tabular-nums"
							aria-label={`第 ${number} 楼的链接`}
						>
							#{number}
						</a>
						{copied && <span role="status">· 已复制链接</span>}
					</div>
				</div>
				<ActionMenu label={`第 ${number} 楼的操作`} items={items} />
				{ext.slots}
			</div>
			{post.deleted ? (
				<p className="text-ink-weak px-4 pt-3 pb-5 italic lg:px-5">这条回复已被删除。</p>
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
			<ConfirmDialog
				isOpen={confirming}
				onOpenChange={setConfirming}
				title="删除这条回复？"
				body="删除后其他人只能看到“这条回复已被删除”。"
				confirmLabel="删除"
				fields={{ intent: 'delete-post', postId: post.id }}
			/>
		</li>
	)
}

function EditPost({
	post,
	bodyMax,
	onDone,
}: {
	post: PostDto
	bodyMax: number | undefined
	onDone: () => void
}) {
	const navigation = useNavigation()
	const submitting =
		navigation.state === 'submitting' && navigation.formData?.get('postId') === post.id
	const result = useActionData<{ error?: string; postId?: string }>()
	const error = result?.postId === post.id ? result.error : undefined
	return (
		<Form method="post" className="flex flex-col gap-3 px-4 pt-3 pb-5 lg:px-5">
			<FormError message={error} />
			<input type="hidden" name="intent" value="edit-post" />
			<input type="hidden" name="postId" value={post.id} />
			<Composer
				label="编辑内容"
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
					取消
				</Button>
				<Button tone="primary" type="submit" isPending={submitting}>
					保存
				</Button>
			</div>
		</Form>
	)
}
