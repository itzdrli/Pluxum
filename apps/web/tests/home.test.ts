import { describe, expect, it } from 'vitest'

import { feedQuery, homeFeedHref, homeFeedOf } from '../app/lib/home'

const url = (search: string) => new URL(`http://x/${search}`)
const NONE = { available: false, any: false }
const READY = { available: true, any: true }
const EMPTY = { available: true, any: false }

describe('homeFeedOf', () => {
	it('reads the tab and 「最新」s order', () => {
		expect(homeFeedOf(url('?tab=hot&page=2'), READY)).toEqual({ tab: 'hot', order: 'active' })
		expect(homeFeedOf(url('?tab=latest'), READY)).toEqual({ tab: 'latest', order: 'active' })
		expect(homeFeedOf(url('?tab=latest&order=new'), READY)).toEqual({ tab: 'latest', order: 'new' })
		expect(homeFeedOf(url('?tab=following'), EMPTY)).toEqual({ tab: 'following', order: 'active' })
	})

	it('defaults to 「关注」 only for readers who follow something', () => {
		expect(homeFeedOf(url(''), READY).tab).toBe('following')
		expect(homeFeedOf(url(''), EMPTY).tab).toBe('hot')
		expect(homeFeedOf(url(''), NONE).tab).toBe('hot')
		expect(homeFeedOf(url(''), undefined).tab).toBe('hot')
		expect(homeFeedOf(url('?tab=bogus'), NONE).tab).toBe('hot')
	})

	it('falls back to 「热门」 when there is no 「关注」 feed', () => {
		expect(homeFeedOf(url('?tab=following'), NONE).tab).toBe('hot')
	})

	it('keeps links from before the tabs working', () => {
		expect(homeFeedOf(url('?sort=hot'), READY)).toEqual({ tab: 'hot', order: 'active' })
		expect(homeFeedOf(url('?sort=active'), READY)).toEqual({ tab: 'latest', order: 'active' })
		expect(homeFeedOf(url('?sort=new'), READY)).toEqual({ tab: 'latest', order: 'new' })
	})
})

describe('feedQuery and homeFeedHref', () => {
	it('turn a feed into the API query and back into a URL', () => {
		expect(feedQuery({ tab: 'following', order: 'new' })).toEqual({
			sort: 'active',
			scope: 'following',
		})
		expect(feedQuery({ tab: 'hot', order: 'active' })).toEqual({ sort: 'hot', scope: 'all' })
		expect(feedQuery({ tab: 'latest', order: 'new' })).toEqual({ sort: 'new', scope: 'all' })
		expect(homeFeedHref({ tab: 'latest', order: 'new' })).toBe('/?tab=latest&order=new')
		expect(homeFeedHref({ tab: 'following', order: 'new' })).toBe('/?tab=following')
	})
})
