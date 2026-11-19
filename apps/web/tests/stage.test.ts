import type { ShouldRevalidateFunctionArgs } from 'react-router'
import { describe, expect, it } from 'vitest'

import { shouldStartRich } from '../app/components/composer/composer'
import {
	nextMobileReplySheetOpen,
	resolveFloorJumpDirection,
} from '../app/components/shell/mobile-stage-bar'
import { buildPageHref } from '../app/components/ui/pager'
import { pageParam } from '../app/lib/forum-api.server'
import { stageShouldRevalidate } from '../app/lib/revalidate'
import {
	defineStage,
	listPageOf,
	listPathOf,
	pagePathOf,
	listShouldRevalidate,
	resolveStage,
	stageDetailHref,
	stageMotion,
	type StageMatch,
} from '../app/lib/stage'

const categoryList = defineStage({ layer: 'list', nav: true, backLabel: '列表' })
const searchList = defineStage({
	layer: 'list',
	carry: ['q', 'categoryId', 'authorId', 'threadsOnly'],
	backLabel: '结果',
})
const userList = defineStage({ layer: 'list', backLabel: '主页' })
const detail = defineStage({ layer: 'detail' })

function stageAt(href: string, chain: ReadonlyArray<[string, string, unknown]>) {
	const matches: StageMatch[] = [
		{ id: 'root', pathname: '/', handle: undefined },
		{ id: 'routes/forum-stage', pathname: '/', handle: undefined },
		...chain.map(([id, pathname, handle]) => ({ id, pathname, handle })),
	]
	return resolveStage(matches, new URL(href, 'http://localhost'))
}

function args(current: string, next: string): ShouldRevalidateFunctionArgs {
	return revalidateArgs({
		currentUrl: new URL(current, 'http://localhost'),
		nextUrl: new URL(next, 'http://localhost'),
	})
}

function revalidateArgs(
	overrides: Partial<ShouldRevalidateFunctionArgs> = {},
): ShouldRevalidateFunctionArgs {
	return {
		currentUrl: new URL('http://localhost/c/general/t/1'),
		nextUrl: new URL('http://localhost/c/general/t/2'),
		currentParams: { slug: 'general', id: '1' },
		nextParams: { slug: 'general', id: '2' },
		defaultShouldRevalidate: true,
		...overrides,
	}
}

