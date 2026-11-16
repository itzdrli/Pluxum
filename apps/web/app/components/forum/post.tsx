import type { PostDto } from '@pluxum/domain'
import { Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Form, Link, useActionData, useNavigation } from 'react-router'

import { PostSlots } from '../../slots/slots'
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
	bodyMax,
}: {
	post: PostDto
	/** Position in the thread, 1 for the opening post. */
	number: number
	byThreadAuthor: boolean
	/** The opening post goes away only with its thread, so it has no delete of its own. */
	opening: boolean
	bodyMax: number | undefined
}) {
	// The edit time the editor was opened at. A saved edit comes back with a new one, which closes it.
	const [editingFrom, setEditingFrom] = useState<string | null | undefined>(undefined)
	const editing = editingFrom !== undefined && editingFrom === post.editedAt
	const setEditing = (open: boolean) => setEditingFrom(open ? post.editedAt : undefined)
	const [confirming, setConfirming] = useState(false)
	const lightbox = useLightbox()
	const items: MenuItem[] = []
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
			id={`post-${post.id}`}
			className={`border-line bg-panel group scroll-mt-16 rounded-[2px] border${!opening && !editing ? ' post-card-cv' : ''}`}
			// Images in the body and the attachment strip open in the viewer, all of this post's in turn.
			onClick={(event) => {
				const found = lightbox ? imagesForClick(event, event.currentTarget) : null
				if (lightbox && found) {
					event.preventDefault()
					lightbox(found.images, found.index)
				}
			}}
		>
			<div className="flex items-center gap-2.5 px-4 pt-3">
				<Link to={`/u/${post.author.id}`} tabIndex={-1} aria-hidden>
					<UserAvatar user={post.author} />
				</Link>
				<div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
					<Link
						to={`/u/${post.author.id}`}
						className="text-ink-strong truncate font-bold hover:underline"
					>
						{post.author.displayName}
					</Link>
					{byThreadAuthor && <Tag>楼主</Tag>}
					<span className="text-ink-weak flex items-center gap-1.5 text-meta">
						<Timestamp iso={post.createdAt} />
						{post.editedAt !== null && !post.deleted && (
							<span title={`编辑于 ${post.editedAt}`}>· 已编辑</span>
						)}
					</span>
				</div>
				<div className="flex items-center gap-1 opacity-100 transition-opacity sm:opacity-60 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
					<a
						href={`#post-${post.id}`}
						className="text-ink-weak hover:text-ink-strong px-1 text-meta tabular-nums"
						aria-label={`第 ${number} 楼的链接`}
					>
						#{number}
					</a>
					{!post.deleted && <PostSlots slot="post.actions" post={post} />}
					<ActionMenu label={`第 ${number} 楼的操作`} items={items} />
				</div>
			</div>
			{post.deleted ? (
				<p className="text-ink-weak px-4 pt-2 pb-4 italic">这条回复已被删除。</p>
			) : editing ? (
				<EditPost post={post} bodyMax={bodyMax} onDone={() => setEditing(false)} />
			) : (
				// The forum core has already filtered this HTML against its allowlist.
				<div
					className={`post-body px-4 pt-2 pb-4${post.bodyFormat === 'plain' ? ' post-body--plain' : ''}`}
					dangerouslySetInnerHTML={{ __html: post.bodyHtml }}
				/>
			)}
			{!post.deleted && !editing && <PostSlots slot="post.footer" post={post} />}
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
		<Form method="post" className="flex flex-col gap-2 px-4 pt-2 pb-4">
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
				<Button tone="ghost" size="sm" onPress={onDone}>
					取消
				</Button>
				<Button tone="primary" size="sm" type="submit" isPending={submitting}>
					保存
				</Button>
			</div>
		</Form>
	)
}
