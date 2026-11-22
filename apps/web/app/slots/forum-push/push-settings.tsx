import type { UserProfileDto } from '@pluxum/domain'
import { useEffect, useState } from 'react'
import { useRouteLoaderData } from 'react-router'
import { Trans, useLingui } from '@lingui/react/macro'

import { Button } from '../../components/ui/button'
import { FormError, Panel, SectionLabel } from '../../components/ui/display'
import type { loader as rootLoader } from '../../root'

const BASE = '/api/forum/ext/forum-push'

type PushState = Readonly<{ publicKey: string | null; subscribed: boolean }>

function isPushState(value: unknown): value is PushState {
	return (
		typeof value === 'object' &&
		value !== null &&
		'publicKey' in value &&
		(value.publicKey === null || typeof value.publicKey === 'string') &&
		'subscribed' in value &&
		typeof value.subscribed === 'boolean'
	)
}

async function call(action: string, input?: unknown): Promise<unknown> {
	const response = await fetch(
		`${BASE}/${action}`,
		input === undefined
			? { headers: { accept: 'application/json' } }
			: {
					method: 'POST',
					headers: { 'content-type': 'application/json', accept: 'application/json' },
					body: JSON.stringify(input),
				},
	)
	if (!response.ok) throw new Error(`push ${action}: ${response.status}`)
	return response.json()
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
	const base64 = base64url.replaceAll('-', '+').replaceAll('_', '/')
	const raw = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
	const bytes = new Uint8Array(new ArrayBuffer(raw.length))
	for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index)
	return bytes
}

function sameKey(subscription: PushSubscription, publicKey: string): boolean {
	const current = subscription.options.applicationServerKey
	if (current === null) return false
	const a = new Uint8Array(current)
	const b = keyBytes(publicKey)
	return a.length === b.length && a.every((byte, index) => byte === b[index])
}

/** What this browser can do: push, push once added to the home screen (iOS), or nothing. */
type Support = 'yes' | 'install' | 'no'

function supportOf(): Support {
	if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window)
		return 'yes'
	// iOS Safari has Web Push only for a forum added to the home screen.
	const ios = /iP(hone|ad|od)/.test(navigator.userAgent)
	return ios ? 'install' : 'no'
}

type View =
	| Readonly<{ kind: 'loading' }>
	| Readonly<{ kind: 'off-site' }>
	| Readonly<{ kind: 'unsupported'; support: Exclude<Support, 'yes'> }>
	| Readonly<{
			kind: 'ready'
			publicKey: string
			subscription: PushSubscription | null
			subscribed: boolean
	  }>

/** `user.profile.tabs` (own profile only): push notices on this device. */
export function PushSettings({ profile }: { profile: UserProfileDto }) {
	const { t, i18n } = useLingui()
	const viewer = useRouteLoaderData<typeof rootLoader>('root')?.meta?.viewer
	const isSelf = viewer?.user?.id === profile.user.id
	const [view, setView] = useState<View>({ kind: 'loading' })
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | undefined>()
	const [tested, setTested] = useState(false)

	useEffect(() => {
		if (!isSelf) return undefined
		let live = true
		void (async () => {
			const support = supportOf()
			if (support !== 'yes') {
				if (live) setView({ kind: 'unsupported', support })
				return
			}
			try {
				const registration = await navigator.serviceWorker.ready
				const subscription = await registration.pushManager.getSubscription()
				const query =
					subscription === null ? '' : `?endpoint=${encodeURIComponent(subscription.endpoint)}`
				const state = await call(`state${query}`)
				if (!live) return
				if (!isPushState(state) || state.publicKey === null) {
					setView({ kind: 'off-site' })
					return
				}
				const current =
					subscription !== null && sameKey(subscription, state.publicKey) ? subscription : null
				setView({
					kind: 'ready',
					publicKey: state.publicKey,
					subscription: current,
					subscribed: current !== null && state.subscribed && Notification.permission === 'granted',
				})
			} catch {
				if (live) setView({ kind: 'off-site' })
			}
		})()
		return () => {
			live = false
		}
	}, [isSelf])

	if (!isSelf || view.kind === 'loading' || view.kind === 'off-site') return null

	async function turnOn(publicKey: string) {
		const permission = await Notification.requestPermission()
		if (permission !== 'granted') {
			setError(t`浏览器已拒绝通知权限`)
			return
		}
		const registration = await navigator.serviceWorker.ready
		// A subscription made with another server key (the key changed) cannot be used.
		const old = await registration.pushManager.getSubscription()
		if (old !== null && !sameKey(old, publicKey)) await old.unsubscribe()
		const subscription = await registration.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: keyBytes(publicKey),
		})
		const keys = subscription.toJSON().keys ?? {}
		await call('subscribe', {
			endpoint: subscription.endpoint,
			p256dh: keys.p256dh ?? '',
			auth: keys.auth ?? '',
			locale: i18n.locale === 'en' ? 'en' : 'zh-CN',
		})
		setView({ kind: 'ready', publicKey, subscription, subscribed: true })
	}

	async function turnOff(publicKey: string, subscription: PushSubscription | null) {
		if (subscription !== null) {
			await call('unsubscribe', { endpoint: subscription.endpoint })
			await subscription.unsubscribe()
		}
		setView({ kind: 'ready', publicKey, subscription: null, subscribed: false })
	}

	async function toggle(on: boolean) {
		if (view.kind !== 'ready') return
		setBusy(true)
		setError(undefined)
		setTested(false)
		try {
			if (on) await turnOn(view.publicKey)
			else await turnOff(view.publicKey, view.subscription)
		} catch {
			setError(t`操作失败，请稍后再试。`)
		} finally {
			setBusy(false)
		}
	}

	async function test() {
		if (view.kind !== 'ready' || view.subscription === null) return
		setBusy(true)
		setError(undefined)
		try {
			const result = await call('test', { endpoint: view.subscription.endpoint })
			const sent =
				typeof result === 'object' && result !== null && 'sent' in result && result.sent === true
			if (sent) setTested(true)
			else setError(t`推送服务未接收，请稍后再试。`)
		} catch {
			setError(t`操作失败，请稍后再试。`)
		} finally {
			setBusy(false)
		}
	}

	return (
		<section aria-labelledby="push-settings-heading">
			<SectionLabel>
				<span id="push-settings-heading">
					<Trans>推送通知</Trans>
				</span>
			</SectionLabel>
			<Panel className="flex flex-col gap-3 px-4 py-3">
				<FormError message={error} />
				{view.kind === 'unsupported' ? (
					<p className="text-ink-weak">
						{view.support === 'install' ? (
							<Trans>添加到主屏幕后可开启</Trans>
						) : (
							<Trans>此浏览器不支持推送</Trans>
						)}
					</p>
				) : (
					<div className="flex flex-wrap items-center justify-between gap-2">
						<label className="flex cursor-pointer items-center gap-2.5">
							<input
								type="checkbox"
								className="accent-accent size-4"
								checked={view.subscribed}
								disabled={busy}
								onChange={(event) => void toggle(event.currentTarget.checked)}
							/>
							<span>
								<Trans>在这台设备上推送通知</Trans>
							</span>
						</label>
						{view.subscribed && (
							<Button tone="ghost" size="sm" isDisabled={busy} onPress={() => void test()}>
								{tested ? <Trans>已发送</Trans> : <Trans>发送测试</Trans>}
							</Button>
						)}
					</div>
				)}
			</Panel>
		</section>
	)
}
