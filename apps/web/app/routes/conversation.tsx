import { Modal } from '@heroui/react'
import { ArrowLeft, Send } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router'
import { Trans, useLingui } from '@lingui/react/macro'

import type { Route } from './+types/conversation'
import type { MessagesOutlet } from './messages'
import { MessageBody } from '../components/messages/message-body'
import { PeoplePicker } from '../components/messages/people-picker'
import { UserAvatar } from '../components/forum/user-avatar'
import { Button } from '../components/ui/button'
import { FormError } from '../components/ui/display'
import { ActionMenu, type MenuItem } from '../components/ui/overlay'
import { apiErrorTextOfBody } from '../lib/api-errors'
import { formatDateTime } from '../lib/format'
import { forumApi, orThrow } from '../lib/forum-api.server'
import {
	conversationName,
	MESSAGE_BODY_MAX,
	MessagesError,
	messagesApi,
	otherMember,
	setUnread,
	useOpenConversation,
	type ConversationDto,
	type MessageDto,
	type MessageUser,
} from '../lib/messages'
import { useTimeZone } from '../lib/timezone'
import { KeyboardScope } from '../components/ui/keyboard-scope'

export async function loader({ request, params }: Route.LoaderArgs) {
	return orThrow(await forumApi.conversation(request, params.id))
}

/** Adds messages that are not shown yet, keeping the order of `seq`. */
function merged(current: readonly MessageDto[], incoming: readonly MessageDto[]): MessageDto[] {
	const known = new Set(current.map((message) => message.id))
	const fresh = incoming.filter((message) => !known.has(message.id))
	if (fresh.length === 0) return [...current]
	return [...current, ...fresh].toSorted((a, b) => a.seq - b.seq)
}

/** A time line between messages more than this far apart. */
const GAP_MS = 10 * 60_000

export default function Conversation({ loaderData }: Route.ComponentProps) {
	const { viewerId, refresh } = useOutletContext<MessagesOutlet>()
	const id = loaderData.conversation.id
	// A different conversation (or a reload of this one) starts from what the loader brought.
	const [shown, setShown] = useState(loaderData)
	if (shown.conversation.id !== id) setShown(loaderData)
	const [conversation, setConversation] = useState(loaderData.conversation)
	if (conversation.id !== id) setConversation(loaderData.conversation)
	const messages = shown.conversation.id === id ? shown.messages : loaderData.messages
	const list = useRef<HTMLOListElement>(null)
	const stick = useRef(true)

	useOpenConversation(id, (incoming) => {
		setShown((current) => ({ ...current, messages: merged(current.messages, incoming) }))
	})

	// Seen up to the newest message while the page is in view.
	const newest = messages.at(-1)?.seq ?? 0
	useEffect(() => {
		if (newest === 0) return undefined
		const mark = () => {
			if (document.visibilityState !== 'visible') return
			void (async () => {
				try {
					setUnread((await messagesApi.read(id, newest)).unread)
					refresh()
				} catch {
					// Still unread; the next message or visit marks it.
				}
			})()
		}
		mark()
		document.addEventListener('visibilitychange', mark)
		return () => document.removeEventListener('visibilitychange', mark)
		// oxlint-disable-next-line react-hooks/exhaustive-deps -- refresh is a fresh closure each render; reading again per message is enough.
	}, [id, newest])

	// Follows new messages to the bottom unless the reader scrolled up to read older ones.
	useLayoutEffect(() => {
		const element = list.current
		if (element !== null && stick.current) element.scrollTop = element.scrollHeight
	}, [messages.length, id])

	const [loadingOlder, setLoadingOlder] = useState(false)
	async function loadOlder() {
		const first = messages[0]
		const element = list.current
		if (first === undefined || element === null) return
		setLoadingOlder(true)
		try {
			const older = await messagesApi.get(id, first.seq)
			const before = element.scrollHeight
			stick.current = false
			setShown((current) => ({
				...current,
				hasMore: older.hasMore,
				messages: merged(older.messages, current.messages),
			}))
			// Keep the message that was at the top where it was.
			requestAnimationFrame(() => {
				element.scrollTop += element.scrollHeight - before
			})
		} catch {
			// The button stays; trying again is the remedy.
		} finally {
			setLoadingOlder(false)
		}
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<ConversationHead
				conversation={conversation}
				viewerId={viewerId}
				onChanged={(next) => {
					setConversation(next)
					refresh()
				}}
				onLeft={refresh}
			/>
			<ol
				ref={list}
				className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-3"
				aria-live="polite"
				onScroll={(event) => {
					const element = event.currentTarget
					stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
				}}
			>
				{shown.hasMore && (
					<li className="flex justify-center pb-2">
						<Button
							tone="ghost"
							size="sm"
							isPending={loadingOlder}
							onPress={() => void loadOlder()}
						>
							<Trans>更早的消息</Trans>
						</Button>
					</li>
				)}
				{messages.map((message, index) => (
					<MessageItem
						key={message.id}
						message={message}
						previous={messages[index - 1]}
						mine={message.author.id === viewerId}
						group={conversation.kind === 'group'}
					/>
				))}
			</ol>
			<MessageComposer
				conversationId={id}
				onSent={(message) => {
					stick.current = true
					setShown((current) => ({ ...current, messages: merged(current.messages, [message]) }))
					refresh()
				}}
			/>
		</div>
	)
}

