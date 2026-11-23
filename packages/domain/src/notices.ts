import type { ExtensionData } from './dto'
import type { ErrorParams } from './errors'

// Texts the backend writes about people and events, as data. A notification stores a `key` and
// its `params` beside the finished Chinese `title`, and a user the backend cannot look up is a
// placeholder with a marker in `ext`. The web app words both in the visitor's language
// (apps/web/app/lib/notices.ts); the Chinese stays as the fallback for other clients.

/** Every notification title key and its parameters. */
export type NoticeSpecs = {
	'notice.reply.topic': { actor: string; title: string }
	'notice.reply.note': { actor: string }
	'notice.reply.in_topic': { actor: string; title: string }
	'notice.reply.in_note': { actor: string }
	'notice.mention.in_topic': { actor: string; title: string }
	'notice.mention.in_note': { actor: string }
	'notice.follow': { actor: string }
	'notice.accepted': { actor: string }
	'notice.message': { actor: string }
}
export type NoticeKey = keyof NoticeSpecs
export type NoticeParams = ErrorParams

type Texts = { [K in NoticeKey]: (params: NoticeSpecs[K]) => string }

/** The Chinese title of every key. */
export const NOTICE_TEXT: Texts = {
	'notice.reply.topic': ({ actor, title }) => `${actor} 回复了你的主题《${title}》`,
	'notice.reply.note': ({ actor }) => `${actor} 回复了你的动态`,
	'notice.reply.in_topic': ({ actor, title }) => `${actor} 在《${title}》中回复了你`,
	'notice.reply.in_note': ({ actor }) => `${actor} 在动态中回复了你`,
	'notice.mention.in_topic': ({ actor, title }) => `${actor} 在《${title}》中提到了你`,
	'notice.mention.in_note': ({ actor }) => `${actor} 在动态中提到了你`,
	'notice.follow': ({ actor }) => `${actor} 关注了你`,
	'notice.accepted': ({ actor }) => `${actor} 采纳了你的回答`,
	'notice.message': ({ actor }) => `${actor} 给你发了私信`,
}

/** A notification title: its key, parameters and Chinese text. */
export type NoticeDetail = Readonly<{ key: NoticeKey; params: NoticeParams; title: string }>

export function noticeDetail<K extends NoticeKey>(key: K, params: NoticeSpecs[K]): NoticeDetail {
	const text: (params: NoticeSpecs[K]) => string = NOTICE_TEXT[key]
	return { key, params, title: text(params) }
}

export function isNoticeKey(value: unknown): value is NoticeKey {
	return typeof value === 'string' && Object.hasOwn(NOTICE_TEXT, value)
}

/** The kinds of stand-in user: someone who cannot be looked up, or a member whose name is unknown. */
export const PLACEHOLDER_KINDS = ['unknown', 'member'] as const
export type PlaceholderKind = (typeof PLACEHOLDER_KINDS)[number]

const PLACEHOLDER_NAME: Readonly<Record<PlaceholderKind, string>> = {
	unknown: '未知用户',
	member: '论坛成员',
}

/** A user the backend cannot look up. `ext.placeholder` lets a client name it in its language. */
export function placeholderUser(
	id: string,
	kind: PlaceholderKind = 'unknown',
): Readonly<{ id: string; handle: string; displayName: string; ext: ExtensionData }> {
	return { id, handle: id, displayName: PLACEHOLDER_NAME[kind], ext: { placeholder: kind } }
}

/** The kind of a placeholder user, or null for a real one. */
export function placeholderKindOf(user: Readonly<{ ext?: ExtensionData }>): PlaceholderKind | null {
	const marker: unknown = user.ext?.placeholder
	return PLACEHOLDER_KINDS.find((kind) => kind === marker) ?? null
}
