import { Modal } from '@heroui/react'
import { LogIn, MessageCircleOff, MessagesSquare, PenSquare, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
	Outlet,
	useMatch,
	useNavigate,
	useRouteLoaderData,
	type ShouldRevalidateFunction,
} from 'react-router'
import { t as tm } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'

import type { Route } from './+types/messages'
import { PeoplePicker } from '../components/messages/people-picker'
import { UserAvatar } from '../components/forum/user-avatar'
import { StageLink } from '../components/stage/stage'
import { Button, ButtonAnchor } from '../components/ui/button'
import { EmptyState, FormError, PageHeader, Panel, Timestamp } from '../components/ui/display'
import { apiErrorTextOfBody } from '../lib/api-errors'
import { forumApi, orThrow } from '../lib/forum-api.server'
import { i18nOfRoot } from '../lib/i18n'
import { loginHref } from '../lib/login'
import {
	conversationName,
	MESSAGES_EXT_ID,
	MessagesError,
	messagesApi,
	otherMember,
	setUnread,
	useMessagesVersion,
	type ConversationDto,
	type MessageUser,
} from '../lib/messages'
import { pageTitle } from '../lib/site'
import { defineStage } from '../lib/stage'
import type { loader as rootLoader } from '../root'

export const handle = defineStage({ layer: 'page', nav: true, wide: true })

/** What the open conversation tells the list around it. */
export type MessagesOutlet = Readonly<{
	viewerId: string
	/** The conversation changed here (read, sent, renamed, left): the list reloads. */
	refresh: () => void
}>

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: pageTitle(matches[0].loaderData, tm(i18nOfRoot(matches[0].loaderData))`私信`) }]
}

export async function loader({ request }: Route.LoaderArgs) {
	const forum = orThrow(await forumApi.meta(request))
	const available = forum.uiSlots.some((slot) => slot.extId === MESSAGES_EXT_ID)
	if (!available) return { available, viewerId: null, list: null }
	const viewerId = forum.viewer.user?.id ?? null
	if (viewerId === null) return { available, viewerId, list: null }
	return { available, viewerId, list: orThrow(await forumApi.conversations(request)) }
}

// Opening another conversation keeps the list; it reloads itself when something arrives.
export const shouldRevalidate: ShouldRevalidateFunction = ({
	currentUrl,
	nextUrl,
	formMethod,
	defaultShouldRevalidate,
}) =>
	formMethod === undefined &&
	currentUrl.pathname.startsWith('/messages') &&
	nextUrl.pathname.startsWith('/messages')
		? false
		: defaultShouldRevalidate

export default function Messages({ loaderData }: Route.ComponentProps) {
	const { t } = useLingui()
	const auth = useRouteLoaderData<typeof rootLoader>('root')?.meta?.auth
	const { available, viewerId } = loaderData
	const open = useMatch('/messages/:id')?.params.id
	const [list, setList] = useState(loaderData.list)
	const [starting, setStarting] = useState(false)
	const version = useMessagesVersion()
	const [refreshes, setRefreshes] = useState(0)

	useEffect(() => {
		if (version === 0 && refreshes === 0) return undefined
		let live = true
		void (async () => {
			try {
				const next = await messagesApi.list()
				if (!live) return
				setList(next)
				setUnread(next.unread)
			} catch {
				// The list stays as it was; the next message tries again.
			}
		})()
		return () => {
			live = false
		}
	}, [version, refreshes])

	if (!available) {
		return (
			<>
				<PageHeader title={t`私信`} />
				<EmptyState icon={MessageCircleOff} title={t`私信功能未启用`} />
			</>
		)
	}
	if (viewerId === null || list === null) {
		return (
			<>
				<PageHeader title={t`私信`} />
				<EmptyState
					icon={LogIn}
					title={t`请先登录`}
					action={
						<ButtonAnchor href={loginHref(auth, '/messages')} tone="primary" size="sm">
							<Trans>登录</Trans>
						</ButtonAnchor>
					}
				/>
			</>
		)
	}

	const outlet: MessagesOutlet = { viewerId, refresh: () => setRefreshes((count) => count + 1) }
	return (
		<>
			<div className={open === undefined ? '' : 'max-lg:hidden'}>
				<PageHeader
					title={t`私信`}
					actions={
						<Button tone="secondary" size="sm" onPress={() => setStarting(true)}>
							<PenSquare aria-hidden />
							<Trans>发起聊天</Trans>
						</Button>
					}
				/>
			</div>
			<div
				className={`messages-frame grid gap-4 lg:grid-cols-[minmax(240px,320px)_1fr]${open === undefined ? '' : ' messages-frame--open'}`}
			>
				<Panel className={`min-h-0 overflow-y-auto ${open === undefined ? '' : 'max-lg:hidden'}`}>
					{list.items.length === 0 ? (
						<p className="text-ink-weak px-4 py-10 text-center">
							<Trans>还没有私信</Trans>
						</p>
					) : (
						<ul className="divide-line-soft divide-y">
							{list.items.map((conversation) => (
								<ConversationRow
									key={conversation.id}
									conversation={conversation}
									viewerId={viewerId}
									active={conversation.id === open}
								/>
							))}
						</ul>
					)}
				</Panel>
				<section className={`min-h-0 ${open === undefined ? 'max-lg:hidden' : ''}`}>
					{open === undefined ? (
						<div className="border-line text-ink-weak flex h-full flex-col items-center justify-center gap-2 rounded-[2px] border border-dashed">
							<MessagesSquare aria-hidden size={20} strokeWidth={1.75} />
							<Trans>选择一个会话</Trans>
						</div>
					) : (
						<Outlet context={outlet} />
					)}
				</section>
			</div>
			{starting && <StartDialog viewerId={viewerId} onClose={() => setStarting(false)} />}
		</>
	)
}

