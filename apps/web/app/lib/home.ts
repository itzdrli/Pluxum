// The overview page's feed: three tabs, 「关注」 / 「热门」 / 「最新」, and for 「最新」 a second
// choice of order (latest activity, or newly started).

import type { ViewerDto } from '@pluxum/domain'
import { msg } from '@lingui/core/macro'

export const HOME_TABS = [
	{ id: 'following', label: msg({ message: '关注', context: 'home feed tab' }) },
	{ id: 'hot', label: msg`热门` },
	{ id: 'latest', label: msg`最新` },
] as const

export type HomeTab = (typeof HOME_TABS)[number]['id']

export const LATEST_ORDERS = [
	{ id: 'active', label: msg`最近回复` },
	{ id: 'new', label: msg`新发布` },
] as const

export type LatestOrder = (typeof LATEST_ORDERS)[number]['id']

export type HomeFeed = Readonly<{ tab: HomeTab; order: LatestOrder }>

/** What the API is asked for a feed: its `sort`, and `scope` for 「关注」. */
export function feedQuery(feed: HomeFeed): Readonly<{
	sort: 'active' | 'new' | 'hot'
	scope: 'all' | 'following'
}> {
	if (feed.tab === 'following') return { sort: 'active', scope: 'following' }
	if (feed.tab === 'hot') return { sort: 'hot', scope: 'all' }
	return { sort: feed.order, scope: 'all' }
}

/**
 * The feed a URL asks for. `?tab=` names it (`order=new` for 「最新」 by start); links from before
 * the tabs used `?sort=active|new|hot` and still work. Without either, signed-in readers who
 * follow something see 「关注」 and everyone else 「热门」. 「关注」 without a follow plugin, or for a
 * guest, falls back to 「热门」.
 */
export function homeFeedOf(url: URL, following: ViewerDto['following'] | undefined): HomeFeed {
	const params = url.searchParams
	const order: LatestOrder = params.get('order') === 'new' ? 'new' : 'active'
	const asked = HOME_TABS.find((tab) => tab.id === params.get('tab'))?.id
	const legacy = params.get('sort')
	const tab: HomeTab =
		asked ??
		(legacy === 'hot'
			? 'hot'
			: legacy === 'active' || legacy === 'new'
				? 'latest'
				: following?.available === true && following.any
					? 'following'
					: 'hot')
	if (tab === 'following' && following?.available !== true) return { tab: 'hot', order }
	return { tab, order: asked === undefined && legacy === 'new' ? 'new' : order }
}

/** The URL of a feed. */
export function homeFeedHref(feed: HomeFeed): string {
	if (feed.tab === 'latest' && feed.order === 'new') return '/?tab=latest&order=new'
	return `/?tab=${feed.tab}`
}

/** Page size of the overview feed. */
export const HOME_PAGE_SIZE = 20
