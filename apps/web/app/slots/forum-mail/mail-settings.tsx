import type { UserProfileDto } from '@pluxum/domain'
import { Mail, MailCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useRouteLoaderData } from 'react-router'

import { Button } from '../../components/ui/button'
import { FormError, Notice, Panel, SectionLabel, Tag } from '../../components/ui/display'
import type { loader as rootLoader } from '../../root'

const EXT_ID = 'forum-mail'

type MailState = Readonly<{
	available: boolean
	email: string | null
	verified: boolean
	enabled: boolean
	pending: boolean
}>

function isMailState(value: unknown): value is MailState {
	return (
		typeof value === 'object' &&
		value !== null &&
		'available' in value &&
		typeof value.available === 'boolean' &&
		'email' in value &&
		(value.email === null || typeof value.email === 'string') &&
		'verified' in value &&
		typeof value.verified === 'boolean' &&
		'enabled' in value &&
		typeof value.enabled === 'boolean' &&
		'pending' in value &&
		typeof value.pending === 'boolean'
	)
}

type Outcome = Readonly<{ ok: true; state: MailState }> | Readonly<{ ok: false; error: string }>

async function call(action: string, input?: unknown): Promise<Outcome> {
	try {
		const response = await fetch(
			`/api/forum/ext/${EXT_ID}/${action}`,
			input === undefined
				? { headers: { accept: 'application/json' } }
				: {
						method: 'POST',
						headers: { 'content-type': 'application/json', accept: 'application/json' },
						body: JSON.stringify(input),
					},
		)
		const body: unknown = await response.json().catch(() => null)
		if (response.ok && isMailState(body)) return { ok: true, state: body }
		const message =
			typeof body === 'object' &&
			body !== null &&
			'error' in body &&
			typeof body.error === 'object' &&
			body.error !== null &&
			'message' in body.error &&
			typeof body.error.message === 'string'
				? body.error.message
				: '操作失败，请稍后再试。'
		return { ok: false, error: message }
	} catch {
		return { ok: false, error: '网络错误，请稍后再试。' }
	}
}

const INPUT =
	'border-line bg-page text-ink-strong placeholder:text-ink-weak/60 hover:border-ink-weak focus:border-accent h-control w-full rounded-[2px] border px-2.5 text-ui outline-none'

/**
 * `user.profile.tabs` (own profile only): the address notifications are mailed to. Entering one
 * sends a six-digit code; mail starts once the code is confirmed, and can be switched off or the
 * address removed at any time.
 */