describe('3-Depth Stage Manager routing & revalidation', () => {
	it('resolves depth, panes and links from the route handles', () => {
		const home = stageAt('/', [
			['routes/home', '/', defineStage({ layer: 'page', nav: true, wide: true })],
		])
		expect(home).toMatchObject({ depth: 0, nav: true, split: true, listHref: null })
		expect(
			stageAt('/notifications', [['routes/notifications', '/notifications', undefined]]).depth,
		).toBe(0)

		const category = stageAt('/c/general?page=2', [['routes/category', '/c/general', categoryList]])
		expect(category).toMatchObject({
			depth: 1,
			nav: true,
			split: true,
			listHref: '/c/general?cpage=2',
		})
		expect(stageDetailHref(category, '42')).toBe('/c/general/t/42?cpage=2')

		const thread = stageAt('/c/general/t/42?cpage=2&page=3', [
			['routes/category', '/c/general', categoryList],
			['routes/thread', '/c/general/t/42', detail],
		])
		expect(thread).toMatchObject({
			depth: 2,
			listHref: '/c/general?cpage=2',
			detailKey: '/c/general/t/42',
			backLabel: '列表',
		})
		expect(
			stageAt('/c/general/new', [
				['routes/category', '/c/general', categoryList],
				['routes/thread-new', '/c/general/new', detail],
			]).depth,
		).toBe(2)

		const search = stageAt('/search/t/7?q=pg&threadsOnly=1&page=2&cpage=3', [
			['routes/search', '/search', searchList],
			['routes/search-thread', '/search/t/7', detail],
		])
		expect(search).toMatchObject({
			depth: 2,
			nav: false,
			listHref: '/search?q=pg&threadsOnly=1&cpage=3',
			backLabel: '结果',
		})
		expect(stageDetailHref(search, '9', 'p1')).toBe(
			'/search/t/9?q=pg&threadsOnly=1&cpage=3#post-p1',
		)

		// A floor past the first goes through `?floor=`, which the thread page turns into its page.
		expect(stageDetailHref(search, '9', 14)).toBe(
			'/search/t/9?q=pg&threadsOnly=1&cpage=3&floor=14#post-14',
		)

		const profile = stageAt('/u/5', [['routes/user', '/u/5', userList]])
		expect(stageDetailHref(profile, '9')).toBe('/u/5/t/9')
	})

	it('derives the motion of a transition from the two stages', () => {
		const list = { depth: 1 as const, listKey: '/c/a', detailKey: null }
		const open = { depth: 2 as const, listKey: '/c/a', detailKey: '/c/a/t/1' }
		expect(stageMotion({ depth: 0, listKey: null, detailKey: null }, list)).toBe('push')
		expect(stageMotion(list, open)).toBe('push')
		expect(stageMotion(open, list)).toBe('pop')
		expect(stageMotion(open, { ...open, detailKey: '/c/a/t/2' })).toBe('detail')
		expect(stageMotion(list, { ...list, listKey: '/c/b' })).toBe('list')
		expect(stageMotion(open, open)).toBe('none')
	})

	it('listShouldRevalidate keeps a search list while threads beside it change', () => {
		const shouldRevalidate = listShouldRevalidate(['q', 'threadsOnly'])
		expect(shouldRevalidate(args('/search?q=pg', '/search/t/1?q=pg'))).toBe(false)
		expect(shouldRevalidate(args('/search/t/1?q=pg', '/search/t/2?q=pg&page=2'))).toBe(false)
		expect(shouldRevalidate(args('/search?q=pg&page=2', '/search/t/1?q=pg&cpage=2'))).toBe(false)
		expect(shouldRevalidate(args('/search/t/1?q=pg', '/search?q=mysql'))).toBe(true)
		expect(shouldRevalidate(args('/search/t/1?q=pg', '/search/t/1?q=pg&threadsOnly=1'))).toBe(true)
		expect(listPathOf('/u/5/t/9')).toBe('/u/5')
		expect(pagePathOf(new URL('https://f.test/c/general/t/1002.data?page=2'))).toBe(
			'/c/general/t/1002',
		)
		expect(pagePathOf(new URL('https://f.test/_root.data'))).toBe('/')
		expect(pagePathOf(new URL('https://f.test/c/general/t/1002'))).toBe('/c/general/t/1002')
		expect(listPathOf('/c/general/new/')).toBe('/c/general')
	})

	it('stageShouldRevalidate skips pure GET navigations and revalidates after mutations', () => {
		expect(stageShouldRevalidate(revalidateArgs())).toBe(false)
		expect(stageShouldRevalidate(revalidateArgs({ formMethod: 'GET' }))).toBe(false)
		expect(
			stageShouldRevalidate(
				revalidateArgs({ formAction: '/ext/reactions/toggle', formMethod: 'POST' }),
			),
		).toBe(false)
		expect(
			stageShouldRevalidate(revalidateArgs({ formAction: '/c/general/t/1', formMethod: 'POST' })),
		).toBe(true)
		expect(
			stageShouldRevalidate(revalidateArgs({ formAction: '/c/general/t/1', formMethod: 'DELETE' })),
		).toBe(true)
		// Explicit revalidator.revalidate() keeps identical URL with no formMethod
		expect(
			stageShouldRevalidate(
				revalidateArgs({
					currentUrl: new URL('http://localhost/c/general/t/1'),
					nextUrl: new URL('http://localhost/c/general/t/1'),
				}),
			),
		).toBe(true)
	})

	it('a category list keeps its thread list when switching threads or paginating thread posts', () => {
		const categoryStageShouldRevalidate = listShouldRevalidate()
		// Navigating /c/general/t/1 -> /c/general/t/2 keeps Pane 2 without refetching
		expect(categoryStageShouldRevalidate(revalidateArgs())).toBe(false)

		// Navigating /c/general -> /c/general/new keeps Pane 2 without refetching
		expect(
			categoryStageShouldRevalidate(
				revalidateArgs({
					currentUrl: new URL('http://localhost/c/general'),
					nextUrl: new URL('http://localhost/c/general/new'),
					currentParams: { slug: 'general' },
					nextParams: { slug: 'general' },
				}),
			),
		).toBe(false)

		// Paginating thread posts (?page=1 -> ?page=2) does NOT revalidate category thread list
		expect(
			categoryStageShouldRevalidate(
				revalidateArgs({
					currentUrl: new URL('http://localhost/c/general/t/1?page=1'),
					nextUrl: new URL('http://localhost/c/general/t/1?page=2'),
				}),
			),
		).toBe(false)

		// Clicking a thread from /c/general?cpage=2 -> /c/general/t/123?cpage=2 keeps Pane 2 page 2 without refetching
		expect(
			categoryStageShouldRevalidate(
				revalidateArgs({
					currentUrl: new URL('http://localhost/c/general?cpage=2'),
					nextUrl: new URL('http://localhost/c/general/t/123?cpage=2'),
					currentParams: { slug: 'general' },
					nextParams: { slug: 'general', id: '123' },
				}),
			),
		).toBe(false)

		// Legacy /c/general?page=2 -> /c/general/t/123?cpage=2 also keeps Pane 2 page 2 without refetching
		expect(
			categoryStageShouldRevalidate(
				revalidateArgs({
					currentUrl: new URL('http://localhost/c/general?page=2'),
					nextUrl: new URL('http://localhost/c/general/t/123?cpage=2'),
					currentParams: { slug: 'general' },
					nextParams: { slug: 'general', id: '123' },
				}),
			),
		).toBe(false)

		// Switching category slug revalidates
		expect(
			categoryStageShouldRevalidate(
				revalidateArgs({
					currentUrl: new URL('http://localhost/c/general'),
					nextUrl: new URL('http://localhost/c/plugins'),
					currentParams: { slug: 'general' },
					nextParams: { slug: 'plugins' },
				}),
			),
		).toBe(true)

		// Changing ?cpage= on a thread route revalidates Pane 2
		expect(
			categoryStageShouldRevalidate(
				revalidateArgs({
					currentUrl: new URL('http://localhost/c/general/t/1?cpage=1&page=3'),
					nextUrl: new URL('http://localhost/c/general/t/1?cpage=2&page=3'),
				}),
			),
		).toBe(true)

		// Changing ?page= on /c/general exact revalidates
		expect(
			categoryStageShouldRevalidate(
				revalidateArgs({
					currentUrl: new URL('http://localhost/c/general?page=1'),
					nextUrl: new URL('http://localhost/c/general?page=2'),
				}),
			),
		).toBe(true)

		// Extension action (/ext/*) does NOT revalidate category thread list
		expect(
			categoryStageShouldRevalidate(
				revalidateArgs({
					formMethod: 'POST',
					formAction: '/ext/reactions/toggle',
				}),
			),
		).toBe(false)

		// Explicit revalidator.revalidate() passes through defaultShouldRevalidate
		expect(
			categoryStageShouldRevalidate(
				revalidateArgs({
					currentUrl: new URL('http://localhost/c/general/t/1?cpage=2'),
					nextUrl: new URL('http://localhost/c/general/t/1?cpage=2'),
				}),
			),
		).toBe(true)

		// Submitting a forum mutation revalidates
		expect(
			categoryStageShouldRevalidate(
				revalidateArgs({
					formMethod: 'POST',
					formAction: '/c/general/t/1',
				}),
			),
		).toBe(true)
	})

	it('orthogonal pagination helpers parse and build ?cpage= and ?page= independently', () => {
		expect(pageParam(new Request('http://localhost/c/general?page=3'))).toBe(3)
		expect(pageParam(new Request('http://localhost/c/general/t/1?cpage=4&page=2'), 'cpage')).toBe(4)
		expect(pageParam(new Request('http://localhost/c/general/t/1?page=2'), 'cpage')).toBe(1)

		expect(listPageOf(new URL('http://localhost/c/general/t/1?page=3'), true)).toBe(1)
		expect(listPageOf(new URL('http://localhost/c/general/t/1?cpage=2&page=3'), true)).toBe(2)
		expect(listPageOf(new URL('http://localhost/c/general?page=2'), false)).toBe(2)

		expect(buildPageHref('/c/general/t/1', '?cpage=2', 3, 'page')).toBe(
			'/c/general/t/1?cpage=2&page=3',
		)
		expect(buildPageHref('/c/general/t/1', '?cpage=2&page=3', 1, 'page')).toBe(
			'/c/general/t/1?cpage=2',
		)
		expect(buildPageHref('/c/general/t/1', '?cpage=2&page=3', 4, 'cpage')).toBe(
			'/c/general/t/1?cpage=4&page=3',
		)
		expect(buildPageHref('/c/general', '?page=2', 3, 'cpage')).toBe('/c/general?cpage=3')
		expect(buildPageHref('/search', '?q=pg&page=2', 3, 'cpage')).toBe('/search?q=pg&cpage=3')
	})
})

