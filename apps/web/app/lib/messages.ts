// Private messages (Pluxum Messages) in the browser: the shapes the API answers, its calls, and
// one live connection per tab. A long poll runs while anything on the page listens; it carries the
// conversation that is open, so its new messages arrive at once, and it keeps the unread count.
import { useEffect, useSyncExternalStore } from 'react'

export const MESSAGES_EXT_ID = 'forum-messages'
export const MESSAGE_BODY_MAX = 2000
const BASE = `/api/forum/ext/${MESSAGES_EXT_ID}`
const POLL_WAIT = 25

export type MessageUser = Readonly<{ id: string; handle: string; displayName: string }>

export type MessageDto = Readonly<{
	id: string
	seq: number
	conversationId: string
	author: MessageUser
	body: string
	createdAt: string
}>

export type ConversationDto = Readonly<{
	id: string
	kind: 'direct' | 'group'
	title: string
	ownerId: string
	members: MessageUser[]
	lastMessage: MessageDto | null
	unread: number
	updatedAt: string
}>

export type ConversationList = Readonly<{ items: ConversationDto[]; unread: number }>
export type ConversationDetail = Readonly<{
	conversation: ConversationDto
	messages: MessageDto[]
	hasMore: boolean
}>
export type MessageAllow = 'everyone' | 'following' | 'nobody'

type PollResult = Readonly<{
	seq: number
	messages: MessageDto[]
	changed: boolean
	unread: number
}>

/** An API failure with the server's own (already translated) message when it sent one. */
export class MessagesError extends Error {
	constructor(
		readonly status: number,
		readonly body: unknown,
	) {
		super(`messages: ${status}`)
	}
}

async function request<T>(action: string, input?: Readonly<Record<string, unknown>>): Promise<T> {
	const init: RequestInit =
		input === undefined
			? { headers: { accept: 'application/json' } }
			: {
					method: 'POST',
					headers: { 'content-type': 'application/json', accept: 'application/json' },
					body: JSON.stringify(input),
				}
	const response = await fetch(`${BASE}/${action}`, init)
	const body: unknown = await response.json().catch(() => null)
	if (!response.ok) throw new MessagesError(response.status, body)
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- forum-api checks every ext answer against the plugin's output schema, which these types mirror.
	return body as T
}

export const messagesApi = {
	list: () => request<ConversationList>('list'),
	get: (id: string, before?: number) =>
		request<ConversationDetail>(
			`get?id=${encodeURIComponent(id)}${before === undefined ? '' : `&before=${before}`}`,
		),
	start: (userId: string) => request<{ id: string }>('start', { userId }),
	group: (title: string, memberIds: readonly string[]) =>
		request<{ id: string }>('group', { title, memberIds }),
	send: (conversationId: string, body: string) =>
		request<MessageDto>('send', { conversationId, body }),
	read: (conversationId: string, seq: number) =>
		request<{ unread: number }>('read', { conversationId, seq }),
	leave: (conversationId: string) => request<{ left: boolean }>('leave', { conversationId }),
	members: (conversationId: string, change: { add?: string[]; remove?: string[] }) =>
		request<ConversationDto>('members', { conversationId, ...change }),
	rename: (conversationId: string, title: string) =>
		request<ConversationDto>('rename', { conversationId, title }),
	settings: () => request<{ allow: MessageAllow }>('settings'),
	setAllow: (allow: MessageAllow) => request<{ allow: MessageAllow }>('preference', { allow }),
}

/** How a conversation is named: a group's title, else the other people's names. */
export function conversationName(
	conversation: ConversationDto,
	viewerId: string | undefined,
): string {
	if (conversation.title !== '') return conversation.title
	const others = conversation.members.filter((member) => member.id !== viewerId)
	return (others.length > 0 ? others : conversation.members)
		.map((member) => member.displayName)
		.join('、')
}

/** The other person of a direct conversation. */
export function otherMember(
	conversation: ConversationDto,
	viewerId: string | undefined,
): MessageUser | undefined {
	return conversation.members.find((member) => member.id !== viewerId) ?? conversation.members[0]
}

