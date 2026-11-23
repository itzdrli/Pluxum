import type { MetaDto, UserDto, UserProfileDto } from '@pluxum/domain'
import { MessageCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useRouteLoaderData } from 'react-router'
import { Trans, useLingui } from '@lingui/react/macro'

import { StageLink } from '../../components/stage/stage'
import { Button } from '../../components/ui/button'
import { FormError, Panel, SectionLabel } from '../../components/ui/display'
import { NativeSelect } from '../../components/ui/field'
import { apiErrorTextOfBody } from '../../lib/api-errors'
import {
	MessagesError,
	messagesApi,
	useUnreadMessages,
	type MessageAllow,
} from '../../lib/messages'
import type { loader as rootLoader } from '../../root'
import { formatUnreadBadge } from '../forum-notifications/bell'

/** `shell.actions`: the inbox of private messages, with the unread count kept live. */
export function MessagesButton({ meta }: { meta: MetaDto | null }) {
	const { t } = useLingui()
	const root = useRouteLoaderData<typeof rootLoader>('root')
	const location = useLocation()
	const signedIn = (meta?.viewer.user ?? root?.meta?.viewer.user) != null
	const unread = useUnreadMessages(signedIn)
	if (!signedIn) return null
	const badge = formatUnreadBadge(unread)
	const active = location.pathname.startsWith('/messages')
	const label = unread > 0 ? t`私信（${unread} 条未读）` : t`私信`
	return (
		<StageLink
			to="/messages"
			aria-label={label}
			title={label}
			className={`button button--ghost button--icon-only relative ${active ? 'bg-selected text-ink-strong' : 'text-ink-weak hover:text-ink-strong'}`}
		>
			<MessageCircle aria-hidden />
			{badge !== null && (
				<span
					key={badge}
					className="bg-accent text-page animate-pop-in absolute top-0.5 right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-[2px] px-1 text-micro leading-none font-bold tabular-nums"
				>
					{badge}
				</span>
			)}
		</StageLink>
	)
}

/** `user.header`: 「私信」 beside another member's name. */
export function MessageUserButton({ user, compact }: { user: UserDto; compact: boolean }) {
	const { t, i18n } = useLingui()
	const navigate = useNavigate()
	const viewer = useRouteLoaderData<typeof rootLoader>('root')?.meta?.viewer
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | undefined>()
	if (viewer?.user == null || viewer.user.id === user.id) return null

	async function start() {
		setBusy(true)
		setError(undefined)
		try {
			const { id } = await messagesApi.start(user.id)
			void navigate(`/messages/${id}`)
		} catch (failure) {
			setError(
				(failure instanceof MessagesError ? apiErrorTextOfBody(i18n, failure.body) : null) ??
					t`操作失败，请稍后再试。`,
			)
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className={`flex flex-wrap items-center gap-2 text-meta ${compact ? 'mt-1' : 'mt-3'}`}>
			<Button tone="secondary" size="sm" isPending={busy} onPress={() => void start()}>
				<MessageCircle aria-hidden />
				<Trans context="verb">私信</Trans>
			</Button>
			{error !== undefined && (
				<span role="alert" className="text-danger basis-full">
					{error}
				</span>
			)}
		</div>
	)
}

/** `user.profile.tabs` (own profile only): who may start a conversation with me. */
export function MessageSettings({ profile }: { profile: UserProfileDto }) {
	const { t, i18n } = useLingui()
	const viewer = useRouteLoaderData<typeof rootLoader>('root')?.meta?.viewer
	const isSelf = viewer?.user?.id === profile.user.id
	const [allow, setAllow] = useState<MessageAllow | null>(null)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | undefined>()

	useEffect(() => {
		if (!isSelf) return undefined
		let live = true
		void messagesApi.settings().then(
			(settings) => live && setAllow(settings.allow),
			() => undefined,
		)
		return () => {
			live = false
		}
	}, [isSelf])

	if (!isSelf || allow === null) return null

	async function change(next: MessageAllow) {
		setBusy(true)
		setError(undefined)
		try {
			setAllow((await messagesApi.setAllow(next)).allow)
		} catch (failure) {
			setError(
				(failure instanceof MessagesError ? apiErrorTextOfBody(i18n, failure.body) : null) ??
					t`操作失败，请稍后再试。`,
			)
		} finally {
			setBusy(false)
		}
	}

	return (
		<section aria-labelledby="message-settings-heading">
			<SectionLabel>
				<span id="message-settings-heading">
					<Trans>私信</Trans>
				</span>
			</SectionLabel>
			<Panel className="flex flex-col gap-3 px-4 py-3">
				<FormError message={error} />
				<label className="text-ink flex flex-wrap items-center gap-2.5">
					<span>{t`谁可以给我发私信`}</span>
					<NativeSelect
						value={allow}
						disabled={busy}
						onChange={(event) => {
							const value = event.currentTarget.value
							if (value === 'everyone' || value === 'following' || value === 'nobody')
								void change(value)
						}}
					>
						<option value="everyone">{t`所有人`}</option>
						<option value="following">{t`我关注的人`}</option>
						<option value="nobody">{t`不接收`}</option>
					</NativeSelect>
				</label>
			</Panel>
		</section>
	)
}