function ConversationRow({
	conversation,
	viewerId,
	active,
}: {
	conversation: ConversationDto
	viewerId: string
	active: boolean
}) {
	const { t } = useLingui()
	const name = conversationName(conversation, viewerId)
	const other = conversation.kind === 'direct' ? otherMember(conversation, viewerId) : undefined
	const last = conversation.lastMessage
	const preview =
		last === null
			? ''
			: conversation.kind === 'group' || last.author.id === viewerId
				? `${last.author.id === viewerId ? t`我` : last.author.displayName}：${last.body}`
				: last.body
	return (
		<li>
			<StageLink
				to={`/messages/${conversation.id}`}
				aria-current={active ? 'page' : undefined}
				className={`flex items-center gap-3 px-3 py-2.5 ${active ? 'bg-selected' : 'hover:bg-hover'}`}
			>
				{other !== undefined ? (
					<UserAvatar user={other} />
				) : (
					<span className="bg-control text-ink-weak flex size-9 shrink-0 items-center justify-center rounded-full">
						<Users aria-hidden size={16} />
					</span>
				)}
				<span className="min-w-0 flex-1">
					<span className="flex items-baseline gap-2">
						<span className="text-ink-strong min-w-0 flex-1 truncate font-bold">{name}</span>
						<Timestamp iso={conversation.updatedAt} className="text-ink-weak shrink-0 text-micro" />
					</span>
					<span className="flex items-center gap-2">
						<span className="text-ink-weak min-w-0 flex-1 truncate text-meta">{preview}</span>
						{conversation.unread > 0 && (
							<span className="bg-accent text-page min-w-5 shrink-0 rounded-[2px] px-1 text-center text-micro leading-5 font-bold tabular-nums">
								{conversation.unread > 99 ? '99+' : conversation.unread}
							</span>
						)}
					</span>
				</span>
			</StageLink>
		</li>
	)
}

const GROUP_MAX = 20

/** Picks people: one starts a direct conversation, more start a group with an optional name. */
function StartDialog({ viewerId, onClose }: { viewerId: string; onClose: () => void }) {
	const { t, i18n } = useLingui()
	const navigate = useNavigate()
	const [picked, setPicked] = useState<MessageUser[]>([])
	const [title, setTitle] = useState('')
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | undefined>()
	const group = picked.length > 1

	async function start() {
		setBusy(true)
		setError(undefined)
		try {
			const first = picked[0]
			if (first === undefined) return
			const { id } = group
				? await messagesApi.group(
						title,
						picked.map((user) => user.id),
					)
				: await messagesApi.start(first.id)
			onClose()
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
		<Modal isOpen onOpenChange={(next) => !next && onClose()}>
			<Modal.Backdrop isKeyboardDismissDisabled={false}>
				<Modal.Container size="sm">
					<Modal.Dialog>
						<Modal.Header>
							<Modal.Heading className="text-ink-strong text-heading font-bold">
								<Trans>发起聊天</Trans>
							</Modal.Heading>
						</Modal.Header>
						<Modal.Body className="flex flex-col gap-3">
							<FormError message={error} />
							<PeoplePicker
								picked={picked}
								onChange={setPicked}
								exclude={[viewerId]}
								max={GROUP_MAX - 1}
							/>
							{group && (
								<input
									type="text"
									value={title}
									maxLength={40}
									placeholder={t`群聊名称（可选）`}
									aria-label={t`群聊名称`}
									onChange={(event) => setTitle(event.currentTarget.value)}
									className="border-line bg-page text-ink-strong placeholder:text-ink-weak/60 hover:border-ink-weak focus:border-accent h-control w-full rounded-[2px] border px-2.5 text-ui outline-none"
								/>
							)}
						</Modal.Body>
						<Modal.Footer className="flex justify-end gap-2">
							<Button tone="ghost" onPress={onClose}>
								<Trans>取消</Trans>
							</Button>
							<Button
								tone="primary"
								isPending={busy}
								isDisabled={picked.length === 0 || busy}
								onPress={() => void start()}
							>
								{group ? <Trans>创建群聊</Trans> : <Trans>开始</Trans>}
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	)
}
