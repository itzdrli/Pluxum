import { ERROR_TEXT, errorDetail, type ErrorArgs, type ErrorKey } from '@pluxum/domain'
import { describe, expect, it } from 'vitest'

import { apiErrorText, apiErrorTextOfBody } from '../app/lib/api-errors'
import { createI18n } from '../app/lib/i18n'
import { loadMessages } from '../app/lib/i18n.server'

const zh = createI18n('zh-CN')
const en = createI18n('en', await loadMessages('en'))

const checked = new Set<ErrorKey>()

/** The web app's Chinese for `key` must be the API's fallback, word for word. */
function sameChinese<K extends ErrorKey>(key: K, ...args: ErrorArgs<K>) {
	checked.add(key)
	const detail = errorDetail(key, ...args)
	expect(apiErrorText(zh, detail)).toBe(detail.message)
	return detail
}

const say = (detail: ReturnType<typeof errorDetail>) => apiErrorText(en, detail)

describe('API error texts', () => {
	it('keeps the Chinese of every key equal to the API fallback', () => {
		sameChinese('auth.required')
		sameChinese('permission.denied')
		sameChinese('request.invalid')
		sameChinese('request.unparsable')
		sameChinese('request.method')
		sameChinese('request.cross_site')
		sameChinese('route.not_found')
		sameChinese('server.internal')
		sameChinese('login.unavailable')
		sameChinese('login.not_configured')
		for (const entity of [
			'category',
			'user',
			'post',
			'thread',
			'floor',
			'report',
			'notification',
			'file',
		] as const) {
			sameChinese('entity.not_found', { entity })
		}
		for (const field of [
			'title',
			'category_name',
			'category_description',
			'display_name',
			'search_query',
			'content',
			'slug',
			'handle',
			'report_reason',
			'ban_reason',
			'resolution_note',
			'unban_note',
		] as const) {
			sameChinese('field.not_text', { field })
			sameChinese('field.empty', { field })
			sameChinese('field.required', { field })
			sameChinese('field.bad_chars', { field })
			sameChinese('field.too_long', { field, max: 40 })
		}
		sameChinese('handle.too_short', { min: 2 })
		sameChinese('handle.format')
		sameChinese('handle.taken')
		sameChinese('slug.format')
		sameChinese('slug.derive_failed')
		sameChinese('position.not_integer')
		sameChinese('role.unknown')
		sameChinese('account.invalid_subject')
		sameChinese('search.disabled')
		sameChinese('search.unavailable')
		sameChinese('category.slug_taken')
		sameChinese('category.stream_undeletable')
		sameChinese('category.not_empty')
		sameChinese('category.kind_changed')
		sameChinese('thread.note_no_title')
		sameChinese('thread.note_untitled')
		sameChinese('thread.convert_needs_title')
		sameChinese('thread.topic_not_to_stream')
		sameChinese('thread.locked')
		sameChinese('post.opening_undeletable')
		sameChinese('follow.self')
		sameChinese('solved.not_allowed')
		sameChinese('solved.note')
		sameChinese('solved.opening')
		sameChinese('ban.cannot_post')
		sameChinese('ban.cannot_act')
		sameChinese('ban.self')
		sameChinese('ban.admin')
		sameChinese('ban.duration')
		sameChinese('content.banned_words')
		sameChinese('report.no_target')
		sameChinese('report.duplicate')
		sameChinese('report.bad_status')
		for (const bucket of ['threads', 'replies', 'edits'] as const) {
			for (const seconds of [1, 59, 60, 61, 3599, 3600, 7300]) {
				sameChinese('rate.limited', { bucket, seconds })
			}
		}
		sameChinese('upload.avatar_unreadable')
		sameChinese('upload.avatar_too_large', { limit: '2 MiB' })
		sameChinese('upload.avatar_type')
		sameChinese('upload.file_unreadable')
		sameChinese('upload.file_too_large', { limit: '5 MiB' })
		sameChinese('upload.image_mismatch')
		sameChinese('upload.binary_text')
		sameChinese('upload.type_unsupported', { types: 'PDF,ZIP,TXT' })
		expect(checked.size).toBeGreaterThan(50)
	})

	it('covers every key the API can send', () => {
		expect([...checked].toSorted()).toEqual(Object.keys(ERROR_TEXT).toSorted())
	})

	it('words an error in English', () => {
		expect(say(errorDetail('entity.not_found', { entity: 'user' }))).toBe('User not found')
		expect(say(errorDetail('field.too_long', { field: 'title', max: 120 }))).toBe(
			'The title cannot exceed 120 characters',
		)
		expect(say(errorDetail('rate.limited', { bucket: 'replies', seconds: 300 }))).toBe(
			'You are replying too fast. Try again in 5 minutes',
		)
		expect(say(errorDetail('upload.type_unsupported', { types: 'PDF,ZIP' }))).toBe(
			'Unsupported file type (supported: PDF, ZIP)',
		)
	})

	it('shows the fallback for a key it does not know', () => {
		expect(apiErrorText(en, { key: 'from.the.future', message: '来自未来的错误' })).toBe(
			'来自未来的错误',
		)
		expect(apiErrorText(en, { message: '没有 key' })).toBe('没有 key')
	})

	it('reads an error out of a response body', () => {
		const body = {
			error: { code: 'forbidden', message: '没有权限执行此操作', key: 'permission.denied' },
		}
		expect(apiErrorTextOfBody(en, body)).toBe('You do not have permission to do that')
		expect(apiErrorTextOfBody(en, { nothing: true })).toBeNull()
	})
})
