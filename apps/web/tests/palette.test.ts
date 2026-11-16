import { describe, expect, it } from 'vitest'

import { fuzzyScore, parsePaletteQuery, rank } from '../app/lib/palette'

describe('parsePaletteQuery', () => {
	it('reads the mode prefixes', () => {
		expect(parsePaletteQuery('> 发布')).toEqual({ mode: 'commands', text: '发布' })
		expect(parsePaletteQuery('  #综合')).toEqual({ mode: 'categories', text: '综合' })
		expect(parsePaletteQuery('分页')).toEqual({ mode: 'all', text: '分页' })
		expect(parsePaletteQuery('')).toEqual({ mode: 'all', text: '' })
		expect(parsePaletteQuery('>')).toEqual({ mode: 'commands', text: '' })
	})
})

describe('fuzzyScore and rank', () => {
	it('prefers a contiguous, early match and allows scattered letters', () => {
		expect(fuzzyScore('abc', 'xx')).toBeNull()
		expect(fuzzyScore('', 'anything')).toBe(0)
		const contiguous = fuzzyScore('post', 'new post') ?? 0
		const scattered = fuzzyScore('post', 'pa o s t') ?? 0
		expect(contiguous).toBeGreaterThan(scattered)
		expect(fuzzyScore('post', 'post it')).toBeGreaterThan(fuzzyScore('post', 'a post') ?? 0)
		expect(fuzzyScore('PoSt', 'post')).not.toBeNull()
	})

	it('ranks by label and keywords, dropping non-matches, keeping ties in order', () => {
		const items = [
			{ label: '审核队列', keywords: ['举报'] },
			{ label: '搜索', keywords: ['查找', 'search'] },
			{ label: '通知', keywords: [] },
			{ label: '搜索历史', keywords: [] },
		]
		const labels = (query: string) => rank(items, query, (item) => item).map((item) => item.label)
		expect(labels('搜索')).toEqual(['搜索', '搜索历史'])
		expect(labels('search')).toEqual(['搜索'])
		expect(labels('举报')).toEqual(['审核队列'])
		expect(labels('')).toEqual(['审核队列', '搜索', '通知', '搜索历史'])
		expect(labels('zzz')).toEqual([])
	})
})
