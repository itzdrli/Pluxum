import { isUiSlot } from '@pluxum/domain'
import { describe, expect, it } from 'vitest'

import { buildPageHref } from '../app/components/ui/pager'
import {
	buildModerationLogsApiPath,
	buildModerationQueueApiPath,
} from '../app/lib/forum-api.server'
import {
	buildModerationHref,
	formatModerationLogAction,
	parseModerationUrl,
	resolveReportTargetHref,
} from '../app/routes/moderation'
import { banStatusOf } from '../app/slots/forum-moderation/user-ban-tab'

describe('moderation route, slots & API helpers', () => {
	it('recognizes post.actions and user.profile.tabs as valid UiSlots', () => {
		expect(isUiSlot('post.actions')).toBe(true)
		expect(isUiSlot('user.profile.tabs')).toBe(true)
	})

	it('builds moderation queue and logs API paths omitting default parameters', () => {
		expect(buildModerationQueueApiPath()).toBe('/ext/forum-moderation/queue')
		expect(buildModerationQueueApiPath({ status: 'open', page: 1 })).toBe(
			'/ext/forum-moderation/queue',
		)
		expect(buildModerationQueueApiPath({ status: 'resolved', page: 2, pageSize: 15 })).toBe(
			'/ext/forum-moderation/queue?status=resolved&page=2&pageSize=15',
		)
		expect(buildModerationLogsApiPath()).toBe('/ext/forum-moderation/logs')
		expect(buildModerationLogsApiPath({ page: 3 })).toBe('/ext/forum-moderation/logs?page=3')
	})

	it('parses /moderation URL query parameters and builds clean tab/status hrefs', () => {
		expect(parseModerationUrl(new URL('http://localhost/moderation'))).toEqual({
			tab: 'queue',
			status: 'open',
			page: 1,
		})
		expect(
			parseModerationUrl(new URL('http://localhost/moderation?status=dismissed&page=4')),
		).toEqual({
			tab: 'queue',
			status: 'dismissed',
			page: 4,
		})
		expect(
			parseModerationUrl(new URL('http://localhost/moderation?tab=logs&status=bad&page=bad')),
		).toEqual({
			tab: 'logs',
			status: 'open',
			page: 1,
		})

		expect(buildModerationHref('queue', 'open')).toBe('/moderation')
		expect(buildModerationHref('queue', 'all')).toBe('/moderation?status=all')
		expect(buildModerationHref('logs')).toBe('/moderation?tab=logs')
	})

	it('resolves report target jump links for post and thread reports', () => {
		expect(resolveReportTargetHref({ threadId: 'thread-1', postId: 'post-9' })).toBe(
			'/t/thread-1/post-9',
		)
		expect(resolveReportTargetHref({ threadId: 'thread-1', postId: null })).toBe('/t/thread-1')
	})

	it('parses untrusted user.ext["forum-moderation"] values safely', () => {
		expect(banStatusOf(undefined)).toEqual({ banned: false })
		expect(banStatusOf({ banned: false })).toEqual({ banned: false })
		expect(banStatusOf({ banned: true, reason: '恶意刷屏', expiresAt: null })).toEqual({
			banned: true,
			reason: '恶意刷屏',
			expiresAt: null,
		})
		expect(
			banStatusOf({
				banned: true,
				reason: '短期禁言',
				expiresAt: '2026-11-20T00:00:00.000Z',
			}),
		).toEqual({
			banned: true,
			reason: '短期禁言',
			expiresAt: '2026-11-20T00:00:00.000Z',
		})
	})

	it('maps audit log actions to localized badge labels and preserves filter params across pages', () => {
		expect(formatModerationLogAction('user.banned')).toEqual({
			label: '封禁账号',
			tone: 'danger',
		})
		expect(formatModerationLogAction('report.resolved_deleted')).toEqual({
			label: '处理并删除内容',
			tone: 'danger',
		})
		expect(formatModerationLogAction('custom.event')).toEqual({
			label: 'custom.event',
			tone: 'neutral',
		})

		expect(buildPageHref('/moderation', '?status=resolved', 2)).toBe(
			'/moderation?status=resolved&page=2',
		)
		expect(buildPageHref('/moderation', '?tab=logs&page=2', 1)).toBe('/moderation?tab=logs')
	})
})
