import type { UserProfileDto } from '@pluxum/domain'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useRevalidator, useRouteLoaderData } from 'react-router'
import type { I18n } from '@lingui/core'
import { t as tm } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'

import { Button } from '../../components/ui/button'
import { FormError, Notice, Panel, SectionLabel, Timestamp } from '../../components/ui/display'
import { TextInputField } from '../../components/ui/field'
import { apiErrorTextOfBody } from '../../lib/api-errors'
import type { loader as rootLoader } from '../../root'

type Account = Readonly<{ email: string; createdAt: string; passwordChangedAt: string }>
type Me = Readonly<{ account: Account | null; passwordMin: number }>
type Editing = 'email' | 'password' | 'delete' | null

function isAccount(value: unknown): value is Account {
	return (
		typeof value === 'object' &&
		value !== null &&
		'email' in value &&
		typeof value.email === 'string' &&
		'createdAt' in value &&
		typeof value.createdAt === 'string' &&
		'passwordChangedAt' in value &&
		typeof value.passwordChangedAt === 'string'
	)
}

function isMe(value: unknown): value is Me {
	return (
		typeof value === 'object' &&
		value !== null &&
		'account' in value &&
		(value.account === null || isAccount(value.account)) &&
		'passwordMin' in value &&
		typeof value.passwordMin === 'number'
	)
}

type Outcome = Readonly<{ ok: true; body: unknown }> | Readonly<{ ok: false; error: string }>

/** One call to Forum Accounts through the web app's API proxy, which passes the cookie both ways. */
async function call(i18n: I18n, path: string, input?: unknown): Promise<Outcome> {
	try {
		const response = await fetch(
			`/api/forum/accounts${path}`,
			input === undefined
				? { headers: { accept: 'application/json' } }
				: {
						method: 'POST',
						headers: { 'content-type': 'application/json', accept: 'application/json' },
						body: JSON.stringify(input),
					},
		)
		const body: unknown = await response.json().catch(() => null)
		if (response.ok) return { ok: true, body }
		return {
			ok: false,
			error: apiErrorTextOfBody(i18n, body) ?? tm(i18n)`操作失败，请稍后再试。`,
		}
	} catch {
		return { ok: false, error: tm(i18n)`网络错误，请稍后再试。` }
	}
}

function text(form: FormData, name: string): string {
	const value = form.get(name)
	return typeof value === 'string' ? value : ''
}

/**
 * `user.profile.tabs` (own profile, email-and-password accounts only): the address, the password
 * and deleting the account. Each change asks for the current password.
 */
