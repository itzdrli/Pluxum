import type { MetaDto } from '@forum/domain'
import { Dropdown } from '@heroui/react'
import { ChevronDown, LogIn, LogOut, MonitorSmartphone } from 'lucide-react'
import { useRef } from 'react'

import { ButtonAnchor } from '../ui/button'
import { Avatar, Tag } from '../ui/display'

const ROLE_LABELS = { guest: '游客', member: '成员', moderator: '版主', admin: '管理员' } as const

/** Login link, or the signed-in account with its menu. */
export function UserMenu({ meta, here }: { meta: MetaDto | null; here: string }) {
	const user = meta?.viewer.user
	if (!user) {
		if (!meta?.auth.loginAvailable) {
			return (
				<span data-testid="viewer" className="text-ink-weak text-[12px]">
					未登录
				</span>
			)
		}
		// A document navigation, not a client-side one: the API redirects to the identity provider.
		return (
			<ButtonAnchor
				data-testid="viewer"
				href={`/api/forum/auth/login?returnTo=${encodeURIComponent(here)}`}
				tone="primary"
				size="sm"
			>
				<LogIn aria-hidden />
				登录
			</ButtonAnchor>
		)
	}
	// Roles are listed weakest first; the strongest one is shown.
	const role = meta.viewer.roles.at(-1)
	return <AccountMenu name={user.displayName} role={role} />
}

function AccountMenu({ name, role }: { name: string; role: keyof typeof ROLE_LABELS | undefined }) {
	// Logging out is a plain form post to the API, which answers with a redirect. The menu items
	// submit these forms, so it stays a full navigation that clears the session cookie.
	const logout = useRef<HTMLFormElement>(null)
	const logoutAll = useRef<HTMLFormElement>(null)
	return (
		<>
			<form ref={logout} method="post" action="/api/forum/auth/logout" hidden />
			<form ref={logoutAll} method="post" action="/api/forum/auth/logout-all" hidden />
			<Dropdown>
				<Dropdown.Trigger
					data-testid="viewer"
					className="text-ink hover:bg-hover active:bg-pressed flex h-8 items-center gap-2 rounded-[2px] px-1.5 outline-none data-[focus-visible=true]:outline-2 data-[focus-visible=true]:outline-[var(--c-accent)]"
				>
					<Avatar name={name} size="sm" />
					<span className="hidden max-w-32 truncate sm:inline">{name}</span>
					{role !== undefined && role !== 'member' && role !== 'guest' && (
						<span className="hidden sm:inline-flex">
							<Tag tone="accent">{ROLE_LABELS[role]}</Tag>
						</span>
					)}
					<ChevronDown aria-hidden size={14} className="text-ink-weak" />
				</Dropdown.Trigger>
				<Dropdown.Popover placement="bottom end" className="min-w-48">
					<div className="border-line border-b px-3 py-2">
						<p className="text-ink-strong truncate font-bold">{name}</p>
						{role !== undefined && <p className="text-ink-weak text-[12px]">{ROLE_LABELS[role]}</p>}
					</div>
					<Dropdown.Menu
						aria-label="账号"
						onAction={(key) => {
							if (key === 'logout') logout.current?.requestSubmit()
							if (key === 'logout-all') logoutAll.current?.requestSubmit()
						}}
					>
						<Dropdown.Item id="logout" textValue="退出">
							<LogOut aria-hidden size={14} />
							退出
						</Dropdown.Item>
						<Dropdown.Item id="logout-all" textValue="退出所有设备">
							<MonitorSmartphone aria-hidden size={14} />
							退出所有设备
						</Dropdown.Item>
					</Dropdown.Menu>
				</Dropdown.Popover>
			</Dropdown>
		</>
	)
}
