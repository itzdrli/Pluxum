import type { CategoryDto, ThreadDto } from '@forum/domain'
import { Hash, Lock, MessageSquare, Pin } from 'lucide-react'
import { Link } from 'react-router'

import { Avatar, Tag, Timestamp } from '../ui/display'

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

/** One thread in a category's list. */
export function ThreadRow({ thread }: { thread: ThreadDto }) {
	return (
		<li className="hover:bg-hover relative flex items-start gap-3 px-4 py-3">
			<Avatar name={thread.author.displayName} />
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
					<ThreadFlags thread={thread} />
					{/* The link's box covers the row, so the whole row is clickable. */}
					<Link
						to={`/t/${thread.id}`}
						className="text-ink-strong text-[14px] font-bold break-words after:absolute after:inset-0"
					>
						{thread.title}
					</Link>
				</div>
				<p className="text-ink-weak mt-1 flex flex-wrap items-center gap-x-1.5 text-[12px]">
					<span className="text-ink">{thread.author.displayName}</span>
					<span aria-hidden>·</span>
					<Timestamp iso={thread.createdAt} />
					<span className="flex items-center gap-1 tabular-nums sm:hidden">
						<span aria-hidden>·</span>
						<MessageSquare aria-hidden size={12} />
						{thread.replyCount}
					</span>
				</p>
			</div>
			<div className="hidden shrink-0 flex-col items-end gap-1 text-[12px] sm:flex">
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
