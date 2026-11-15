import type { NotificationDto } from '@pluxum/domain'
import { Bell, BellOff, Check, CheckCheck, ExternalLink, LogIn } from 'lucide-react'
import { data, Form, Link, useFetcher, useNavigation } from 'react-router'

import type { Route } from './+types/notifications'
import { UserAvatar } from '../components/forum/user-avatar'
import { Button, ButtonAnchor, ButtonLink } from '../components/ui/button'
import {
	EmptyState,
	FormError,
	PageHeader,
	Panel,
	SectionLabel,
	Tag,
	Timestamp,
} from '../components/ui/display'
import { Pager } from '../components/ui/pager'
import { forumApi, orThrow, pageParam, textField } from '../lib/forum-api.server'
import { keepOnThemeChange } from '../lib/revalidate'

export type ParsedNotificationsUrl = Readonly<{
	unreadOnly: boolean
	page: number
}>

/** Extracts filter and pagination state from a `/notifications` URL. */
export function parseNotificationsUrl(url: URL): ParsedNotificationsUrl {
	const rawUnread = url.searchParams.get('unread') ?? url.searchParams.get('unreadOnly')
	const rawPage = url.searchParams.get('page') ?? ''
	return {
		unreadOnly: rawUnread === '1' || rawUnread === 'true',
		page: /^[1-9]\d{0,5}$/.test(rawPage) ? Number(rawPage) : 1,
	}
}

/** Resolves a safe internal destination link for a notification item. */
export function resolveNotificationHref(
	item: Pick<NotificationDto, 'path' | 'threadId' | 'postId'>,
): string | null {
	if (item.path !== null && item.path.startsWith('/') && !item.path.startsWith('//')) {
		return item.path
	}
	if (item.threadId !== null) {
		return item.postId !== null ? `/t/${item.threadId}#post-${item.postId}` : `/t/${item.threadId}`
	}
	return null
}

