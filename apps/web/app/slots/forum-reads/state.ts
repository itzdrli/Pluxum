// What the reads extension attaches to a thread (`ext['forum-reads']`), read from the untyped DTO.

import type { ThreadDto } from '@pluxum/domain'

export const READS_EXT_ID = 'forum-reads'

/** The moment the viewer has read the thread up to, or undefined when the extension says nothing. */
export function readThroughOf(thread: Pick<ThreadDto, 'ext'>): string | undefined {
	const value = thread.ext[READS_EXT_ID]
	if (typeof value !== 'object' || value === null || !('readThrough' in value)) return undefined
	return typeof value.readThrough === 'string' ? value.readThrough : undefined
}

/** Whether the thread has activity the viewer has not read. Without the extension nothing is unread. */
export function isUnread(thread: Pick<ThreadDto, 'ext' | 'lastPostAt'>): boolean {
	const readThrough = readThroughOf(thread)
	return readThrough !== undefined && thread.lastPostAt > readThrough
}
