import type { CategoryDto, UserDto, UserProfileDto } from '@pluxum/domain'
import { BellRing, UserCheck, UserPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useFetcher, useRouteLoaderData } from 'react-router'

import { Button } from '../../components/ui/button'
import { FormError, Panel, SectionLabel } from '../../components/ui/display'
import type { loader as rootLoader } from '../../root'
import type { ExtActionResult } from '../../routes/ext-action'

const EXT_ID = 'forum-follows'

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
}: {
	followed: boolean
	onPress: () => void
	label: string
}) {
	return (
		<Button
			tone={followed ? 'secondary' : 'primary'}
			size="sm"
			aria-pressed={followed}
			{...{ title: followed ? `取消${label}` : label }}
			onPress={onPress}
		>
			{followed ? <UserCheck aria-hidden /> : <UserPlus aria-hidden />}
			{followed ? '已关注' : label}
		</Button>
	)
}

/** `user.header`: how many people a member follows and has as followers, and the follow button. */
export function UserFollow({ user, compact }: { user: UserDto; compact: boolean }) {
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
				<span className="text-ink-strong font-bold">{summary.following}</span> 关注
			</span>
			<span className="tabular-nums">
				<span className="text-ink-strong font-bold">{shown.followers}</span> 粉丝
			</span>
			{canFollow && (
				<span className={compact ? 'ml-auto' : ''}>
					<FollowButton
						followed={shown.followed}
						label="关注"
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
	const viewer = useRouteLoaderData<typeof rootLoader>('root')?.meta?.viewer
	const [loaded, setLoaded] = useState<FollowState | null>(null)
	useEffect(() => {
		let live = true
		void (async () => {
			try {
				const response = await fetch(
					`/api/forum/ext/${EXT_ID}/state?kind=category&id=${encodeURIComponent(category.id)}`,
					{ headers: { accept: 'application/json' } },
				)
				const state = response.ok ? stateOf(await response.json()) : null
				if (live && state !== null) setLoaded(state)
			} catch {
				// Without its state the button is left out; the category page works as before.
			}
		})()
		return () => {
			live = false
		}
	}, [category.id])
	const saved = loaded !== null && loaded.id === category.id ? loaded : null
	const { shown, error, toggle } = useFollow('category', category.id, saved)
	if (shown === null) return null
	const signedIn = viewer?.user != null
	if (!signedIn && shown.followers === 0) return null
	return (
		<div className="text-ink-weak mb-4 flex flex-wrap items-center gap-3 text-meta">
			{signedIn && (
				<FollowButton
					followed={shown.followed}
					label="关注版块"
					onPress={() => toggle(!shown.followed)}
				/>
			)}
			{shown.followers > 0 && <span className="tabular-nums">{shown.followers} 人关注</span>}
			{error !== undefined && (
				<span role="alert" className="text-danger">
					{error}
				</span>
			)}
		</div>
	)
}

async function callSettings(input?: {
	notify: boolean
}): Promise<Readonly<{ ok: true; notify: boolean }> | Readonly<{ ok: false; error: string }>> {
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
		return { ok: false, error: '操作失败，请稍后再试。' }
	} catch {
		return { ok: false, error: '网络错误，请稍后再试。' }
	}
}

/** `user.profile.tabs` (own profile only): whether gaining a follower sends a notice. */
export function FollowSettings({ profile }: { profile: UserProfileDto }) {
	const viewer = useRouteLoaderData<typeof rootLoader>('root')?.meta?.viewer
	const isSelf = viewer?.user?.id === profile.user.id
	const [notify, setNotify] = useState<boolean | null>(null)
	const [error, setError] = useState<string | undefined>()
	const [busy, setBusy] = useState(false)

	useEffect(() => {
		if (!isSelf) return undefined
		let live = true
		void (async () => {
			const outcome = await callSettings()
			if (live && outcome.ok) setNotify(outcome.notify)
		})()
		return () => {
			live = false
		}
	}, [isSelf])

	if (!isSelf || notify === null) return null

	async function toggle(next: boolean) {
		setBusy(true)
		setError(undefined)
		const outcome = await callSettings({ notify: next })
		setBusy(false)
		if (outcome.ok) setNotify(outcome.notify)
		else setError(outcome.error)
	}

	return (
		<section aria-labelledby="follow-settings-heading">
			<SectionLabel>
				<span id="follow-settings-heading">关注提醒</span>
			</SectionLabel>
			<Panel className="flex flex-col gap-3 px-4 py-3">
				<FormError message={error} />
				<label className="flex cursor-pointer items-center gap-2.5">
					<input
						type="checkbox"
						className="accent-accent size-4"
						checked={notify}
						disabled={busy}
						onChange={(event) => void toggle(event.currentTarget.checked)}
					/>
					<BellRing aria-hidden className="text-ink-weak size-4" />
					<span>有人关注我时通知我</span>
				</label>
			</Panel>
		</section>
	)
}
