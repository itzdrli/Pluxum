import type { ShouldRevalidateFunctionArgs } from 'react-router'
import { describe, expect, it } from 'vitest'

import { shouldStartRich } from '../app/components/composer/composer'
import {
	nextMobileReplySheetOpen,
	resolveFloorJumpDirection,
} from '../app/components/shell/mobile-stage-bar'
import { buildPageHref } from '../app/components/ui/pager'
import { pageParam } from '../app/lib/forum-api.server'
import {
	categoryPageOf,
	categoryStageShouldRevalidate,
	keepOnThemeChange,
	stageShouldRevalidate,
} from '../app/lib/revalidate'
import { computeStageDepth } from '../app/routes/forum-stage'

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
	it('computes stage depth 0, 1, and 2 from params and pathname', () => {
		expect(computeStageDepth({}, '/')).toBe(0)
		expect(computeStageDepth({ slug: 'general' }, '/c/general')).toBe(1)
		expect(computeStageDepth({ slug: 'general', id: '42' }, '/c/general/t/42')).toBe(2)
		expect(computeStageDepth({ slug: 'general' }, '/c/general/new')).toBe(2)
	})

	it('keepOnThemeChange skips revalidation only on /theme action', () => {
		expect(keepOnThemeChange(revalidateArgs({ formAction: '/theme' }))).toBe(false)
		expect(keepOnThemeChange(revalidateArgs({ formAction: '/c/general/new' }))).toBe(true)
	})

	it('stageShouldRevalidate skips pure GET navigations and revalidates after mutations', () => {
		expect(stageShouldRevalidate(revalidateArgs())).toBe(false)
		expect(stageShouldRevalidate(revalidateArgs({ formMethod: 'GET' }))).toBe(false)
		expect(
			stageShouldRevalidate(revalidateArgs({ formAction: '/theme', formMethod: 'POST' })),
		).toBe(false)
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

	it('categoryStageShouldRevalidate keeps category thread list when switching threads or paginating thread posts', () => {
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

		expect(categoryPageOf(new URL('http://localhost/c/general/t/1?page=3'))).toBe(1)
		expect(categoryPageOf(new URL('http://localhost/c/general/t/1?cpage=2&page=3'))).toBe(2)
		expect(categoryPageOf(new URL('http://localhost/c/general?page=2'))).toBe(2)

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