// ── The live connection ───────────────────────────────────────────────────

type Listener = () => void
type MessageListener = (messages: readonly MessageDto[]) => void

const state = {
	unread: 0,
	seq: 0,
	/** Bumped whenever anything arrived: lists reload on it. */
	version: 0,
	open: undefined as string | undefined,
}
const listeners = new Set<Listener>()
const messageListeners = new Set<MessageListener>()
let subscribers = 0
let controller: AbortController | null = null

function emit(): void {
	for (const listener of listeners) listener()
}

async function loop(signal: AbortSignal): Promise<void> {
	let wait = 0
	let failures = 0
	while (!signal.aborted) {
		const query = new URLSearchParams({ since: String(state.seq), wait: String(wait) })
		if (state.open !== undefined) query.set('conversation', state.open)
		try {
			// oxlint-disable-next-line no-await-in-loop -- one poll at a time is the point.
			const response = await fetch(`${BASE}/poll?${query}`, {
				headers: { accept: 'application/json' },
				signal,
			})
			// Signed out or the plugin stopped: nothing to keep up with.
			if (response.status === 401 || response.status === 404) return
			if (!response.ok) throw new Error(`poll: ${response.status}`)
			// oxlint-disable-next-line no-await-in-loop, typescript/no-unsafe-type-assertion -- see above; the API checks the shape.
			const result = (await response.json()) as PollResult
			failures = 0
			const changed = result.changed && result.seq > state.seq
			state.seq = Math.max(state.seq, result.seq)
			if (result.unread !== state.unread || changed) {
				state.unread = result.unread
				if (changed) state.version += 1
				emit()
			}
			if (result.messages.length > 0) {
				for (const listener of messageListeners) listener(result.messages)
			}
			wait = POLL_WAIT
		} catch {
			if (signal.aborted) return
			failures += 1
			// oxlint-disable-next-line no-await-in-loop -- backing off before the next try.
			await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, 1000 * 2 ** failures)))
		}
	}
}

function startLoop(): void {
	controller?.abort()
	controller = new AbortController()
	void loop(controller.signal)
}

function subscribe(listener: Listener): () => void {
	listeners.add(listener)
	subscribers += 1
	if (subscribers === 1) startLoop()
	return () => {
		listeners.delete(listener)
		subscribers -= 1
		if (subscribers === 0) {
			controller?.abort()
			controller = null
		}
	}
}

/** Called after something changed the count here (reading, sending). */
export function setUnread(unread: number): void {
	if (unread === state.unread) return
	state.unread = unread
	emit()
}

/** The signed-in member's unread messages, kept live. `enabled` false: no connection. */
export function useUnreadMessages(enabled: boolean): number {
	return useSyncExternalStore(
		enabled ? subscribe : () => () => undefined,
		() => (enabled ? state.unread : 0),
		() => 0,
	)
}

/** A number that grows whenever a message arrived anywhere: lists refetch on it. */
export function useMessagesVersion(): number {
	return useSyncExternalStore(
		subscribe,
		() => state.version,
		() => 0,
	)
}

/** Marks a conversation as the one on screen, and hands its new messages to `onMessages`. */
export function useOpenConversation(
	conversationId: string,
	onMessages: (messages: readonly MessageDto[]) => void,
): void {
	useEffect(() => {
		state.open = conversationId
		// The poll in flight carries the previous conversation; ask again with this one.
		if (controller !== null) startLoop()
		const listener: MessageListener = (incoming) => {
			const mine = incoming.filter((message) => message.conversationId === conversationId)
			if (mine.length > 0) onMessages(mine)
		}
		messageListeners.add(listener)
		const unsubscribe = subscribe(() => undefined)
		return () => {
			messageListeners.delete(listener)
			if (state.open === conversationId) state.open = undefined
			unsubscribe()
		}
		// oxlint-disable-next-line react-hooks/exhaustive-deps -- once per conversation; the callback is stable per mount.
	}, [conversationId])
}