export function AccountSettings({ profile }: { profile: UserProfileDto }) {
	const { t, i18n } = useLingui()
	const viewer = useRouteLoaderData<typeof rootLoader>('root')?.meta?.viewer
	const isSelf = viewer?.user?.id === profile.user.id
	const revalidator = useRevalidator()
	const [me, setMe] = useState<Me | null>(null)
	const [editing, setEditing] = useState<Editing>(null)
	const [error, setError] = useState<string | undefined>()
	const [done, setDone] = useState<string | undefined>()
	const [busy, setBusy] = useState(false)

	useEffect(() => {
		if (!isSelf) return undefined
		let live = true
		void (async () => {
			const outcome = await call(i18n, '/me')
			if (live && outcome.ok && isMe(outcome.body)) setMe(outcome.body)
		})()
		return () => {
			live = false
		}
	}, [isSelf, i18n])

	// Signed in through the identity provider: its account settings live there.
	if (!isSelf || me === null || me.account === null) return null
	const account = me.account

	const open = (next: Editing) => {
		setEditing(next)
		setError(undefined)
		setDone(undefined)
	}

	async function submit(event: FormEvent<HTMLFormElement>, path: string, input: unknown) {
		event.preventDefault()
		setBusy(true)
		setError(undefined)
		const outcome = await call(i18n, path, input)
		setBusy(false)
		if (!outcome.ok) {
			setError(outcome.error)
			return null
		}
		return outcome.body
	}

	async function changeEmail(event: FormEvent<HTMLFormElement>) {
		const form = new FormData(event.currentTarget)
		const body = await submit(event, '/email', {
			email: text(form, 'email'),
			password: text(form, 'password'),
		})
		if (body === null) return
		const next =
			typeof body === 'object' && body !== null && 'account' in body ? body.account : null
		if (isAccount(next)) setMe({ account: next, passwordMin: me?.passwordMin ?? 8 })
		setEditing(null)
		setDone(t`邮箱已更换`)
	}

	async function changePassword(event: FormEvent<HTMLFormElement>) {
		const form = new FormData(event.currentTarget)
		const body = await submit(event, '/password', {
			current: text(form, 'current'),
			password: text(form, 'password'),
		})
		if (body === null) return
		setMe({
			account: { ...account, passwordChangedAt: new Date().toISOString() },
			passwordMin: me?.passwordMin ?? 8,
		})
		setEditing(null)
		setDone(t`密码已修改，其他设备已退出`)
		void revalidator.revalidate()
	}

	async function deleteAccount(event: FormEvent<HTMLFormElement>) {
		const form = new FormData(event.currentTarget)
		const body = await submit(event, '/delete', { password: text(form, 'password') })
		// The session is gone: a full load shows the forum signed out.
		if (body !== null) window.location.assign('/')
	}

	const actions = (label: ReactNode, tone: 'primary' | 'danger' = 'primary') => (
		<div className="flex justify-end gap-2">
			<Button tone="ghost" onPress={() => open(null)} isDisabled={busy}>
				<Trans>取消</Trans>
			</Button>
			<Button tone={tone} type="submit" isPending={busy}>
				{label}
			</Button>
		</div>
	)

	return (
		<section aria-labelledby="account-settings-heading">
			<SectionLabel>
				<span id="account-settings-heading">
					<Trans>登录账号</Trans>
				</span>
			</SectionLabel>
			<Panel className="divide-line flex flex-col divide-y">
				{done !== undefined && (
					<div className="px-4 py-3">
						<Notice tone="success">{done}</Notice>
					</div>
				)}

				{editing === 'email' ? (
					<form className="flex flex-col gap-3 px-4 py-3" onSubmit={(e) => void changeEmail(e)}>
						<FormError message={error} />
						<TextInputField
							name="email"
							type="email"
							label={t`新邮箱`}
							autoComplete="email"
							required
							maxLength={254}
							defaultValue={account.email}
							autoFocus
						/>
						<TextInputField
							name="password"
							type="password"
							label={t`当前密码`}
							autoComplete="current-password"
							required
							maxLength={256}
						/>
						{actions(<Trans>保存</Trans>)}
					</form>
				) : (
					<Row label={t`邮箱`}>
						<span className="text-ink min-w-0 flex-1 truncate">{account.email}</span>
						<Button tone="ghost" size="sm" onPress={() => open('email')}>
							<Trans>更换</Trans>
						</Button>
					</Row>
				)}

				{editing === 'password' ? (
					<form className="flex flex-col gap-3 px-4 py-3" onSubmit={(e) => void changePassword(e)}>
						<FormError message={error} />
						<TextInputField
							name="current"
							type="password"
							label={t`当前密码`}
							autoComplete="current-password"
							required
							maxLength={256}
							autoFocus
						/>
						<TextInputField
							name="password"
							type="password"
							label={t`新密码`}
							autoComplete="new-password"
							required
							minLength={me.passwordMin}
							maxLength={256}
						/>
						{actions(<Trans>修改密码</Trans>)}
					</form>
				) : (
					<Row label={t`密码`}>
						<span className="text-ink-weak min-w-0 flex-1 text-meta">
							<Trans>修改于</Trans> <Timestamp iso={account.passwordChangedAt} />
						</span>
						<Button tone="ghost" size="sm" onPress={() => open('password')}>
							<Trans>修改</Trans>
						</Button>
					</Row>
				)}

				{editing === 'delete' ? (
					<form className="flex flex-col gap-3 px-4 py-3" onSubmit={(e) => void deleteAccount(e)}>
						<p className="text-ink">
							<Trans>注销后无法恢复。发过的内容会保留，署名改为「已注销用户」。</Trans>
						</p>
						<FormError message={error} />
						<TextInputField
							name="password"
							type="password"
							label={t`当前密码`}
							autoComplete="current-password"
							required
							maxLength={256}
							autoFocus
						/>
						{actions(<Trans>注销账号</Trans>, 'danger')}
					</form>
				) : (
					<div className="flex justify-end px-4 py-2">
						<Button tone="ghost" size="sm" className="text-danger" onPress={() => open('delete')}>
							<Trans>注销账号</Trans>
						</Button>
					</div>
				)}
			</Panel>
		</section>
	)
}

function Row({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex min-h-12 items-center gap-3 px-4 py-2">
			<span className="text-ink-weak w-12 shrink-0 text-meta">{label}</span>
			{children}
		</div>
	)
}
