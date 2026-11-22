import { describe, expect, it } from 'vitest'

import { diffText, tokenize, type DiffPart } from '../app/lib/diff'

const sideOf = (parts: readonly DiffPart[], drop: DiffPart['kind']) =>
	parts
		.filter((part) => part.kind !== drop)
		.map((part) => part.text)
		.join('')

describe('diffText', () => {
	it('marks changed words, not whole lines', () => {
		expect(diffText('the quick fox', 'the slow fox')).toEqual([
			{ kind: 'same', text: 'the ' },
			{ kind: 'removed', text: 'quick' },
			{ kind: 'added', text: 'slow' },
			{ kind: 'same', text: ' fox' },
		])
	})

	it('marks single Chinese characters', () => {
		expect(diffText('今天天气很好', '今天天气不好')).toEqual([
			{ kind: 'same', text: '今天天气' },
			{ kind: 'removed', text: '很' },
			{ kind: 'added', text: '不' },
			{ kind: 'same', text: '好' },
		])
	})

	it('never cuts a word in the shared start or end', () => {
		expect(diffText('foo', 'food')).toEqual([
			{ kind: 'removed', text: 'foo' },
			{ kind: 'added', text: 'food' },
		])
		expect(diffText('😀a', '😃a')).toEqual([
			{ kind: 'removed', text: '😀' },
			{ kind: 'added', text: '😃' },
			{ kind: 'same', text: 'a' },
		])
	})

	it('handles empty sides and equal texts', () => {
		expect(diffText('', '')).toEqual([])
		expect(diffText('same', 'same')).toEqual([{ kind: 'same', text: 'same' }])
		expect(diffText('', 'new')).toEqual([{ kind: 'added', text: 'new' }])
		expect(diffText('old', '')).toEqual([{ kind: 'removed', text: 'old' }])
	})

	it('always rebuilds both texts', () => {
		const samples = [
			['line one\nline two\n', 'line one\nline 2\nline three\n'],
			['# 标题\n\n第一段，有错字。\n', '# 标题\n\n第一段，没有错字了！\n\n新的一段'],
			['a b c d e f', 'f e d c b a'],
			['**bold** _it_', '__bold__ *it* `code`'],
		] as const
		for (const [before, after] of samples) {
			const parts = diffText(before, after)
			expect(sideOf(parts, 'added')).toBe(before)
			expect(sideOf(parts, 'removed')).toBe(after)
		}
	})

	it('falls back on large rewrites and still rebuilds both texts', () => {
		const before = Array.from({ length: 3000 }, (_, i) => `w${i}`).join(' ')
		const after = Array.from({ length: 3000 }, (_, i) => `x${i}`).join(' ')
		const parts = diffText(before, after)
		expect(sideOf(parts, 'added')).toBe(before)
		expect(sideOf(parts, 'removed')).toBe(after)
	})
})

describe('tokenize', () => {
	it('splits words, spaces, punctuation and CJK characters', () => {
		expect(tokenize('Hi, 你好 world_1!')).toEqual(['Hi', ',', ' ', '你', '好', ' ', 'world_1', '!'])
	})
})
