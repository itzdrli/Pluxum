import type { UserProfileDto } from '@pluxum/domain'
import { Mail, MailX } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouteLoaderData } from 'react-router'
import type { I18n } from '@lingui/core'
import { t as tm } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { apiErrorTextOfBody } from '../../lib/api-errors'

import { FormError, Panel, SectionLabel } from '../../components/ui/display'
import { NativeSelect } from '../../components/ui/field'
import { isLocaleId, LOCALES, type LocaleId } from '../../lib/locale'
import type { loader as rootLoader } from '../../root'

const EXT_ID = 'forum-mail'
const MAIL_QUERY = [EXT_ID, 'address'] as const

type MailState = Readonly<{
	available: boolean
	email: string | null
	enabled: boolean
	locale: LocaleId | null
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
		typeof value.enabled === 'boolean' &&
		'locale' in value &&
		(value.locale === null || isLocaleId(value.locale))
	)
}

type Outcome = Readonly<{ ok: true; state: MailState }> | Readonly<{ ok: false; error: string }>

async function call(i18n: I18n, action: string, input?: unknown): Promise<Outcome> {
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
		const message = apiErrorTextOfBody(i18n, body) ?? tm(i18n)`操作失败，请稍后再试。`
		return { ok: false, error: message }
	} catch {
		return { ok: false, error: tm(i18n)`网络错误，请稍后再试。` }
	}
}

/**
 * `user.profile.tabs` (own profile only): whether notifications are mailed. The forum keeps no
 * address of its own; mail goes to the one the sign-in provider gives, so it is changed there.
 */
export function MailSettings({ profile }: { profile: UserProfileDto }) {
	const { t, i18n } = useLingui()
	const viewer = useRouteLoaderData<typeof rootLoader>('root')?.meta?.viewer
	const isSelf = viewer?.user?.id === profile.user.id
	const queryClient = useQueryClient()
	const loaded = useQuery({
		queryKey: MAIL_QUERY,
		queryFn: async () => {
			const outcome = await call(i18n, 'address')
			if (!outcome.ok) throw new Error(outcome.error)
			return outcome.state
		},
		enabled: isSelf,
	})
	const preference = useMutation({
		mutationFn: async (input: { enabled: boolean } | { locale: LocaleId | null }) => {
			const outcome = await call(i18n, 'preference', input)
			if (!outcome.ok) throw new Error(outcome.error)
			return outcome.state
		},
		onSuccess: (next) => queryClient.setQueryData(MAIL_QUERY, next),
	})
	const state = loaded.data
	const busy = preference.isPending
	const error = preference.error?.message

	// Mail is off forum-wide: nothing to choose.
	if (!isSelf || state === undefined || !state.available) return null
	const email = state.email
	const updatePreference = (input: { enabled: boolean } | { locale: LocaleId | null }) =>
		preference.mutate(input)

	return (
		<section aria-labelledby="mail-settings-heading">
			<SectionLabel>
				<span id="mail-settings-heading">
					<Trans>邮件提醒</Trans>
				</span>
			</SectionLabel>
			<Panel className="flex flex-col gap-3 px-4 py-3">
				<FormError message={error} />
				{state.email === null ? (
					<p className="text-ink-weak flex items-start gap-2">
						<MailX aria-hidden className="mt-0.5 size-4 shrink-0" />
						<span>
							<Trans>登录账号没有已验证的邮箱，收不到邮件提醒。</Trans>
						</span>
					</p>
				) : (
					<>
						<label className="flex cursor-pointer items-center gap-2.5">
							<input
								type="checkbox"
								className="accent-accent size-4"
								checked={state.enabled}
								disabled={busy}
								onChange={(event) => updatePreference({ enabled: event.currentTarget.checked })}
							/>
							<span>
								<Trans>有人回复或提到我时发邮件给我</Trans>
							</span>
						</label>
						<label className="text-ink flex flex-wrap items-center gap-2.5">
							<span>{t`邮件语言`}</span>
							<NativeSelect
								value={state.locale ?? ''}
								disabled={busy}
								onChange={(event) => {
									const value = event.currentTarget.value
									if (value === '' || isLocaleId(value)) {
										updatePreference({ locale: value === '' ? null : value })
									}
								}}
							>
								<option value="">{t`站点默认语言`}</option>
								{LOCALES.map(({ id, label }) => (
									<option key={id} value={id} lang={id}>
										{label}
									</option>
								))}
							</NativeSelect>
						</label>
						<p className="text-ink-weak text-meta flex items-start gap-1.5">
							<Mail aria-hidden className="mt-[0.2em] size-3.5 shrink-0" />
							<span>
								<Trans>
									发到 <span className="text-ink break-all">{email}</span>
								</Trans>
							</span>
						</p>
					</>
				)}
			</Panel>
		</section>
	)
}
