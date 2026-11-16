import { isUiSlot } from '@pluxum/domain'
import { describe, expect, it } from 'vitest'

import { buildPageHref } from '../app/components/ui/pager'
import { buildNotificationsApiPath } from '../app/lib/forum-api.server'
import { parseNotificationsUrl, resolveNotificationHref } from '../app/routes/notifications'
import { formatUnreadBadge } from '../app/slots/forum-notifications/bell'

describe('notifications route, slot & API helpers', () => {
	it('recognizes shell.actions as a valid UiSlot', () => {
		expect(isUiSlot('shell.actions')).toBe(true)
	})

	it('builds /ext/forum-notifications/list API query strings omitting unset defaults', () => {
		expect(buildNotificationsApiPath()).toBe('/ext/forum-notifications/list')
		expect(buildNotificationsApiPath({ page: 1, unreadOnly: false })).toBe(
			'/ext/forum-notifications/list',
		)
		expect(buildNotificationsApiPath({ page: 2, pageSize: 15, unreadOnly: true })).toBe(
			'/ext/forum-notifications/list?unreadOnly=true&page=2&pageSize=15',
		)
	})

	it('parses /notifications URL query parameters cleanly', () => {
		expect(parseNotificationsUrl(new URL('http://localhost/notifications'))).toEqual({
			unreadOnly: false,
			page: 1,
		})
		expect(
			parseNotificationsUrl(new URL('http://localhost/notifications?unread=1&page=3')),
		).toEqual({
			unreadOnly: true,
			page: 3,
		})
		expect(
			parseNotificationsUrl(new URL('http://localhost/notifications?unreadOnly=true&page=bad')),
		).toEqual({
			unreadOnly: true,
			page: 1,
		})
	})

	it('resolves safe internal notification paths and falls back to thread/post links', () => {
		expect(
			resolveNotificationHref({
				path: '/t/thread-1#post-2',
				threadId: 'thread-1',
				postId: 'post-2',
			}),
		).toBe('/t/thread-1#post-2')
		// Rejects protocol-relative or external URLs in `path` and falls back to threadId/postId.
		expect(
			resolveNotificationHref({
				path: '//evil.example/phish',
				threadId: 'thread-1',
				postId: '2',
			}),
		).toBe('/t/thread-1/2')
		expect(
			resolveNotificationHref({
				path: 'https://evil.example/phish',
				threadId: 'thread-1',
				postId: null,
			}),
		).toBe('/t/thread-1')
		expect(
			resolveNotificationHref({
				path: null,
				threadId: null,
				postId: null,
			}),
		).toBeNull()
	})

	it('formats unread badge counts with 99+ cap', () => {
		expect(formatUnreadBadge(0)).toBeNull()
		expect(formatUnreadBadge(-3)).toBeNull()
		expect(formatUnreadBadge(1)).toBe('1')
		expect(formatUnreadBadge(99)).toBe('99')
		expect(formatUnreadBadge(100)).toBe('99+')
	})

	it('preserves unread filter across pagination links', () => {
		expect(buildPageHref('/notifications', '?unread=1', 2)).toBe('/notifications?unread=1&page=2')
		expect(buildPageHref('/notifications', '?unread=1&page=2', 1)).toBe('/notifications?unread=1')
	})
})
