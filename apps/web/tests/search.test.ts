import { describe, expect, it } from 'vitest'

import { buildPageHref } from '../app/components/ui/pager'
import { buildSearchApiPath } from '../app/lib/forum-api.server'
import { buildSearchHitHref, parseSearchUrl } from '../app/routes/search'

describe('search route & API helpers', () => {
	it('builds /search API query strings omitting unset defaults', () => {
		expect(buildSearchApiPath({ query: '乒乓球拍' })).toBe(
			`/search?q=${encodeURIComponent('乒乓球拍')}`,
		)
		expect(
			buildSearchApiPath({
				query: 'PostgreSQL 检索',
				categoryId: 'cat-1',
				authorId: 'user-1',
				threadsOnly: true,
				page: 3,
				pageSize: 20,
			}),
		).toBe(
			`/search?q=${encodeURIComponent('PostgreSQL 检索').replaceAll('%20', '+')}&categoryId=cat-1&authorId=user-1&threadsOnly=true&page=3&pageSize=20`,
		)
	})

	it('parses /search URL query parameters cleanly', () => {
		expect(parseSearchUrl(new URL('http://localhost/search'))).toEqual({
			query: '',
			categoryId: '',
			authorId: undefined,
			threadsOnly: false,
		})
		expect(
			parseSearchUrl(
				new URL(
					'http://localhost/search?q=+%E4%BA%91%E5%8E%9F%E7%94%9F+&categoryId=c1&threadsOnly=1',
				),
			),
		).toEqual({
			query: '云原生',
			categoryId: 'c1',
			authorId: undefined,
			threadsOnly: true,
		})
	})

	it('opens hits beside the results, carrying the query, and anchors replies on their post', () => {
		const stage = { listPath: '/search', listHref: '/search?q=PostgreSQL&cpage=2' }
		expect(buildSearchHitHref({ postId: 'p1', threadId: 't1', opening: true }, stage)).toBe(
			'/search/t/t1?q=PostgreSQL&cpage=2',
		)
		expect(buildSearchHitHref({ postId: 'p2', threadId: 't1', opening: false }, stage)).toBe(
			'/search/t/t1?q=PostgreSQL&cpage=2#post-p2',
		)
		expect(
			buildSearchHitHref(
				{ postId: 'p2', threadId: 't1', opening: false },
				{ listPath: null, listHref: null },
			),
		).toBe('/t/t1#post-p2')
	})

	it('preserves search filters across pagination links', () => {
		expect(buildPageHref('/search', '?q=PostgreSQL&categoryId=c1&threadsOnly=1', 2)).toBe(
			'/search?q=PostgreSQL&categoryId=c1&threadsOnly=1&page=2',
		)
		expect(buildPageHref('/search', '?q=PostgreSQL&categoryId=c1&threadsOnly=1&page=2', 1)).toBe(
			'/search?q=PostgreSQL&categoryId=c1&threadsOnly=1',
		)
	})
})
