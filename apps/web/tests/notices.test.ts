import {
	NOTICE_TEXT,
	noticeDetail,
	placeholderUser,
	type NoticeKey,
	type NoticeSpecs,
} from '@pluxum/domain'
import { describe, expect, it } from 'vitest'

import { createI18n } from '../app/lib/i18n'
import { loadMessages } from '../app/lib/i18n.server'
import { localizeBody, noticeTitle } from '../app/lib/notices'

const zh = createI18n('zh-CN')
const en = createI18n('en', await loadMessages('en'))

const checked = new Set<NoticeKey>()

/** The web app's Chinese for `key` must be the API's text, word for word. */
function sameChinese<K extends NoticeKey>(key: K, params: NoticeSpecs[K]) {
	checked.add(key)
	const detail = noticeDetail(key, params)
	expect(noticeTitle(zh, { title: detail.title, titleKey: key, titleParams: params })).toBe(
		detail.title,
	)
	return detail
}

describe('notification titles', () => {
	it('keeps the Chinese of every key equal to the API text', () => {
		sameChinese('notice.reply.topic', { actor: '小明', title: '如何写插件' })
		sameChinese('notice.reply.note', { actor: '小明' })
		sameChinese('notice.reply.in_topic', { actor: '小明', title: '如何写插件' })
		sameChinese('notice.reply.in_note', { actor: '小明' })
		sameChinese('notice.mention.in_topic', { actor: '小明', title: '如何写插件' })
		sameChinese('notice.mention.in_note', { actor: '小明' })
		sameChinese('notice.follow', { actor: '小明' })
		sameChinese('notice.accepted', { actor: '小明' })
		sameChinese('notice.message', { actor: '小明' })
		expect([...checked].toSorted()).toEqual(Object.keys(NOTICE_TEXT).toSorted())
	})

	it('words a notice in English and falls back to the Chinese for an unknown key', () => {
		const detail = noticeDetail('notice.reply.topic', { actor: 'Ann', title: 'Hello' })
		expect(
			noticeTitle(en, { title: detail.title, titleKey: detail.key, titleParams: detail.params }),
		).toBe('Ann replied to your thread “Hello”')
		expect(noticeTitle(en, { title: '原文', titleKey: 'notice.future', titleParams: null })).toBe(
			'原文',
		)
		expect(noticeTitle(en, { title: '没有 key' })).toBe('没有 key')
	})
})

const page = () => ({
	items: [
		{
			title: '小明 关注了你',
			titleKey: 'notice.follow',
			titleParams: { actor: '小明' },
			actor: placeholderUser('u1'),
		},
		{ title: 'plain', actor: { id: 'u2', handle: 'bob', displayName: 'Bob' } },
		{ author: placeholderUser('u3', 'member') },
	],
})

describe('localizeBody', () => {
	it('words notices and stand-in users, and leaves real users alone', () => {
		const body = page()
		localizeBody(en, body)
		expect(body.items[0]).toMatchObject({
			title: '小明 followed you',
			actor: { displayName: 'Unknown user' },
		})
		expect(body.items[1]).toMatchObject({ title: 'plain', actor: { displayName: 'Bob' } })
		expect(body.items[2]).toMatchObject({ author: { displayName: 'Forum member' } })
	})

	it('keeps Chinese for Chinese visitors', () => {
		const body = page()
		localizeBody(zh, body)
		expect(body.items[0]).toMatchObject({
			title: '小明 关注了你',
			actor: { displayName: '未知用户' },
		})
		expect(body.items[2]).toMatchObject({ author: { displayName: '论坛成员' } })
	})
})