export function MailSettings({ profile }: { profile: UserProfileDto }) {
	const viewer = useRouteLoaderData<typeof rootLoader>('root')?.meta?.viewer
	const isSelf = viewer?.user?.id === profile.user.id
	const [state, setState] = useState<MailState | null>(null)
	const [error, setError] = useState<string | undefined>()
	const [busy, setBusy] = useState(false)
	const [editing, setEditing] = useState(false)
	const [email, setEmail] = useState('')
	const [code, setCode] = useState('')

	useEffect(() => {
		if (!isSelf) return undefined
		let live = true
		void (async () => {
			const outcome = await call('address')
			if (live && outcome.ok) setState(outcome.state)
		})()
		return () => {
			live = false
		}
	}, [isSelf])

	if (!isSelf || state === null) return null
	// Mail is off forum-wide and nothing was ever set up: nothing to show.
	if (!state.available && state.email === null) return null

	async function run(action: string, input: unknown, after?: () => void) {
		setBusy(true)
		setError(undefined)
		const outcome = await call(action, input)
		setBusy(false)
		if (!outcome.ok) {
			setError(outcome.error)
			return
		}
		setState(outcome.state)
		after?.()
	}

	const askForCode = (address: string) =>
		run('set-address', { email: address }, () => {
			setEditing(false)
			setCode('')
		})

	const showForm = state.email === null || editing

	return (
		<section aria-labelledby="mail-settings-heading">
			<SectionLabel>
				<span id="mail-settings-heading">邮件通知</span>
			</SectionLabel>
			<Panel className="flex flex-col gap-3 px-4 py-3">
				{!state.available && (
					<Notice tone="warning">论坛暂时没有开启邮件，现在不会收到邮件。</Notice>
				)}
				<FormError message={error} />

				{state.email !== null && !editing && (
					<div className="flex flex-wrap items-center gap-2">
						{state.verified ? (
							<Tag tone="success" icon={MailCheck}>
								已验证
							</Tag>
						) : (
							<Tag icon={Mail}>待验证</Tag>
						)}
						<span className="text-ink-strong min-w-0 break-all">{state.email}</span>
						<span className="ml-auto flex gap-1">
							<Button
								tone="ghost"
								size="sm"
								isDisabled={busy}
								onPress={() => {
									setEmail(state.email ?? '')
									setEditing(true)
								}}
							>
								更换
							</Button>
							<Button
								tone="ghost"
								size="sm"
								isDisabled={busy}
								onPress={() => void run('remove', {})}
							>
								移除
							</Button>
						</span>
					</div>
				)}

				{state.email !== null && !editing && state.verified && (
					<label className="flex cursor-pointer items-center gap-2.5">
						<input
							type="checkbox"
							className="accent-accent size-4"
							checked={state.enabled}
							disabled={busy}
							onChange={(event) => void run('preference', { enabled: event.currentTarget.checked })}
						/>
						<span>有人回复或提到我时发邮件给我</span>
					</label>
				)}

				{state.email !== null && !editing && !state.verified && (
					<form
						className="flex flex-col gap-2"
						onSubmit={(event) => {
							event.preventDefault()
							void run('verify', { code: code.trim() })
						}}
					>
						<p className="text-ink-weak text-meta">
							{state.pending
								? '验证码已发到这个邮箱，30 分钟内有效。输入后才会开始收到通知。'
								: '验证码已失效，请重新获取。'}
						</p>
						<div className="flex flex-wrap items-center gap-2">
							{state.pending && (
								<>
									<input
										type="text"
										inputMode="numeric"
										autoComplete="one-time-code"
										pattern="\d{6}"
										maxLength={6}
										value={code}
										onChange={(event) => setCode(event.currentTarget.value.replaceAll(/\D/g, ''))}
										placeholder="6 位验证码"
										aria-label="验证码"
										className={`${INPUT} max-w-36`}
									/>
									<Button
										tone="primary"
										size="md"
										type="submit"
										isPending={busy}
										isDisabled={code.length !== 6 || busy}
									>
										验证
									</Button>
								</>
							)}
							<Button
								tone="ghost"
								size="md"
								isDisabled={busy || !state.available}
								onPress={() => void askForCode(state.email ?? '')}
							>
								重新发送
							</Button>
						</div>
					</form>
				)}

				{showForm && (
					<form
						className="flex flex-col gap-2"
						onSubmit={(event) => {
							event.preventDefault()
							void askForCode(email)
						}}
					>
						<p className="text-ink-weak text-meta">
							填写邮箱后会收到一封验证码邮件，验证后有人回复或提到你时会发邮件提醒。邮箱只用于通知，不会公开。
						</p>
						<div className="flex flex-wrap items-center gap-2">
							<input
								type="email"
								autoComplete="email"
								required
								maxLength={254}
								value={email}
								onChange={(event) => setEmail(event.currentTarget.value)}
								placeholder="you@example.com"
								aria-label="邮箱地址"
								className={`${INPUT} min-w-0 flex-1 basis-56`}
							/>
							<Button
								tone="primary"
								size="md"
								type="submit"
								isPending={busy}
								isDisabled={email.trim() === '' || busy || !state.available}
							>
								发送验证码
							</Button>
							{editing && (
								<Button tone="ghost" size="md" isDisabled={busy} onPress={() => setEditing(false)}>
									取消
								</Button>
							)}
						</div>
					</form>
				)}
			</Panel>
		</section>
	)
}
