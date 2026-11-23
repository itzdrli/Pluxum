import type { ThreadDto } from '@pluxum/domain'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useEffect, useState } from 'react'

import { appHotkeys } from '../../lib/hotkeys'
import { isUnread, READS_EXT_ID } from './state'

function markRead(threadId: string, signal?: AbortSignal): Promise<unknown> {
	return fetch(`/api/forum/ext/${READS_EXT_ID}/mark`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ threadId }),
		signal,
	}).catch(() => {
		// Best effort: the thread simply stays unread until the next view.
	})
}

/**
 * `thread.view`: draws nothing. Once the last page of an unread thread is on screen it tells the
 * reads extension the viewer has read it; M does the same from any page of it. A plain request
 * rather than a route action, so the page does not reload for a bookkeeping call; the lists catch
 * up the next time they load.
 */
export function MarkThreadRead({ thread, atEnd }: { thread: ThreadDto; atEnd: boolean }) {
	const unread = isUnread(thread)
	const threadId = thread.id
	const [markedFor, setMarkedFor] = useState<string | null>(null)
	const marked = markedFor === threadId
	useEffect(() => {
		const controller = new AbortController()
		if (atEnd && unread && !marked) void markRead(threadId, controller.signal)
		return () => controller.abort()
	}, [atEnd, unread, marked, threadId])
	useHotkey(
		appHotkeys['thread.markRead'],
		() => {
			setMarkedFor(threadId)
			void markRead(threadId)
		},
		{ enabled: unread && !marked },
	)
	return null
}
