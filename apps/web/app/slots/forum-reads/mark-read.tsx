import type { ThreadDto } from '@pluxum/domain'
import { useEffect } from 'react'

import { isUnread, READS_EXT_ID } from './state'

/**
 * `thread.view`: draws nothing. Once the last page of an unread thread is on screen it tells the
 * reads extension the viewer has read it. A plain request rather than a route action, so the page
 * does not reload for a bookkeeping call; the lists catch up the next time they load.
 */
export function MarkThreadRead({ thread, atEnd }: { thread: ThreadDto; atEnd: boolean }) {
	const unread = isUnread(thread)
	const threadId = thread.id
	useEffect(() => {
		const controller = new AbortController()
		if (atEnd && unread) {
			fetch(`/api/forum/ext/${READS_EXT_ID}/mark`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ threadId }),
				signal: controller.signal,
			}).catch(() => {
				// Best effort: the thread simply stays unread until the next view.
			})
		}
		return () => controller.abort()
	}, [atEnd, unread, threadId])
	return null
}