function MessageItem({
	message,
	previous,
	mine,
	group,
}: {
	message: MessageDto
	previous: MessageDto | undefined
	mine: boolean
	group: boolean
}) {
	const { i18n } = useLingui()
	const timeZone = useTimeZone()
	const at = new Date(message.createdAt).getTime()
	const gap = previous === undefined || at - new Date(previous.createdAt).getTime() > GAP_MS
	// Consecutive messages of one person within the gap read as one block.
	const continues = !gap && previous?.author.id === message.author.id
	const time = formatDateTime(message.createdAt, i18n.locale, timeZone)
	return (
		<li className={continues ? '' : 'mt-2'}>
			{gap && <p className="text-ink-weak py-1 text-center text-micro tabular-nums">{time}</p>}
			<div className={`flex items-end gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
				{!mine && (
					<span className="w-7 shrink-0">
						{!continues && (
							<Link to={`/u/${message.author.handle}`} tabIndex={-1} aria-hidden>
								<UserAvatar user={message.author} size="sm" />
							</Link>
						)}
					</span>
				)}
				<div className={`flex max-w-[78%] min-w-0 flex-col ${mine ? 'items-end' : 'items-start'}`}>
					{group && !mine && !continues && (
						<span className="text-ink-weak mb-0.5 px-1 text-micro">
							{message.author.displayName}
						</span>
					)}
					<p
						title={time}
						className={`rounded-[2px] px-3 py-1.5 text-ui leading-relaxed break-words whitespace-pre-wrap [overflow-wrap:anywhere] ${
							mine ? 'bg-accent text-page' : 'bg-control text-ink-strong'
						}`}
					>
						<MessageBody text={message.body} />
					</p>
				</div>
			</div>
		</li>
	)
}

function MessageComposer({
	conversationId,
	onSent,
}: {
	conversationId: string
	onSent: (message: MessageDto) => void
}) {
	const { t, i18n } = useLingui()
	const [text, setText] = useState('')
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | undefined>()
	const field = useRef<HTMLTextAreaElement>(null)

	async function send() {
		const body = text.trim()
		if (body === '' || busy) return
		setBusy(true)
		setError(undefined)
		try {
			onSent(await messagesApi.send(conversationId, body))
			setText('')
		} catch (failure) {
			setError(
				(failure instanceof MessagesError ? apiErrorTextOfBody(i18n, failure.body) : null) ??
					t`发送失败，请重试。`,
			)
		} finally {
			setBusy(false)
			field.current?.focus()
		}
	}

	return (
		<form
			className="border-line-soft flex flex-col gap-1.5 border-t p-3"
			onSubmit={(event) => {
				event.preventDefault()
				void send()
			}}
		>
			<FormError message={error} />
			<div className="flex items-end gap-2">
				<textarea
					ref={field}
					value={text}
					rows={1}
					maxLength={MESSAGE_BODY_MAX}
					placeholder={t`写消息…`}
					aria-label={t`消息内容`}
					onChange={(event) => setText(event.currentTarget.value)}
					onKeyDown={(event) => {
						// Enter sends; Shift+Enter (and the IME confirming a word) adds a line.
						if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
							event.preventDefault()
							void send()
						}
					}}
					className="border-line bg-page text-ink-strong placeholder:text-ink-weak/60 hover:border-ink-weak focus:border-accent field-sizing-content max-h-40 min-h-control flex-1 resize-none rounded-[2px] border px-2.5 py-[calc((var(--h-control)_-_2px_-_1lh)/2)] text-ui leading-5 outline-none"
				/>
				<Button
					tone="primary"
					type="submit"
					isPending={busy}
					isDisabled={text.trim() === ''}
					aria-label={t`发送`}
					className="button--icon-only"
				>
					<Send aria-hidden />
				</Button>
			</div>
		</form>
	)
}

function ConversationHead({
	conversation,
	viewerId,
	onChanged,
	onLeft,
}: {
	conversation: ConversationDto
	viewerId: string
	onChanged: (next: ConversationDto) => void
	onLeft: () => void
}) {
	const { t, i18n } = useLingui()
	const navigate = useNavigate()
	const [dialog, setDialog] = useState<'rename' | 'add' | 'leave' | null>(null)
	const name = conversationName(conversation, viewerId)
	const other = conversation.kind === 'direct' ? otherMember(conversation, viewerId) : undefined
	const owner = conversation.ownerId === viewerId
	const count = conversation.members.length
	const items: MenuItem[] =
		conversation.kind === 'group'
			? [
					...(owner
						? [
								{ id: 'rename', label: t`重命名`, onAction: () => setDialog('rename') },
								{ id: 'add', label: t`添加成员`, onAction: () => setDialog('add') },
							]
						: []),
					{ id: 'leave', label: t`退出群聊`, danger: true, onAction: () => setDialog('leave') },
				]
			: []
	const fail = (failure: unknown) =>
		(failure instanceof MessagesError ? apiErrorTextOfBody(i18n, failure.body) : null) ??
		t`操作失败，请稍后再试。`

	return (
		<header className="border-line-soft flex h-12 shrink-0 items-center gap-2 border-b px-2">
			<Link
				to="/messages"
				aria-label={t`返回私信列表`}
				className="text-ink-weak hover:text-ink-strong hover:bg-hover inline-flex size-control items-center justify-center rounded-[2px] lg:hidden"
			>
				<ArrowLeft aria-hidden size={16} />
			</Link>
			<div className="min-w-0 flex-1 pl-1">
				{other !== undefined ? (
					<Link
						to={`/u/${other.handle}`}
						className="text-ink-strong block truncate font-bold hover:underline"
					>
						{name}
					</Link>
				) : (
					<p className="text-ink-strong truncate font-bold">
						{name} <span className="text-ink-weak font-normal tabular-nums">({count})</span>
					</p>
				)}
			</div>
			<ActionMenu label={t`会话操作`} items={items} size="md" />
			{dialog === 'rename' && (
				<TextDialog
					title={t`重命名群聊`}
					initial={conversation.title}
					confirm={t`保存`}
					onClose={() => setDialog(null)}
					onConfirm={async (title) => {
						try {
							onChanged(await messagesApi.rename(conversation.id, title))
							return null
						} catch (failure) {
							return fail(failure)
						}
					}}
				/>
			)}
			{dialog === 'add' && (
				<AddMembersDialog
					conversation={conversation}
					onClose={() => setDialog(null)}
					onAdd={async (people) => {
						try {
							onChanged(
								await messagesApi.members(conversation.id, { add: people.map((user) => user.id) }),
							)
							return null
						} catch (failure) {
							return fail(failure)
						}
					}}
				/>
			)}
			{dialog === 'leave' && (
				<TextDialog
					title={t`退出这个群聊？`}
					confirm={t({ message: '退出', context: 'leave a group' })}
					danger
					onClose={() => setDialog(null)}
					onConfirm={async () => {
						try {
							await messagesApi.leave(conversation.id)
							onLeft()
							void navigate('/messages')
							return null
						} catch (failure) {
							return fail(failure)
						}
					}}
				/>
			)}
		</header>
	)
}

/** A small dialog that confirms, optionally asking for one line of text first. */
function TextDialog({
	title,
	initial,
	confirm,
	danger = false,
	onClose,
	onConfirm,
}: {
	title: string
	/** Given: the dialog asks for text, starting from this. */
	initial?: string
	confirm: string
	danger?: boolean
	onClose: () => void
	/** Resolves to an error to show, or null when done. */
	onConfirm: (text: string) => Promise<string | null>
}) {
	const { t } = useLingui()
	const [text, setText] = useState(initial ?? '')
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	return (
		<Modal isOpen onOpenChange={(next) => !next && onClose()}>
			<Modal.Backdrop isKeyboardDismissDisabled={false}>
				<Modal.Container size="sm">
					<Modal.Dialog>
						<KeyboardScope>
							<Modal.Header>
								<Modal.Heading className="text-ink-strong text-heading font-bold">
									{title}
								</Modal.Heading>
							</Modal.Header>
							{(initial !== undefined || error !== null) && (
								<Modal.Body className="flex flex-col gap-3">
									<FormError message={error ?? undefined} />
									{initial !== undefined && (
										<input
											type="text"
											value={text}
											maxLength={40}
											aria-label={t`群聊名称`}
											onChange={(event) => setText(event.currentTarget.value)}
											className="border-line bg-page text-ink-strong hover:border-ink-weak focus:border-accent h-control w-full rounded-[2px] border px-2.5 text-ui outline-none"
										/>
									)}
								</Modal.Body>
							)}
							<Modal.Footer className="flex justify-end gap-2">
								<Button tone="ghost" onPress={onClose}>
									<Trans>取消</Trans>
								</Button>
								<Button
									tone={danger ? 'danger' : 'primary'}
									isPending={busy}
									onPress={async () => {
										setBusy(true)
										const failure = await onConfirm(text)
										setBusy(false)
										if (failure === null) onClose()
										else setError(failure)
									}}
								>
									{confirm}
								</Button>
							</Modal.Footer>
						</KeyboardScope>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	)
}

function AddMembersDialog({
	conversation,
	onClose,
	onAdd,
}: {
	conversation: ConversationDto
	onClose: () => void
	onAdd: (people: readonly MessageUser[]) => Promise<string | null>
}) {
	const { t } = useLingui()
	const [picked, setPicked] = useState<MessageUser[]>([])
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	return (
		<Modal isOpen onOpenChange={(next) => !next && onClose()}>
			<Modal.Backdrop isKeyboardDismissDisabled={false}>
				<Modal.Container size="sm">
					<Modal.Dialog>
						<KeyboardScope>
							<Modal.Header>
								<Modal.Heading className="text-ink-strong text-heading font-bold">{t`添加成员`}</Modal.Heading>
							</Modal.Header>
							<Modal.Body className="flex flex-col gap-3">
								<FormError message={error ?? undefined} />
								<PeoplePicker
									picked={picked}
									onChange={setPicked}
									exclude={conversation.members.map((member) => member.id)}
									max={Math.max(0, 20 - conversation.members.length)}
								/>
							</Modal.Body>
							<Modal.Footer className="flex justify-end gap-2">
								<Button tone="ghost" onPress={onClose}>
									<Trans>取消</Trans>
								</Button>
								<Button
									tone="primary"
									isPending={busy}
									isDisabled={picked.length === 0}
									onPress={async () => {
										setBusy(true)
										const failure = await onAdd(picked)
										setBusy(false)
										if (failure === null) onClose()
										else setError(failure)
									}}
								>
									<Trans>添加</Trans>
								</Button>
							</Modal.Footer>
						</KeyboardScope>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	)
}
