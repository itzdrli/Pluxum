import type { CategoryDto, ThreadDto } from '@forum/domain'
import { Hash, Lock, MessageSquare, Pin } from 'lucide-react'
import { Link } from 'react-router'

import { Tag, Timestamp } from '../ui/display'
import { UserAvatar } from './user-avatar'

function Stat({ value, label }: { value: number; label: string }) {
	return (
		<div className="flex min-w-12 flex-col items-end">
			<span className="text-ink-strong text-[14px] tabular-nums">{value}</span>
			<span className="text-ink-weak text-[12px]">{label}</span>
		</div>
	)
}

/** One category in the list on the home page; the whole row is the link. */
export function CategoryRow({ category }: { category: CategoryDto }) {
	return (
		<li>
			<Link
				to={`/c/${category.slug}`}
				prefetch="intent"
				className="hover:bg-hover active:bg-pressed flex items-center gap-3 px-4 py-3"
			>
				<span
					aria-hidden
					className="bg-control text-ink-weak flex size-9 shrink-0 items-center justify-center rounded-[2px]"
				>
					<Hash size={16} />
				</span>
				<div className="min-w-0 flex-1">
					<p className="text-ink-strong text-[14px] font-bold break-words">{category.name}</p>
					{category.description !== '' && (
						<p className="text-ink-weak mt-0.5 break-words">{category.description}</p>
					)}
					{/* Narrow screens: counts move under the description. */}
					<p className="text-ink-weak mt-1 text-[12px] tabular-nums sm:hidden">
						{category.threadCount} 主题 · {category.postCount} 帖子
					</p>
				</div>
				<div className="hidden shrink-0 gap-4 sm:flex">
					<Stat value={category.threadCount} label="主题" />
					<Stat value={category.postCount} label="帖子" />
				</div>
			</Link>
		</li>
	)
}

/** Pinned / locked markers of a thread. */
export function ThreadFlags({ thread }: { thread: Pick<ThreadDto, 'pinned' | 'locked'> }) {
	return (
		<>
			{thread.pinned && (
				<Tag tone="accent" icon={Pin}>
					置顶
				</Tag>
			)}
			{thread.locked && <Tag icon={Lock}>已锁定</Tag>}
		</>
	)
}

/** One thread in a category's list; adapts via `@container/threads` between wide and split-pane widths. */
export function ThreadRow({
	thread,
	categorySlug,
	categoryPage = 1,
	isActive = false,
}: {
	thread: ThreadDto
	categorySlug?: string
	categoryPage?: number
	isActive?: boolean
}) {
	const cpageQuery = categoryPage > 1 ? `?cpage=${categoryPage}` : ''
	const href =
		categorySlug !== undefined
			? `/c/${categorySlug}/t/${thread.id}${cpageQuery}`
			: `/t/${thread.id}`
	return (
		<li
			className={`hover:bg-hover relative flex items-start gap-3 border-l-2 px-3 py-2.5 transition-colors @lg/threads:px-4 @lg/threads:py-3 ${
				isActive ? 'border-l-accent bg-selected' : 'border-l-transparent'
			}`}
		>
			<div className="hidden shrink-0 @lg/threads:block">
				<UserAvatar user={thread.author} />
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
					<ThreadFlags thread={thread} />
					{/* The link's box covers the row, so the whole row is clickable. */}
					<Link
						to={href}
						prefetch="intent"
						aria-current={isActive ? 'page' : undefined}
						className="text-ink-strong line-clamp-2 text-[13px] font-bold break-words after:absolute after:inset-0 @lg/threads:line-clamp-none @lg/threads:text-[14px]"
					>
						{thread.title}
					</Link>
				</div>
				<div className="text-ink-weak mt-1 flex items-center justify-between gap-2 text-[12px]">
					<p className="flex min-w-0 flex-wrap items-center gap-x-1.5">
						{/* Above the row link's box, so the name opens the profile instead. */}
						<Link
							to={`/u/${thread.author.id}`}
							className="text-ink relative z-10 truncate hover:underline"
						>
							{thread.author.displayName}
						</Link>
						<span aria-hidden>·</span>
						<Timestamp iso={thread.lastPostAt} className="@lg/threads:hidden" />
						<Timestamp iso={thread.createdAt} className="hidden @lg/threads:inline" />
					</p>
					<span className="flex shrink-0 items-center gap-1 tabular-nums @lg/threads:hidden">
						<MessageSquare aria-hidden size={12} />
						{thread.replyCount}
					</span>
				</div>
			</div>
			<div className="hidden shrink-0 flex-col items-end gap-1 text-[12px] @lg/threads:flex">
				<span className="text-ink-strong flex items-center gap-1 tabular-nums">
					<MessageSquare aria-hidden size={13} className="text-ink-weak" />
					{thread.replyCount}
					<span className="sr-only">回复</span>
				</span>
				<span className="text-ink-weak">
					<span className="sr-only">最后回复 </span>
					<Timestamp iso={thread.lastPostAt} />
				</span>
			</div>
		</li>
	)
}
