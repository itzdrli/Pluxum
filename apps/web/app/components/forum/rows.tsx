import type { CategoryDto, ThreadDto } from '@pluxum/domain'
import { Fragment } from 'react'
import { Hash, Lock, MessageSquare, Pin } from 'lucide-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { StageLink } from '../stage/stage'
import { isUnread } from '../../slots/forum-reads/state'
import { Tag, Timestamp } from '../ui/display'
import { UserAvatar } from './user-avatar'
import { ThreadBadgeSlots } from '../../slots/slots'

function Stat({ value, label }: { value: number; label: string }) {
	return (
		<div className="flex min-w-12 flex-col items-end">
			<span className="text-ink-strong text-title tabular-nums">{value}</span>
			<span className="text-ink-weak text-meta">{label}</span>
		</div>
	)
}

/** One category in the list on the home page; the whole row is the link. */
export function CategoryRow({ category }: { category: CategoryDto }) {
	const { t } = useLingui()
	const threadCount = category.threadCount
	const postCount = category.postCount
	return (
		<li>
			<StageLink
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
					<p className="text-ink-strong text-title font-bold break-words">{category.name}</p>
					{category.description !== '' && (
						<p className="text-ink-weak mt-0.5 break-words">{category.description}</p>
					)}
					{/* Narrow screens: counts move under the description. */}
					<p className="text-ink-weak mt-1 text-meta tabular-nums sm:hidden">
						{t`${threadCount} 主题`} · {t`${postCount} 帖子`}
					</p>
				</div>
				<div className="hidden shrink-0 gap-4 sm:flex">
					<Stat value={category.threadCount} label={t({ message: '主题', context: 'thread' })} />
					<Stat value={category.postCount} label={t`帖子`} />
				</div>
			</StageLink>
		</li>
	)
}

/** A dot before the title of a thread with activity the viewer has not read. */
export function UnreadDot({
	thread,
	hidden = false,
	className = 'mr-2',
}: {
	thread: Pick<ThreadDto, 'ext' | 'lastPostAt'>
	hidden?: boolean
	/** Where it sits: by default inline before a title. */
	className?: string
}) {
	const { t } = useLingui()
	if (hidden || !isUnread(thread)) return null
	return (
		// Inline in the title's text, so it stays on the title's first line however long the title.
		<span
			role="img"
			aria-label={t`有未读内容`}
			title={t`有未读内容`}
			className={`bg-accent mb-px inline-block size-2 shrink-0 rounded-full align-middle ${className}`}
		/>
	)
}

/**
 * Pinned / locked markers of a thread, then the tags of running extensions (「已解决」).
 * `tagClassName` places the own ones, e.g. inline before a title.
 */
export function ThreadFlags({
	thread,
	tagClassName,
}: {
	thread: ThreadDto
	tagClassName?: string
}) {
	return (
		<>
			{thread.pinned && (
				<Tag tone="accent" icon={Pin} className={tagClassName}>
					<Trans>置顶</Trans>
				</Tag>
			)}
			{thread.locked && (
				<Tag icon={Lock} className={tagClassName}>
					<Trans>已锁定</Trans>
				</Tag>
			)}
			<ThreadBadgeSlots thread={thread} tagClassName={tagClassName} />
		</>
	)
}

/**
 * One thread in a list; adapts via `@container/threads` between wide and split-pane widths.
 * `href` comes from the list's stage (`useStageLinks().detail`), so the thread opens beside it.
 * Lists that mix categories (the overview, a profile) pass `category`, shown as a link in the meta
 * line; a profile's list hides the author it is all by. `time` is the one moment the row shows: the
 * latest activity unless the list is ordered by when threads started.
 */
