import type { UserProfileDto } from '@pluxum/domain'
import { Mail, MailX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useRouteLoaderData } from 'react-router'

import { FormError, Panel, SectionLabel } from '../../components/ui/display'
import type { loader as rootLoader } from '../../root'

const EXT_ID = 'forum-mail'

type MailState = Readonly<{
	available: boolean
	email: string | null
	enabled: boolean
}>

function isMailState(value: unknown): value is MailState {
	return (
		typeof value === 'object' &&
		value !== null &&
		'available' in value &&
		typeof value.available === 'boolean' &&
		'email' in value &&
		(value.email === null || typeof value.email === 'string') &&
		'enabled' in value &&
		typeof value.enabled === 'boolean'
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

/**
 * `user.profile.tabs` (own profile only): whether notifications are mailed. The forum keeps no
 * address of its own; mail goes to the one the sign-in provider gives, so it is changed there.
 */
export function MailSettings({ profile }: { profile: UserProfileDto }) {
	const viewer = useRouteLoaderData<typeof rootLoader>('root')?.meta?.viewer
	const isSelf = viewer?.user?.id === profile.user.id
	const [state, setState] = useState<MailState | null>(null)
	const [error, setError] = useState<string | undefined>()
	const [busy, setBusy] = useState(false)

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

	// Mail is off forum-wide: nothing to choose.
	if (!isSelf || state === null || !state.available) return null

	async function toggle(enabled: boolean) {
		setBusy(true)
		setError(undefined)
		const outcome = await call('preference', { enabled })
		setBusy(false)
		if (outcome.ok) setState(outcome.state)
		else setError(outcome.error)
	}

	return (
		<section aria-labelledby="mail-settings-heading">
			<SectionLabel>
				<span id="mail-settings-heading">邮件提醒</span>
			</SectionLabel>
			<Panel className="flex flex-col gap-3 px-4 py-3">
				<FormError message={error} />
				{state.email === null ? (
					<p className="text-ink-weak flex items-start gap-2">
						<MailX aria-hidden className="mt-0.5 size-4 shrink-0" />
						<span>登录账号没有已验证的邮箱，收不到邮件提醒。</span>
					</p>
				) : (
					<>
						<label className="flex cursor-pointer items-center gap-2.5">
							<input
								type="checkbox"
								className="accent-accent size-4"
								checked={state.enabled}
								disabled={busy}
								onChange={(event) => void toggle(event.currentTarget.checked)}
							/>
							<span>有人回复或提到我时发邮件给我</span>
						</label>
						<p className="text-ink-weak text-meta flex items-start gap-1.5">
							<Mail aria-hidden className="mt-[0.2em] size-3.5 shrink-0" />
							<span>
								发到 <span className="text-ink break-all">{state.email}</span>
							</span>
						</p>
					</>
				)}
			</Panel>
		</section>
	)
}