describe('Mobile stage bar & deferred composer helpers', () => {
	it('resolveFloorJumpDirection switches between bottom and top around 240px scroll', () => {
		expect(resolveFloorJumpDirection(0)).toBe('bottom')
		expect(resolveFloorJumpDirection(240)).toBe('bottom')
		expect(resolveFloorJumpDirection(241)).toBe('top')
		expect(resolveFloorJumpDirection(1200)).toBe('top')
	})

	it('nextMobileReplySheetOpen closes on reply success or thread change and stays open on error', () => {
		expect(
			nextMobileReplySheetOpen({
				isOpen: true,
				threadChanged: false,
				prevTotal: 3,
				nextTotal: 4,
			}),
		).toBe(false)
		expect(
			nextMobileReplySheetOpen({
				isOpen: true,
				threadChanged: true,
				prevTotal: 3,
				nextTotal: 3,
			}),
		).toBe(false)
		expect(
			nextMobileReplySheetOpen({
				isOpen: true,
				threadChanged: false,
				prevTotal: 3,
				nextTotal: 3,
			}),
		).toBe(true)
		expect(
			nextMobileReplySheetOpen({
				isOpen: false,
				threadChanged: false,
				prevTotal: 3,
				nextTotal: 3,
			}),
		).toBe(false)
	})

	it('shouldStartRich stays in source when deferRich is enabled even if rich editor is cached', () => {
		expect(
			shouldStartRich({
				format: 'markdown',
				source: '',
				hasRichModule: true,
				sourcePreferred: false,
				deferRich: true,
			}),
		).toBe(false)
		expect(
			shouldStartRich({
				format: 'markdown',
				source: '',
				hasRichModule: true,
				sourcePreferred: false,
				deferRich: false,
			}),
		).toBe(true)
		expect(
			shouldStartRich({
				format: 'markdown',
				source: '',
				hasRichModule: true,
				sourcePreferred: true,
				deferRich: false,
			}),
		).toBe(false)
		expect(
			shouldStartRich({
				format: 'plain',
				source: '',
				hasRichModule: true,
				sourcePreferred: false,
				deferRich: false,
			}),
		).toBe(false)
	})
})