export function meta(): Route.MetaDescriptors {
	return [{ title: '通知 · Pluxum' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	const forumMeta = orThrow(await forumApi.meta(request))
	const { unreadOnly } = parseNotificationsUrl(new URL(request.url))
	const page = pageParam(request)
	const slotEnabled = forumMeta.uiSlots.some(
		(slot) => slot.slot === 'shell.actions' && slot.extId === 'forum-notifications',
	)

	if (!slotEnabled) {
		return {
			available: false as const,
			loggedIn: forumMeta.viewer.user !== null,
			loginAvailable: forumMeta.auth.loginAvailable,
			unreadOnly,
			notifications: null,
		}
	}

	if (forumMeta.viewer.user === null) {
		return {
			available: true as const,
			loggedIn: false as const,
			loginAvailable: forumMeta.auth.loginAvailable,
			unreadOnly,
			notifications: null,
		}
	}

	const result = await forumApi.notifications(request, { page, unreadOnly })
	if (!result.ok) {
		if (result.status === 404 || result.error.code === 'unavailable') {
			return {
				available: false as const,
				loggedIn: true as const,
				loginAvailable: forumMeta.auth.loginAvailable,
				unreadOnly,
				notifications: null,
			}
		}
		if (result.status === 401 || result.error.code === 'unauthenticated') {
			return {
				available: true as const,
				loggedIn: false as const,
				loginAvailable: forumMeta.auth.loginAvailable,
				unreadOnly,
				notifications: null,
			}
		}
		orThrow(result)
	}

	return {
		available: true as const,
		loggedIn: true as const,
		loginAvailable: forumMeta.auth.loginAvailable,
		unreadOnly,
		notifications: result.ok ? result.value : null,
	}
}

type ActionResponse =
	| Readonly<{ ok: true; error?: undefined }>
	| Readonly<{ ok: false; error: string }>

export async function action({ request }: Route.ActionArgs) {
	const form = await request.formData()
	const intent = textField(form, 'intent')

	if (intent === 'mark-all-read') {
		const result = await forumApi.markAllNotificationsRead(request)
		if (!result.ok) {
			const failure: ActionResponse = { ok: false, error: result.error.message }
			return data(failure, { status: result.status })
		}
		const success: ActionResponse = { ok: true }
		return success
	}

	if (intent === 'mark-read') {
		const id = textField(form, 'id')
		const result = await forumApi.markNotificationRead(request, id)
		if (!result.ok) {
			const failure: ActionResponse = { ok: false, error: result.error.message }
			return data(failure, { status: result.status })
		}
		const success: ActionResponse = { ok: true }
		return success
	}

	const failure: ActionResponse = { ok: false, error: '不支持的通知操作' }
	return data(failure, { status: 400 })
}

export const shouldRevalidate = keepOnThemeChange

export default function NotificationsRoute({ loaderData, actionData }: Route.ComponentProps) {
	const { available, loggedIn, loginAvailable, unreadOnly, notifications } = loaderData
	const navigation = useNavigation()
	const isMarkingAll =
		navigation.state === 'submitting' && navigation.formData?.get('intent') === 'mark-all-read'

	if (!available) {
		return (
			<>
				<PageHeader title="通知" description="查看收到的话题回复与站内消息。" />
				<EmptyState
					icon={BellOff}
					title="通知功能未启用"
					hint="站内通知插件当前处于停用状态，请稍后再试。"
				/>
			</>
		)
	}

	if (!loggedIn || notifications === null) {
		return (
			<>
				<PageHeader title="通知" description="查看收到的话题回复与站内消息。" />
				<EmptyState
					icon={LogIn}
					title="请先登录"
					hint="登录后即可查看收到的话题回复与站内通知。"
					action={
						loginAvailable ? (
							<ButtonAnchor
								href="/api/forum/auth/login?returnTo=%2Fnotifications"
								tone="primary"
								size="sm"
							>
								<LogIn aria-hidden />
								登录
							</ButtonAnchor>
						) : undefined
					}
				/>
			</>
		)
	}

	return (
		<>
			<PageHeader
				title="通知"
				description="查看收到的话题回复与站内消息。"
				actions={
					<div className="flex flex-wrap items-center gap-2">
						<div
							role="group"
							aria-label="通知筛选"
							className="border-line bg-panel inline-flex rounded-[2px] border p-0.5 text-[12px]"
						>
							<Link
								to="/notifications"
								className={`rounded-[2px] px-2.5 py-1 ${
									!unreadOnly
										? 'bg-selected text-ink-strong font-bold'
										: 'text-ink-weak hover:text-ink-strong'
								}`}
							>
								全部
							</Link>
							<Link
								to="/notifications?unread=1"
								className={`flex items-center gap-1 rounded-[2px] px-2.5 py-1 ${
									unreadOnly
										? 'bg-selected text-ink-strong font-bold'
										: 'text-ink-weak hover:text-ink-strong'
								}`}
							>
								<span>未读</span>
								{notifications.unreadCount > 0 && (
									<span className="tabular-nums">({notifications.unreadCount})</span>
								)}
							</Link>
						</div>

						{notifications.unreadCount > 0 && (
							<Form method="post">
								<input type="hidden" name="intent" value="mark-all-read" />
								<Button tone="secondary" size="sm" type="submit" isPending={isMarkingAll}>
									<CheckCheck aria-hidden />
									全部标为已读
								</Button>
							</Form>
						)}
					</div>
				}
			/>

			{actionData?.error !== undefined && (
				<div className="mb-6">
					<FormError message={actionData.error} />
				</div>
			)}

			{notifications.items.length === 0 ? (
				<EmptyState
					icon={Bell}
					title={unreadOnly ? '没有未读通知' : '暂时还没有收到通知'}
					hint={
						unreadOnly
							? '所有通知都已读完，可以切换到“全部”查看历史通知。'
							: '当其他成员回复你发布的主题时，会在这里收到提醒。'
					}
					action={
						unreadOnly ? (
							<ButtonLink to="/notifications" tone="secondary" size="sm">
								查看全部通知
							</ButtonLink>
						) : undefined
					}
				/>
			) : (
				<section>
					<SectionLabel>
						{unreadOnly ? `未读通知 · ${notifications.total}` : `全部通知 · ${notifications.total}`}
					</SectionLabel>
					<Panel as="ol" className="divide-line divide-y">
						{notifications.items.map((item) => (
							<NotificationRow key={item.id} item={item} />
						))}
					</Panel>
					<Pager
						page={notifications.page}
						pageSize={notifications.pageSize}
						total={notifications.total}
					/>
				</section>
			)}
		</>
	)
}

function NotificationRow({ item }: { item: NotificationDto }) {
	const fetcher = useFetcher<ActionResponse>()
	const isMarking = fetcher.state !== 'idle'
	const isRead = item.read || isMarking
	const href = resolveNotificationHref(item)

	function markReadOnJump() {
		if (isRead) return
		void fetch('/api/forum/ext/forum-notifications/mark-read', {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json' },
			body: JSON.stringify({ id: item.id }),
			keepalive: true,
		}).catch(() => {})
	}

	return (
		<li
			data-testid="notification-row"
			className={`flex flex-col gap-2 px-4 py-3.5 transition-colors sm:flex-row sm:items-start sm:justify-between ${
				isRead ? '' : 'bg-selected/40'
			}`}
		>
			<div className=" flex min-w-0 flex-1 items-start gap-3">
				{item.actor !== null ? (
					<Link to={`/u/${item.actor.id}`} className="mt-0.5 shrink-0">
						<UserAvatar user={item.actor} size="md" />
					</Link>
				) : (
					<span
						aria-hidden
						className="border-line bg-control text-ink-weak mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-[2px] border"
					>
						<Bell size={14} />
					</span>
				)}

				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						{!isRead && <Tag tone="accent">未读</Tag>}
						{href !== null ? (
							<Link
								to={href}
								onClick={markReadOnJump}
								className={`hover:text-accent text-[14px] leading-snug break-words ${
									isRead ? 'text-ink' : 'text-ink-strong font-bold'
								}`}
							>
								{item.title}
							</Link>
						) : (
							<span
								className={`text-[14px] leading-snug break-words ${
									isRead ? 'text-ink' : 'text-ink-strong font-bold'
								}`}
							>
								{item.title}
							</span>
						)}
					</div>

					{item.body !== null && item.body !== '' && (
						<p className="text-ink-weak mt-1 line-clamp-2 text-[13px] leading-relaxed break-words">
							{item.body}
						</p>
					)}

					<div className="text-ink-weak mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
						{item.actor !== null && (
							<>
								<Link to={`/u/${item.actor.id}`} className="hover:text-ink-strong">
									{item.actor.displayName}
								</Link>
								<span aria-hidden>·</span>
							</>
						)}
						<Timestamp iso={item.createdAt} />
					</div>
				</div>
			</div>

			<div className="flex shrink-0 items-center gap-1.5 self-end sm:self-center">
				{href !== null && (
					<ButtonLink to={href} tone="ghost" size="sm" onClick={markReadOnJump}>
						<ExternalLink aria-hidden />
						查看帖子
					</ButtonLink>
				)}
				{!isRead && (
					<fetcher.Form method="post">
						<input type="hidden" name="intent" value="mark-read" />
						<input type="hidden" name="id" value={item.id} />
						<Button tone="ghost" size="sm" type="submit" isPending={isMarking}>
							<Check aria-hidden />
							标为已读
						</Button>
					</fetcher.Form>
				)}
			</div>
		</li>
	)
}
