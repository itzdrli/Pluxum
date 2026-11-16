import type { MetaDto, UserDto } from '@pluxum/domain'
import { Dropdown, Popover } from '@heroui/react'
import { Palette } from 'lucide-react'
import { useRef } from 'react'
import { useNavigate } from 'react-router'

import { ButtonAnchor, IconButton } from '../ui/button'
import { UserAvatar } from '../forum/user-avatar'
import { ThemeSwatches } from './theme-picker'

const ROLE_LABELS = { guest: '游客', member: '成员', moderator: '版主', admin: '管理员' } as const

/** Login link, or the signed-in account with its menu. */
export function UserMenu({ meta, here }: { meta: MetaDto | null; here: string }) {
	const user = meta?.viewer.user
	if (!user) {
		// Guests have no account menu, and list and thread pages have no footer, so the theme
		// swatches get their own small button here.
		return (
			<>
				<GuestThemeButton />
				{meta?.auth.loginAvailable ? (
					// A document navigation, not a client-side one: the API redirects to the identity provider.
					<ButtonAnchor
						data-testid="viewer"
						href={`/api/forum/auth/login?returnTo=${encodeURIComponent(here)}`}
						tone="primary"
					>
						登录
					</ButtonAnchor>
				) : (
					<span data-testid="viewer" className="text-ink-weak text-meta">
						未登录
					</span>
				)}
			</>
		)
	}
	// Roles are listed weakest first; the strongest one is shown.
	const role = meta.viewer.roles.at(-1)
	const isStaff = meta.viewer.roles.includes('moderator') || meta.viewer.roles.includes('admin')
	const moderationActive = meta.uiSlots.some((slot) => slot.extId === 'forum-moderation')
	return <AccountMenu user={user} role={role} showModeration={isStaff && moderationActive} />
}

function AccountMenu({
	user,
	role,
	showModeration,
}: {
	user: UserDto
	role: keyof typeof ROLE_LABELS | undefined
	showModeration: boolean
}) {
	const name = user.displayName
	const navigate = useNavigate()
	// Logging out is a plain form post to the API, which answers with a redirect. The menu items
	// submit these forms, so it stays a full navigation that clears the session cookie.
	const logout = useRef<HTMLFormElement>(null)
	const logoutAll = useRef<HTMLFormElement>(null)
	return (
		<>
			<form ref={logout} method="post" action="/api/forum/auth/logout" hidden />
			<form ref={logoutAll} method="post" action="/api/forum/auth/logout-all" hidden />
			<Dropdown>
				{/* Only the avatar: name and role are inside the menu. */}
				<Dropdown.Trigger
					data-testid="viewer"
					aria-label={`账号：${name}`}
					className="hover:bg-hover active:bg-pressed size-control flex items-center justify-center rounded-[2px] outline-none data-[focus-visible=true]:outline-2 data-[focus-visible=true]:outline-[var(--c-accent)]"
				>
					<UserAvatar user={user} size="lg" />
				</Dropdown.Trigger>
				<Dropdown.Popover placement="bottom end" className="min-w-52">
					<div className="border-line flex items-center gap-2.5 border-b px-3 py-2.5">
						<UserAvatar user={user} />
						<div className="min-w-0">
							<p className="text-ink-strong truncate font-bold">{name}</p>
							{role !== undefined && <p className="text-ink-weak text-meta">{ROLE_LABELS[role]}</p>}
						</div>
					</div>
					<Dropdown.Menu
						aria-label="账号"
						onAction={(key) => {
							if (key === 'profile') void navigate(`/u/${user.handle}`)
							if (key === 'moderation') void navigate('/moderation')
							if (key === 'logout') logout.current?.requestSubmit()
							if (key === 'logout-all') logoutAll.current?.requestSubmit()
						}}
					>
						<Dropdown.Item id="profile" textValue="个人资料">
							个人资料
						</Dropdown.Item>
						{showModeration && (
							<Dropdown.Item id="moderation" textValue="审核队列">
								审核队列
							</Dropdown.Item>
						)}
						<Dropdown.Item id="logout" textValue="退出">
							退出
						</Dropdown.Item>
						<Dropdown.Item id="logout-all" textValue="退出所有设备">
							退出所有设备
						</Dropdown.Item>
					</Dropdown.Menu>
					<div className="border-line flex items-center justify-between gap-3 border-t px-3 py-2.5">
						<span className="text-ink-weak text-meta">主题</span>
						<ThemeSwatches />
					</div>
				</Dropdown.Popover>
			</Dropdown>
		</>
	)
}

function GuestThemeButton() {
	return (
		<Popover>
			<IconButton label="切换主题" className="text-ink-weak hover:text-ink-strong">
				<Palette aria-hidden />
			</IconButton>
			<Popover.Content placement="bottom end" className="p-0">
				<Popover.Dialog
					aria-label="主题"
					className="flex items-center gap-3 px-3 py-2.5 outline-none"
				>
					<span className="text-ink-weak text-meta">主题</span>
					<ThemeSwatches />
				</Popover.Dialog>
			</Popover.Content>
		</Popover>
	)
}
