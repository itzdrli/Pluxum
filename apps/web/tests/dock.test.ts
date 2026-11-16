import { describe, expect, it } from 'vitest'

import { droppedLink, toggledSize } from '../app/lib/dock'

const ORIGIN = 'https://forum.example'

describe('droppedLink', () => {
	it('turns a dragged thread anchor into a titled forum link', () => {
		expect(
			droppedLink(
				{
					uriList: `${ORIGIN}/c/general/t/1019?cpage=2\r\n`,
					plain: '',
					html: '<a href="/c/general/t/1019">盖楼 &amp; 回复</a>',
				},
				ORIGIN,
			),
		).toEqual({ text: '盖楼 & 回复', href: '/c/general/t/1019' })
	})

	it('falls back to the path as text and accepts plain URLs, floors and profiles', () => {
		expect(droppedLink({ uriList: '', plain: `${ORIGIN}/t/1001/3`, html: '' }, ORIGIN)).toEqual({
			text: '/t/1001/3',
			href: '/t/1001/3',
		})
		expect(droppedLink({ uriList: `${ORIGIN}/u/alice`, plain: '', html: '' }, ORIGIN)?.href).toBe(
			'/u/alice',
		)
	})

	it('refuses other sites and other pages', () => {
		expect(
			droppedLink({ uriList: 'https://evil.example/t/1', plain: '', html: '' }, ORIGIN),
		).toBeNull()
		expect(droppedLink({ uriList: `${ORIGIN}/search?q=a`, plain: '', html: '' }, ORIGIN)).toBeNull()
		expect(droppedLink({ uriList: '', plain: 'just words', html: '' }, ORIGIN)).toBeNull()
		expect(droppedLink({ uriList: '', plain: '', html: '' }, ORIGIN)).toBeNull()
	})
})

describe('toggledSize', () => {
	it('swaps half and full', () => {
		expect(toggledSize('half')).toBe('full')
		expect(toggledSize('full')).toBe('half')
		expect(toggledSize('min')).toBe('full')
	})
})
