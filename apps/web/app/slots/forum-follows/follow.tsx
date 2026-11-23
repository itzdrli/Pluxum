import type { CategoryDto, UserDto, UserProfileDto } from '@pluxum/domain'
import { BellRing, UserCheck, UserPlus } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useFetcher, useRouteLoaderData } from 'react-router'
import type { I18n } from '@lingui/core'
import { t as tm } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'

import { Button } from '../../components/ui/button'
import { FormError, Panel, SectionLabel } from '../../components/ui/display'
import { getForumJson } from '../../lib/query'
import type { loader as rootLoader } from '../../root'
import type { ExtActionResult } from '../../routes/ext-action'

const EXT_ID = 'forum-follows'
const SETTINGS_QUERY = [EXT_ID, 'settings'] as const

type Summary = Readonly<{ followers: number; following: number; followed: boolean }>
type FollowState = Readonly<{ id: string; followed: boolean; followers: number }>

const isCount = (value: unknown): value is number =>
	typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** The plugin's data on a user. It crosses the API untyped, so its shape is checked here. */
function summaryOf(value: unknown): Summary | null {
	if (typeof value !== 'object' || value === null) return null
	if (!('followers' in value && 'following' in value && 'followed' in value)) return null
	const { followers, following, followed } = value
	return isCount(followers) && isCount(following) && typeof followed === 'boolean'
		? { followers, following, followed }
		: null
}

function stateOf(value: unknown): FollowState | null {
	if (typeof value !== 'object' || value === null) return null
	if (!('id' in value && 'followed' in value && 'followers' in value)) return null
	const { id, followed, followers } = value
	return typeof id === 'string' && typeof followed === 'boolean' && isCount(followers)
		? { id, followed, followers }
		: null
}

/**
 * Following one person or category: what is shown is the saved state, then the answer of the last
 * request (a hover card keeps its data, so the page reloading behind it is not enough), then,
 * while a request is on its way, the state it asks for.
 */
function useFollow(kind: 'user' | 'category', id: string, saved: FollowState | null) {
	const fetcher = useFetcher<ExtActionResult>()
	const answered = fetcher.data?.ok === true ? stateOf(fetcher.data.value) : null
	let shown = answered !== null && answered.id === id ? answered : saved
	const pending: unknown = fetcher.json
	const asked =
		typeof pending === 'object' && pending !== null && 'on' in pending
			? pending.on === true
			: undefined
	if (shown !== null && asked !== undefined && asked !== shown.followed) {
		shown = {
			...shown,
			followed: asked,
			followers: Math.max(0, shown.followers + (asked ? 1 : -1)),
		}
	}
	const error =
		fetcher.state === 'idle' && fetcher.data?.ok === false ? fetcher.data.error : undefined
	const toggle = (on: boolean) =>
		fetcher.submit(
			{ kind, id, on },
			{ method: 'post', action: `/ext/${EXT_ID}/follow`, encType: 'application/json' },
		)
	return { shown, error, toggle }
}

function FollowButton({
	followed,
	onPress,
	label,
	unfollowLabel,
}: {
	followed: boolean
	onPress: () => void
	label: string
	/** Names the undo, e.g. 取消关注; a separate message because words cannot be glued per language. */
	unfollowLabel: string
}) {
	const { t } = useLingui()
	return (
		<Button
			tone={followed ? 'secondary' : 'primary'}
			size="sm"
			aria-pressed={followed}
			{...{ title: followed ? unfollowLabel : label }}
			onPress={onPress}
		>
			{followed ? <UserCheck aria-hidden /> : <UserPlus aria-hidden />}
			{followed ? t`已关注` : label}
		</Button>
	)
}

/** `user.header`: how many people a member follows and has as followers, and the follow button. */
export function UserFollow({ user, compact }: { user: UserDto; compact: boolean }) {
	const { t } = useLingui()
	const viewer = useRouteLoaderData<typeof rootLoader>('root')?.meta?.viewer
	const summary = summaryOf(user.ext?.[EXT_ID])
	const { shown, error, toggle } = useFollow(
		'user',
		user.id,
		summary === null ? null : { id: user.id, ...summary },
	)
	if (summary === null || shown === null) return null
	const canFollow = viewer?.user != null && viewer.user.id !== user.id
	return (
		<div
			className={`text-ink-weak flex flex-wrap items-center gap-x-3 gap-y-2 text-meta ${compact ? 'mt-1' : 'mt-3'}`}
		>
			<span className="tabular-nums">
				<span className="text-ink-strong font-bold">{summary.following}</span>{' '}
				<Trans context="count of people one follows">关注</Trans>
			</span>
			<span className="tabular-nums">
				<span className="text-ink-strong font-bold">{shown.followers}</span> <Trans>粉丝</Trans>
			</span>
			{canFollow && (
				<span className={compact ? 'ml-auto' : ''}>
					<FollowButton
						followed={shown.followed}
						label={t({ message: '关注', context: 'verb' })}
						unfollowLabel={t`取消关注`}
						onPress={() => toggle(!shown.followed)}
					/>
				</span>
			)}
			{error !== undefined && (
				<span role="alert" className="text-danger basis-full">
					{error}
				</span>
			)}
		</div>
	)
}

