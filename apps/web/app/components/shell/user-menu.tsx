import type { MetaDto, Role, UserDto } from '@pluxum/domain'
import { Dropdown, Popover } from '@heroui/react'
import { Trans, useLingui } from '@lingui/react/macro'
import { Ellipsis, LogIn, Palette } from 'lucide-react'
import { useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { ButtonAnchor, IconButton } from '../ui/button'
import { BottomSheet } from '../ui/bottom-sheet'
import { UserAvatar } from '../forum/user-avatar'
import { NARROW_QUERY, useMediaQuery } from '../../lib/media'
import { ROLE_LABELS } from '../../lib/roles'
import { LocaleSwitcher } from './locale-switcher'
import { ThemeSwatches } from './theme-picker'
import { loginHref } from '../../lib/login'
import { KeyboardScope } from '../ui/keyboard-scope'

/**
 * Login link, or the signed-in account with its menu. `variant="bar"` is the top bar's avatar
 * button; `variant="rail"` is the account row at the foot of the wide-screen rail (name and role
 * beside the avatar, the menu opening upwards), down to the avatar while the rail shows only icons.
 */
export function UserMenu({
	meta,
	here,
	variant = 'bar',
	collapsed = false,
}: {
	meta: MetaDto | null
	here: string
	variant?: Variant
	collapsed?: boolean
}) {
	const { t } = useLingui()
	const user = meta?.viewer.user
	if (!user) {
		const signInHref = loginHref(meta?.auth, here)
		if (variant === 'rail') {
			return (
				<div className="flex items-center gap-2 overflow-hidden px-3 py-3 rail-mini:flex-col">
					{meta?.auth.loginAvailable ? (
						<ButtonAnchor
							data-testid="viewer"
							href={signInHref}
							tone="primary"
							aria-label={t`登录`}
							className="flex-1 rail-mini:w-10 rail-mini:flex-none rail-mini:px-0"
						>
							<LogIn aria-hidden />
							<span className="rail-mini:hidden">
								<Trans>登录</Trans>
							</span>
						</ButtonAnchor>
					) : (
						<span data-testid="viewer" className="text-ink-weak flex-1 text-meta rail-mini:hidden">
							<Trans>未登录</Trans>
						</span>
					)}
					<GuestThemeButton placement={collapsed ? 'right bottom' : 'top end'} />
				</div>
			)
		}
		// Guests have no account menu, and list and thread pages have no footer, so the theme
		// swatches get their own small button here.
		return (
			<>
				<GuestThemeButton placement="bottom end" />
				{meta?.auth.loginAvailable ? (
					// A document navigation: the API may redirect to the identity provider.
					<ButtonAnchor data-testid="viewer" href={signInHref} tone="primary">
						<Trans>登录</Trans>
					</ButtonAnchor>
				) : (
					<span data-testid="viewer" className="text-ink-weak text-meta">
						<Trans>未登录</Trans>
					</span>
				)}
			</>
		)
	}
	// Roles are listed weakest first; the strongest one is shown.
	const role = meta.viewer.roles.at(-1)
	const isStaff = meta.viewer.roles.includes('moderator') || meta.viewer.roles.includes('admin')
	const moderationActive = meta.uiSlots.some((slot) => slot.extId === 'forum-moderation')
	return (
		<AccountMenu
			user={user}
			role={role}
			showModeration={isStaff && moderationActive}
			variant={variant}
			collapsed={collapsed}
		/>
	)
}

type Variant = 'bar' | 'rail'
type Placement = 'bottom end' | 'top end' | 'top start' | 'right bottom'

function AccountMenu({
	user,
	role,
	showModeration,
	variant,
	collapsed,
}: {
	user: UserDto
	role: Role | undefined
	showModeration: boolean
	variant: Variant
	collapsed: boolean
}) {
	const { t, i18n } = useLingui()
	const name = user.displayName
	const navigate = useNavigate()
	const narrow = useMediaQuery(NARROW_QUERY)
	// Logging out is a plain form post to the API, which answers with a redirect. The menu items
	// submit these forms, so it stays a full navigation that clears the session cookie.
	const logout = useRef<HTMLFormElement>(null)
	const logoutAll = useRef<HTMLFormElement>(null)
	const items: ReadonlyArray<{ id: string; label: string }> = [
		{ id: 'profile', label: t`个人资料` },
		...(showModeration ? [{ id: 'moderation', label: t`审核` }] : []),
		{ id: 'logout', label: t`退出` },
		{ id: 'logout-all', label: t`退出所有设备` },
	]
	const act = (key: string) => {
		if (key === 'profile') void navigate(`/u/${user.handle}`, { viewTransition: true })
		if (key === 'moderation') void navigate('/moderation', { viewTransition: true })
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
				{role !== undefined && (
					<p className="text-ink-weak text-meta">{i18n._(ROLE_LABELS[role])}</p>
				)}
			</div>
		</div>
	)
	const forms = (
		<>
			<form ref={logout} method="post" action="/api/forum/auth/logout" hidden />
			<form ref={logoutAll} method="post" action="/api/forum/auth/logout-all" hidden />
		</>
	)

	// Phones: a bottom sheet, like every other overlay there, with rows sized for a thumb. (The rail
	// only shows on wide screens.)
	if (narrow && variant === 'bar') {
		return (
			<>
				{forms}
				<NarrowAccountMenu
					label={t`账号：${name}`}
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
				{variant === 'rail' ? (
					// The rail's foot: who is signed in, the whole row opening the menu.
					<Dropdown.Trigger
						data-testid="viewer"
						aria-label={t`账号：${name}`}
						className="hover:bg-hover active:bg-pressed flex h-14 w-full cursor-pointer items-center gap-2.5 overflow-hidden pr-2 pl-[18px] text-left whitespace-nowrap outline-none data-[focus-visible=true]:outline-2 data-[focus-visible=true]:-outline-offset-2 data-[focus-visible=true]:outline-[var(--c-accent)]"
					>
						<UserAvatar user={user} />
						<span className="min-w-0 flex-1 leading-tight transition-opacity duration-200 rail-mini:opacity-0">
							<span className="text-ink-strong block truncate font-bold">{name}</span>
							{role !== undefined && (
								<span className="text-ink-weak block text-meta">{i18n._(ROLE_LABELS[role])}</span>
							)}
						</span>
						<Ellipsis
							aria-hidden
							size={16}
							className="text-ink-weak shrink-0 transition-opacity duration-200 rail-mini:opacity-0"
						/>
					</Dropdown.Trigger>
				) : (
					// Only the avatar: name and role are inside the menu.
					<Dropdown.Trigger
						data-testid="viewer"
						aria-label={t`账号：${name}`}
						className={triggerClass}
					>
						<UserAvatar user={user} size="lg" />
					</Dropdown.Trigger>
				)}
				<Dropdown.Popover
					placement={variant === 'bar' ? 'bottom end' : collapsed ? 'right bottom' : 'top start'}
					className="min-w-52"
				>
					<div className="border-line border-b px-3 py-2.5">{header}</div>
					<Dropdown.Menu aria-label={t`账号`} onAction={(key) => act(String(key))}>
						{items.map((item) => (
							<Dropdown.Item key={item.id} id={item.id} textValue={item.label}>
								{item.label}
							</Dropdown.Item>
						))}
					</Dropdown.Menu>
					<div className="border-line flex items-center justify-between gap-3 border-t px-3 py-2.5">
						<span className="text-ink-weak text-meta">
							<Trans context="colour theme">主题</Trans>
						</span>
						<ThemeSwatches />
					</div>
					<div className="border-line flex items-center justify-between gap-3 border-t px-3 py-2.5">
						<span className="text-ink-weak text-meta">
							<Trans>语言</Trans>
						</span>
						<LocaleSwitcher />
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
	const { t } = useLingui()
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
			<BottomSheet isOpen={open} onOpenChange={setOpen} title={t`账号`} bodyClassName="py-1">
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
							<span className="text-ink-weak text-meta">
								<Trans context="colour theme">主题</Trans>
							</span>
							<ThemeSwatches />
						</div>
						<div className="border-line flex items-center justify-between gap-3 border-t px-4 py-3">
							<span className="text-ink-weak text-meta">
								<Trans>语言</Trans>
							</span>
							<LocaleSwitcher />
						</div>
					</>
				)}
			</BottomSheet>
		</>
	)
}

function GuestThemeButton({ placement }: { placement: Placement }) {
	const { t } = useLingui()
	return (
		<Popover>
			<IconButton label={t`主题与语言`} className="text-ink-weak hover:text-ink-strong">
				<Palette aria-hidden />
			</IconButton>
			<Popover.Content placement={placement} className="p-0">
				<Popover.Dialog
					aria-label={t`主题与语言`}
					className="flex flex-col gap-2.5 px-3 py-2.5 outline-none"
				>
					<KeyboardScope>
						<div className="flex items-center justify-between gap-3">
							<span className="text-ink-weak text-meta">
								<Trans context="colour theme">主题</Trans>
							</span>
							<ThemeSwatches />
						</div>
						<div className="flex items-center justify-between gap-3">
							<span className="text-ink-weak text-meta">
								<Trans>语言</Trans>
							</span>
							<LocaleSwitcher />
						</div>
					</KeyboardScope>
				</Popover.Dialog>
			</Popover.Content>
		</Popover>
	)
}
