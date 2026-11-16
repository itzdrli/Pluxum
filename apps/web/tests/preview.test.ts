import { describe, expect, it } from 'vitest'

import { excerptOf, previewTarget } from '../app/lib/preview'

const ORIGIN = 'https://forum.example'

describe('previewTarget', () => {
	it('recognises threads, floors and profiles on this origin', () => {
		expect(previewTarget('/c/general/t/1019?cpage=2', ORIGIN)).toEqual({
			kind: 'thread',
			ref: '1019',
			floor: null,
		})
		expect(previewTarget(`${ORIGIN}/t/1001-hello/3`, ORIGIN)).toEqual({
			kind: 'thread',
			ref: '1001-hello',
			floor: 3,
		})
		expect(previewTarget('/c/a/t/7#post-12', ORIGIN)).toEqual({
			kind: 'thread',
			ref: '7',
			floor: 12,
		})
		expect(previewTarget('/u/alice', ORIGIN)).toEqual({ kind: 'user', handle: 'alice' })
	})

	it('ignores everything else', () => {
		expect(previewTarget('https://other.example/t/1', ORIGIN)).toBeNull()
		expect(previewTarget('/search?q=a', ORIGIN)).toBeNull()
		expect(previewTarget('/c/general', ORIGIN)).toBeNull()
		expect(previewTarget('/api/forum/ext/forum-attachments/files/x', ORIGIN)).toBeNull()
	})
})

describe('excerptOf', () => {
	it('flattens HTML and cuts long text', () => {
		expect(excerptOf('<p>Hello &amp; <strong>bye</strong></p>\n<p>next</p>', 100)).toBe(
			'Hello & bye next',
		)
		expect(excerptOf('<p>一二三四五六七八九十</p>', 5)).toBe('一二三四五…')
		expect(excerptOf('', 5)).toBe('')
	})
})