/** `category.header`: follow a category, so its new threads come up in 「关注」. */
export function CategoryFollow({ category }: { category: CategoryDto }) {
	const { t } = useLingui()
	const viewer = useRouteLoaderData<typeof rootLoader>('root')?.meta?.viewer
	// Without its state the button is left out; the category page works as before.
	const loaded = useQuery({
		queryKey: [EXT_ID, 'state', 'category', category.id],
		queryFn: async ({ signal }) =>
			stateOf(
				await getForumJson(
					`/ext/${EXT_ID}/state?kind=category&id=${encodeURIComponent(category.id)}`,
					signal,
				),
			),
	})
	const saved = loaded.data?.id === category.id ? loaded.data : null
	const { shown, error, toggle } = useFollow('category', category.id, saved)
	if (shown === null) return null
	const signedIn = viewer?.user != null
	if (!signedIn && shown.followers === 0) return null
	const followers = shown.followers
	return (
		<div className="text-ink-weak mb-4 flex flex-wrap items-center gap-3 text-meta">
			{signedIn && (
				<FollowButton
					followed={shown.followed}
					label={t`关注版块`}
					unfollowLabel={t`取消关注版块`}
					onPress={() => toggle(!shown.followed)}
				/>
			)}
			{shown.followers > 0 && <span className="tabular-nums">{t`${followers} 人关注`}</span>}
			{error !== undefined && (
				<span role="alert" className="text-danger">
					{error}
				</span>
			)}
		</div>
	)
}

async function callSettings(
	i18n: I18n,
	input?: {
		notify: boolean
	},
): Promise<Readonly<{ ok: true; notify: boolean }> | Readonly<{ ok: false; error: string }>> {
	try {
		const response = await fetch(
			`/api/forum/ext/${EXT_ID}/${input === undefined ? 'settings' : 'preference'}`,
			input === undefined
				? { headers: { accept: 'application/json' } }
				: {
						method: 'POST',
						headers: { 'content-type': 'application/json', accept: 'application/json' },
						body: JSON.stringify(input),
					},
		)
		const body: unknown = await response.json().catch(() => null)
		if (
			response.ok &&
			typeof body === 'object' &&
			body !== null &&
			'notify' in body &&
			typeof body.notify === 'boolean'
		) {
			return { ok: true, notify: body.notify }
		}
		return { ok: false, error: tm(i18n)`操作失败，请稍后再试。` }
	} catch {
		return { ok: false, error: tm(i18n)`网络错误，请稍后再试。` }
	}
}

/** `user.profile.tabs` (own profile only): whether gaining a follower sends a notice. */
export function FollowSettings({ profile }: { profile: UserProfileDto }) {
	const { i18n } = useLingui()
	const viewer = useRouteLoaderData<typeof rootLoader>('root')?.meta?.viewer
	const isSelf = viewer?.user?.id === profile.user.id
	const queryClient = useQueryClient()
	const loaded = useQuery({
		queryKey: SETTINGS_QUERY,
		queryFn: async () => {
			const outcome = await callSettings(i18n)
			if (!outcome.ok) throw new Error(outcome.error)
			return outcome.notify
		},
		enabled: isSelf,
	})
	const preference = useMutation({
		mutationFn: async (next: boolean) => {
			const outcome = await callSettings(i18n, { notify: next })
			if (!outcome.ok) throw new Error(outcome.error)
			return outcome.notify
		},
		onSuccess: (next) => queryClient.setQueryData(SETTINGS_QUERY, next),
	})
	const notify = loaded.data
	const busy = preference.isPending
	const error = preference.error?.message

	if (!isSelf || notify === undefined) return null
	const toggle = (next: boolean) => preference.mutate(next)

	return (
		<section aria-labelledby="follow-settings-heading">
			<SectionLabel>
				<span id="follow-settings-heading">
					<Trans>关注提醒</Trans>
				</span>
			</SectionLabel>
			<Panel className="flex flex-col gap-3 px-4 py-3">
				<FormError message={error} />
				<label className="flex cursor-pointer items-center gap-2.5">
					<input
						type="checkbox"
						className="accent-accent size-4"
						checked={notify}
						disabled={busy}
						onChange={(event) => toggle(event.currentTarget.checked)}
					/>
					<BellRing aria-hidden className="text-ink-weak size-4" />
					<span>
						<Trans>有人关注我时通知我</Trans>
					</span>
				</label>
			</Panel>
		</section>
	)
}
