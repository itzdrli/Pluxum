import type { MetaDto } from '@pluxum/domain'
import { Bell } from 'lucide-react'
import { Link, useLocation, useRouteLoaderData } from 'react-router'

import type { loader as rootLoader } from '../../root'

export function formatUnreadBadge(count: number): string | null {
	if (!Number.isFinite(count) || count <= 0) return null
	return count > 99 ? '99+' : String(Math.floor(count))
}

/**
 * `shell.actions`: top-bar notification bell with unread badge. Mounted only while
 * `forum-notifications` is running and shown only when a user is signed in.
 */
export function NotificationBell({ meta }: { meta: MetaDto | null }) {
	const root = useRouteLoaderData<typeof rootLoader>('root')
	const location = useLocation()
	const user = meta?.viewer.user ?? root?.meta?.viewer.user
	if (!user) return null

	const unread = root?.unreadNotifications ?? 0
	const badge = formatUnreadBadge(unread)
	const active = location.pathname === '/notifications'
	const label = unread > 0 ? `通知（${unread} 条未读）` : '通知'

	return (
		<Link
			to="/notifications"
			data-testid="notification-bell"
			aria-label={label}
			title={label}
			className={`relative flex h-8 items-center gap-1.5 rounded-[2px] px-2 outline-none data-[focus-visible=true]:outline-2 data-[focus-visible=true]:outline-[var(--c-accent)] ${
				active
					? 'bg-selected text-ink-strong'
					: 'text-ink-weak hover:bg-hover hover:text-ink-strong active:bg-pressed'
			}`}
		>
			<Bell aria-hidden size={15} />
			{badge !== null && (
				<span
					data-testid="notification-unread-badge"
					className="bg-accent text-page inline-flex h-4 min-w-4 items-center justify-center rounded-[2px] px-1 text-micro leading-none font-bold tabular-nums"
				>
					{badge}
				</span>
			)}
		</Link>
	)
}
