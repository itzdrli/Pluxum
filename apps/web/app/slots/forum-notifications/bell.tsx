import type { MetaDto, NotificationDto } from '@pluxum/domain'
import { Popover } from '@heroui/react'
import { Bell } from 'lucide-react'
import { useState } from 'react'
import { useFetcher, useLocation, useRouteLoaderData } from 'react-router'
import { Trans, useLingui } from '@lingui/react/macro'

import type { loader as rootLoader } from '../../root'
import type { loader as notificationsLoader } from '../../routes/notifications'
import { UserAvatar } from '../../components/forum/user-avatar'
import { StageLink } from '../../components/stage/stage'
import { Button } from '../../components/ui/button'
import { BottomSheet } from '../../components/ui/bottom-sheet'
import { Timestamp } from '../../components/ui/display'
import { NARROW_QUERY, useMediaQuery } from '../../lib/media'
import { resolveNotificationHref } from './href'

export function formatUnreadBadge(count: number): string | null {
	if (!Number.isFinite(count) || count <= 0) return null
	return count > 99 ? '99+' : String(Math.floor(count))
}

/**
 * `shell.actions`: top-bar notification bell with unread badge. Mounted only while
 * `forum-notifications` is running and shown only when a user is signed in. Pressing it opens the
 * latest notifications in a popover; the full list stays at `/notifications`.
 */
export function NotificationBell({ meta }: { meta: MetaDto | null }) {
	const { t } = useLingui()
	const root = useRouteLoaderData<typeof rootLoader>('root')
	const location = useLocation()
	const [open, setOpen] = useState(false)
	const narrow = useMediaQuery(NARROW_QUERY)
	// Loads the first page from the `/notifications` route loader each time the popover opens.
	const list = useFetcher<typeof notificationsLoader>({ key: 'notification-popover' })
	// Mark-read posts go to the `/notifications` action, which also revalidates the root badge.
	// This fetcher lives in the bell, which stays mounted, so a post outlives the popover closing.
	const mark = useFetcher({ key: 'notification-mark' })
	const [readIds, setReadIds] = useState<ReadonlySet<string>>(() => new Set())
	const [allRead, setAllRead] = useState(false)

	function handleOpenChange(next: boolean) {
		setOpen(next)
		if (!next) return
		setReadIds(new Set())
		setAllRead(false)
		void list.load('/notifications')
	}

	// Close the popover whenever the page changes underneath it.
	const pageKey = `${location.pathname}${location.search}`
	const [trackedPage, setTrackedPage] = useState(pageKey)
	if (trackedPage !== pageKey) {
		setTrackedPage(pageKey)
		if (open) setOpen(false)
	}

	const user = meta?.viewer.user ?? root?.meta?.viewer.user
	if (!user) return null

	const unread = root?.unreadNotifications ?? 0
	const badge = formatUnreadBadge(unread)
	const active = open || location.pathname === '/notifications'
	const label = unread > 0 ? t`通知（${unread} 条未读）` : t`通知`

	const page = list.data?.notifications ?? null
	const loading = page === null && list.state !== 'idle'
	const unavailable = page === null && list.state === 'idle' && list.data !== undefined

	function markRead(item: NotificationDto) {
		if (item.read || allRead || readIds.has(item.id)) return
		setReadIds((prev) => new Set(prev).add(item.id))
		void mark.submit(
			{ intent: 'mark-read', id: item.id },
			{ method: 'post', action: '/notifications' },
		)
	}

	function markAllRead() {
		setAllRead(true)
		void mark.submit({ intent: 'mark-all-read' }, { method: 'post', action: '/notifications' })
	}

	const unreadCount = page?.unreadCount ?? 0
	const showMarkAll = page !== null && page.unreadCount > 0 && !allRead

	const trigger = (
		<Button
			tone="ghost"
			data-testid="notification-bell"
			aria-label={label}
			className={`button--icon-only relative ${active ? 'bg-selected text-ink-strong' : 'text-ink-weak hover:text-ink-strong'}`}
			{...{ title: label }}
			{...(narrow ? { onPress: () => handleOpenChange(true) } : {})}
		>
			<Bell aria-hidden />
			{badge !== null && (
				<span
					key={badge}
					data-testid="notification-unread-badge"
					className="bg-accent text-page animate-pop-in absolute top-0.5 right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-[2px] px-1 text-micro leading-none font-bold tabular-nums"
				>
					{badge}
				</span>
			)}
		</Button>
	)

	const unreadNote = page !== null && page.unreadCount > 0 && !allRead && (
		<span className="text-ink-weak font-normal tabular-nums">{t`${unreadCount} 条未读`}</span>
	)
	const markAllButton = showMarkAll && (
		<Button tone="ghost" size="sm" onPress={markAllRead}>
			<Trans>全部已读</Trans>
		</Button>
	)
	const listBody = (
		<div className="min-h-0 flex-1 overflow-y-auto">
			{loading ? (
				<p className="text-ink-weak px-3 py-8 text-center text-ui">
					<Trans>加载中…</Trans>
				</p>
			) : unavailable ? (
				<p className="text-ink-weak px-3 py-8 text-center text-ui">
					<Trans>通知暂时无法加载。</Trans>
				</p>
			) : page !== null && page.items.length === 0 ? (
				<p className="text-ink-weak px-3 py-8 text-center text-ui">
					<Trans>暂时还没有收到通知。</Trans>
				</p>
			) : (
				page !== null && (
					<ol className="divide-line divide-y">
						{page.items.map((item) => (
							<PopoverRow
								key={item.id}
								item={item}
								read={item.read || allRead || readIds.has(item.id)}
								onOpen={() => {
									markRead(item)
									setOpen(false)
								}}
							/>
						))}
					</ol>
				)
			)}
		</div>
	)
	const allLink = (
		<StageLink
			to="/notifications"
			onClick={() => setOpen(false)}
			className="border-line text-ink-weak hover:bg-hover hover:text-ink-strong flex h-11 shrink-0 items-center justify-center border-t text-ui"
		>
			<Trans>查看全部通知</Trans>
		</StageLink>
	)

	// Phones: a bottom sheet, like every other overlay there (category switcher, reply), in thumb reach.
	if (narrow) {
		return (
			<>
				{trigger}
				<BottomSheet
					isOpen={open}
					onOpenChange={handleOpenChange}
					title={t`通知`}
					bodyClassName="flex min-h-0 flex-1 flex-col"
				>
					{(unreadNote || markAllButton) && (
						<div className="border-line flex h-11 shrink-0 items-center justify-between gap-2 border-b pr-2.5 pl-4 text-ui">
							{unreadNote || <span />}
							{markAllButton}
						</div>
					)}
					{listBody}
					{allLink}
				</BottomSheet>
			</>
		)
	}

	return (
		<Popover isOpen={open} onOpenChange={handleOpenChange}>
			{trigger}
			<Popover.Content
				placement="bottom end"
				className="w-[min(24rem,calc(100vw-1rem))] overflow-hidden p-0"
			>
				<Popover.Dialog
					aria-label={t`通知`}
					className="flex max-h-[min(32rem,70dvh)] flex-col p-0 outline-none"
				>
					<div className="border-line flex h-11 shrink-0 items-center justify-between gap-2 border-b pr-1.5 pl-3">
						<p className="text-ink-strong flex items-center gap-1.5 text-ui font-bold">
							<Trans>通知</Trans>
							{unreadNote}
						</p>
						{markAllButton}
					</div>
					{listBody}
					{allLink}
				</Popover.Dialog>
			</Popover.Content>
		</Popover>
	)
}

