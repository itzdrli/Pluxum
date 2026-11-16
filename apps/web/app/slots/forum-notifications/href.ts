import type { NotificationDto } from '@pluxum/domain'

/** Resolves a safe internal destination link for a notification item. */
export function resolveNotificationHref(
	item: Pick<NotificationDto, 'path' | 'threadId' | 'postId'>,
): string | null {
	if (item.path !== null && item.path.startsWith('/') && !item.path.startsWith('//')) {
		return item.path
	}
	if (item.threadId !== null) {
		return item.postId !== null ? `/t/${item.threadId}/${item.postId}` : `/t/${item.threadId}`
	}
	return null
}
