import type { MetaDto, UserDto } from '@pluxum/domain'
import { Dropdown, Popover } from '@heroui/react'
import { Palette } from 'lucide-react'
import { useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { ButtonAnchor, IconButton } from '../ui/button'
import { BottomSheet } from '../ui/bottom-sheet'
import { UserAvatar } from '../forum/user-avatar'
import { NARROW_QUERY, useMediaQuery } from '../../lib/media'
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
	const narrow = useMediaQuery(NARROW_QUERY)
	// Logging out is a plain form post to the API, which answers with a redirect. The menu items
	// submit these forms, so it stays a full navigation that clears the session cookie.
	const logout = useRef<HTMLFormElement>(null)
	const logoutAll = useRef<HTMLFormElement>(null)
	const items: ReadonlyArray<{ id: string; label: string }> = [
		{ id: 'profile', label: '个人资料' },
		...(showModeration ? [{ id: 'moderation', label: '审核' }] : []),
		{ id: 'logout', label: '退出' },
		{ id: 'logout-all', label: '退出所有设备' },
	]
	const act = (key: string) => {
		if (key === 'profile') void navigate(`/u/${user.handle}`)
		if (key === 'moderation') void navigate('/moderation')
		if (key === 'logout') logout.current?.requestSubmit()
		if (key === 'logout-all') logoutAll.current?.requestSubmit()
	}
	const triggerClass =
		'hover:bg-hover active:bg-pressed size-control flex cursor-pointer items-center justify-center rounded-[2px] outline-none data-[focus-visible=true]:outline-2 data-[focus-visible=true]:outline-[var(--c-accent)] focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]'
	const header = (
		<div className="flex min-w-0 items-center gap-2.5">
			<UserAvatar user={user} />
			<div className="min-w-0">
				<p className="text-ink-strong truncate font-bold">{name}</p>
				{role !== undefined && <p className="text-ink-weak text-meta">{ROLE_LABELS[role]}</p>}
			</div>
		</div>
	)
	const forms = (
		<>
			<form ref={logout} method="post" action="/api/forum/auth/logout" hidden />
			<form ref={logoutAll} method="post" action="/api/forum/auth/logout-all" hidden />
		</>
	)

	// Phones: a bottom sheet, like every other overlay there, with rows sized for a thumb.
	if (narrow) {
		return (
			<>
				{forms}
				<NarrowAccountMenu
					label={`账号：${name}`}
					triggerClass={triggerClass}
					user={user}
					header={header}
					items={items}
					onAction={act}
				/>
			</>
		)
	}

	return (
		<>
			{forms}
			<Dropdown>
				{/* Only the avatar: name and role are inside the menu. */}
				<Dropdown.Trigger
					data-testid="viewer"
					aria-label={`账号：${name}`}
					className={triggerClass}
				>
					<UserAvatar user={user} size="lg" />
				</Dropdown.Trigger>
				<Dropdown.Popover placement="bottom end" className="min-w-52">
					<div className="border-line border-b px-3 py-2.5">{header}</div>
					<Dropdown.Menu aria-label="账号" onAction={(key) => act(String(key))}>
						{items.map((item) => (
							<Dropdown.Item key={item.id} id={item.id} textValue={item.label}>
								{item.label}
							</Dropdown.Item>
						))}
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

function NarrowAccountMenu({
	label,
	triggerClass,
	user,
	header,
	items,
	onAction,
}: {
	label: string
	triggerClass: string
	user: UserDto
	header: React.ReactNode
	items: ReadonlyArray<{ id: string; label: string }>
	onAction: (key: string) => void
}) {
	const [open, setOpen] = useState(false)
	// Close when the page changes underneath it (the profile item navigates).
	const pageKey = useLocation().key
	const [trackedPage, setTrackedPage] = useState(pageKey)
	if (trackedPage !== pageKey) {
		setTrackedPage(pageKey)
		if (open) setOpen(false)
	}
	return (
		<>
			<button
				type="button"
				data-testid="viewer"
				aria-label={label}
				aria-haspopup="dialog"
				className={triggerClass}
				onClick={() => setOpen(true)}
			>
				<UserAvatar user={user} size="lg" />
			</button>
			<BottomSheet isOpen={open} onOpenChange={setOpen} title="账号" bodyClassName="py-1">
				{(close) => (
					<>
						<div className="border-line border-b px-4 pt-2 pb-3">{header}</div>
						<ul className="divide-line divide-y">
							{items.map((item) => (
								<li key={item.id}>
									<button
										type="button"
										className="text-ink hover:bg-hover active:bg-pressed flex h-12 w-full cursor-pointer items-center px-4 text-left text-ui"
										onClick={() => {
											close()
											onAction(item.id)
										}}
									>
										{item.label}
									</button>
								</li>
							))}
						</ul>
						<div className="border-line flex items-center justify-between gap-3 border-t px-4 py-3">
							<span className="text-ink-weak text-meta">主题</span>
							<ThemeSwatches />
						</div>
					</>
				)}
			</BottomSheet>
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