function PopoverRow({
	item,
	read,
	onOpen,
}: {
	item: NotificationDto
	read: boolean
	onOpen: () => void
}) {
	const { t } = useLingui()
	const href = resolveNotificationHref(item)
	const body = (
		<>
			{item.actor !== null ? (
				<span className="mt-0.5 shrink-0">
					<UserAvatar user={item.actor} size="sm" />
				</span>
			) : (
				<span
					aria-hidden
					className="border-line bg-control text-ink-weak mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-[2px] border"
				>
					<Bell size={12} />
				</span>
			)}
			<span className="min-w-0 flex-1">
				<span
					className={`line-clamp-2 text-ui leading-snug break-words ${read ? 'text-ink' : 'text-ink-strong font-bold'}`}
				>
					{item.title}
				</span>
				{item.body !== null && item.body !== '' && (
					<span className="text-ink-weak mt-0.5 line-clamp-1 text-meta break-words">
						{item.body}
					</span>
				)}
				<span className="text-ink-weak mt-1 flex items-center gap-1.5 text-meta">
					{item.actor !== null && (
						<>
							<span className="truncate">{item.actor.displayName}</span>
							<span aria-hidden>·</span>
						</>
					)}
					<Timestamp iso={item.createdAt} />
				</span>
			</span>
			{!read && (
				<span aria-label={t`未读`} className="bg-accent mt-1.5 size-2 shrink-0 rounded-full" />
			)}
		</>
	)
	const rowClass = `flex items-start gap-2.5 px-3 py-2.5 ${read ? '' : 'bg-selected/40'}`
	return (
		<li data-testid="notification-popover-row">
			{href !== null ? (
				<StageLink
					to={href}
					onClick={onOpen}
					className={`${rowClass} hover:bg-hover active:bg-pressed`}
				>
					{body}
				</StageLink>
			) : (
				<div className={rowClass}>{body}</div>
			)}
		</li>
	)
}
