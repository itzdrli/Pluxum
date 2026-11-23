import type { I18n } from '@lingui/core'
import { select, t } from '@lingui/core/macro'
import { isNoticeKey, PLACEHOLDER_KINDS, type NoticeKey, type NoticeParams } from '@pluxum/domain'

// Notification titles and stand-in users, worded in the visitor's language. The API sends the
// finished Chinese text beside a key and its params (`@pluxum/domain` notices); a key this build
// does not know keeps the Chinese. tests/notices.test.ts keeps the Chinese here equal to the API's.

type Params = NoticeParams | undefined

const text = (params: Params, name: string): string => {
	const value = params?.[name]
	return typeof value === 'string' ? value : ''
}

const TEXT: Readonly<Record<NoticeKey, (i18n: I18n, params: Params) => string>> = {
	'notice.reply.topic': (i18n, params) => {
		const actor = text(params, 'actor')
		const title = text(params, 'title')
		return t(i18n)`${actor} 回复了你的主题《${title}》`
	},
	'notice.reply.note': (i18n, params) => {
		const actor = text(params, 'actor')
		return t(i18n)`${actor} 回复了你的动态`
	},
	'notice.reply.in_topic': (i18n, params) => {
		const actor = text(params, 'actor')
		const title = text(params, 'title')
		return t(i18n)`${actor} 在《${title}》中回复了你`
	},
	'notice.reply.in_note': (i18n, params) => {
		const actor = text(params, 'actor')
		return t(i18n)`${actor} 在动态中回复了你`
	},
	'notice.mention.in_topic': (i18n, params) => {
		const actor = text(params, 'actor')
		const title = text(params, 'title')
		return t(i18n)`${actor} 在《${title}》中提到了你`
	},
	'notice.mention.in_note': (i18n, params) => {
		const actor = text(params, 'actor')
		return t(i18n)`${actor} 在动态中提到了你`
	},
	'notice.follow': (i18n, params) => {
		const actor = text(params, 'actor')
		return t(i18n)`${actor} 关注了你`
	},
	'notice.accepted': (i18n, params) => {
		const actor = text(params, 'actor')
		return t(i18n)`${actor} 采纳了你的回答`
	},
	'notice.message': (i18n, params) => {
		const actor = text(params, 'actor')
		return t(i18n)`${actor} 给你发了私信`
	},
}

/** A notification title in the visitor's language, or the API's Chinese one. */
export function noticeTitle(
	i18n: I18n,
	notice: Readonly<{ title: string; titleKey?: unknown; titleParams?: NoticeParams | null }>,
): string {
	const key = notice.titleKey
	return isNoticeKey(key) ? TEXT[key](i18n, notice.titleParams ?? undefined) : notice.title
}

/** The name of a stand-in user (one the API could not look up). */
export function placeholderName(i18n: I18n, kind: 'unknown' | 'member'): string {
	return t(i18n)`${select(kind, { unknown: '未知用户', member: '论坛成员', other: '未知用户' })}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isParams(value: unknown): value is NoticeParams {
	return (
		isRecord(value) &&
		Object.values(value).every((v) => typeof v === 'string' || typeof v === 'number')
	)
}

/**
 * Words the notification titles and stand-in users inside an API response body in the visitor's
 * language, in place. Everything else in the body is left as it is.
 */
export function localizeBody(i18n: I18n, body: unknown): void {
	if (Array.isArray(body)) {
		for (const entry of body) localizeBody(i18n, entry)
		return
	}
	if (!isRecord(body)) return
	if (typeof body.title === 'string' && isNoticeKey(body.titleKey)) {
		body.title = noticeTitle(i18n, {
			title: body.title,
			titleKey: body.titleKey,
			titleParams: isParams(body.titleParams) ? body.titleParams : null,
		})
	}
	const marker: unknown = isRecord(body.ext) ? body.ext.placeholder : undefined
	const kind = PLACEHOLDER_KINDS.find((known) => known === marker)
	if (kind !== undefined && typeof body.displayName === 'string') {
		body.displayName = placeholderName(i18n, kind)
	}
	for (const value of Object.values(body)) localizeBody(i18n, value)
}
