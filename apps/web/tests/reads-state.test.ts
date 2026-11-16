import { describe, expect, it } from 'vitest'

import { isUnread, readThroughOf } from '../app/slots/forum-reads/state'

const thread = (lastPostAt: string, ext: Record<string, unknown>) => ({ lastPostAt, ext })

describe('forum-reads thread state', () => {
	it('is unread only when the thread moved past the read position', () => {
		const read = { 'forum-reads': { readThrough: '2026-01-02T00:00:00.000Z' } }
		expect(isUnread(thread('2026-01-03T00:00:00.000Z', read))).toBe(true)
		expect(isUnread(thread('2026-01-02T00:00:00.000Z', read))).toBe(false)
		expect(isUnread(thread('2026-01-01T00:00:00.000Z', read))).toBe(false)
	})

	it('says nothing without the extension or with malformed data', () => {
		expect(readThroughOf(thread('2026-01-03T00:00:00.000Z', {}))).toBeUndefined()
		expect(isUnread(thread('2026-01-03T00:00:00.000Z', {}))).toBe(false)
		expect(
			isUnread(thread('2026-01-03T00:00:00.000Z', { 'forum-reads': { readThrough: 5 } })),
		).toBe(false)
		expect(isUnread(thread('2026-01-03T00:00:00.000Z', { 'forum-reads': null }))).toBe(false)
	})
})