export function ThreadRow({
	thread,
	href,
	isActive = false,
	category,
	showAuthor = true,
	time = 'last',
}: {
	thread: ThreadDto
	href: string
	isActive?: boolean
	category?: Pick<CategoryDto, 'slug' | 'name'>
	showAuthor?: boolean
	time?: 'last' | 'created'
}) {
	const { t } = useLingui()
	const shownTime = time === 'created' ? thread.createdAt : thread.lastPostAt
	const noteAuthor = thread.author.displayName
	const meta = [
		showAuthor && (
			// Above the row link's box, so the name opens the profile instead.
			<StageLink
				key="author"
				to={`/u/${thread.author.handle}`}
				className="text-ink relative z-10 min-w-0 truncate hover:underline"
			>
				{thread.author.displayName}
			</StageLink>
		),
		category !== undefined && (
			<StageLink
				key="category"
				to={`/c/${category.slug}`}
				prefetch="intent"
				className="hover:text-ink-strong relative z-10 max-w-32 shrink-0 truncate hover:underline"
			>
				{category.name}
			</StageLink>
		),
	].filter((item) => item !== false)
	return (
		<li
			className={`hover:bg-hover relative flex items-start gap-4 border-l-2 px-5 py-4 transition-colors ${
				isActive ? 'border-l-accent bg-selected' : 'border-l-transparent'
			}`}
		>
			{showAuthor && (
				<div className="hidden shrink-0 @lg/threads:block">
					<UserAvatar user={thread.author} />
				</div>
			)}
			<div className="min-w-0 flex-1">
				{/* Dot, flags and title share one line of text, so markers never sit on a line of their own.
				    Two lines at most at every width: a title without spaces would otherwise fill the row. */}
				<p className="line-clamp-2 [overflow-wrap:anywhere]">
					<UnreadDot thread={thread} hidden={isActive} />
					<ThreadFlags thread={thread} tagClassName="mr-2 align-[1px]" />
					{/* The link's box covers the row, so the whole row is clickable. */}
					<StageLink
						to={href}
						prefetch="intent"
						data-thread-link
						aria-current={isActive ? 'page' : undefined}
						title={thread.kind === 'note' ? undefined : thread.title}
						className="text-ink-strong text-ui font-bold after:absolute after:inset-0 @lg/threads:text-title"
					>
						{thread.kind === 'note' ? t`${noteAuthor} 的动态` : thread.title}
					</StageLink>
				</p>
				<div className="text-ink-weak mt-1.5 flex items-center justify-between gap-3 text-meta">
					<p className="flex min-w-0 items-center gap-x-2">
						{meta.map((item, index) => (
							<Fragment key={item.key}>
								{index > 0 && (
									<span aria-hidden className="shrink-0">
										·
									</span>
								)}
								{item}
							</Fragment>
						))}
						{/* Wide rows show the moment in the right column instead. */}
						{meta.length > 0 && (
							<span aria-hidden className="shrink-0 @lg/threads:hidden">
								·
							</span>
						)}
						<Timestamp iso={shownTime} className="shrink-0 whitespace-nowrap @lg/threads:hidden" />
					</p>
					<span className="flex shrink-0 items-center gap-1 tabular-nums @lg/threads:hidden">
						<MessageSquare aria-hidden size={12} />
						{thread.replyCount}
						<span className="sr-only">
							<Trans context="noun">回复</Trans>
						</span>
					</span>
				</div>
			</div>
			<div className="hidden shrink-0 flex-col items-end gap-1 text-meta @lg/threads:flex">
				<span className="text-ink-strong flex items-center gap-1 tabular-nums">
					<MessageSquare aria-hidden size={13} className="text-ink-weak" />
					{thread.replyCount}
					<span className="sr-only">
						<Trans context="noun">回复</Trans>
					</span>
				</span>
				<span className="text-ink-weak whitespace-nowrap">
					{time === 'last' && (
						<span className="sr-only">
							<Trans>最后回复</Trans>{' '}
						</span>
					)}
					<Timestamp iso={shownTime} />
				</span>
			</div>
		</li>
	)
}
