import { describe, expect, it } from 'vitest'

import { homeSortOf } from '../app/lib/home'

describe('homeSortOf', () => {
	it('reads the three sorts and falls back to active', () => {
		expect(homeSortOf(new URL('http://x/?sort=new'))).toBe('new')
		expect(homeSortOf(new URL('http://x/?sort=hot&page=2'))).toBe('hot')
		expect(homeSortOf(new URL('http://x/'))).toBe('active')
		expect(homeSortOf(new URL('http://x/?sort=bogus'))).toBe('active')
	})
})
