import type { PostDto, ThreadDto } from '@pluxum/domain'
import { I18nProvider } from '@lingui/react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import { createI18n } from '../app/lib/i18n'
import { loadMessages } from '../app/lib/i18n.server'
import { AcceptedMark, SolutionPin, SolvedBadge } from '../app/slots/forum-solved/solved'

const zh = createI18n('zh-CN')
const en = createI18n('en', await loadMessages('en'))

const author = { id: 'u1', handle: 'bob', displayName: 'Bob' }

const thread = (ext: ThreadDto['ext'] = {}): ThreadDto => ({
	id: 't1',
	number: 1001,
	slug: '',
	ref: '1001',
	categoryId: 'c1',
	kind: 'topic',
	title: 'How?',
	author,
	createdAt: '2026-11-19T00:00:00.000Z',
	lastPostAt: '2026-11-19T00:00:00.000Z',
	replyCount: 2,
	pinned: false,
	locked: false,
	ext,
})

const post = (number: number, ext: PostDto['ext'] = {}): PostDto => ({
	id: `p${number}`,
	threadId: 't1',
	number,
	parentId: null,
	replyTo: null,
	author,
	body: 'x',
	bodyHtml: '<p>x</p>',
	bodyFormat: 'markdown',
	createdAt: '2026-11-19T00:00:00.000Z',
	editedAt: null,
	deleted: false,
	can: { edit: false, delete: false },
	ext,
})

const SOLVED = {
	'forum-solved': {
		postId: 'p3',
		floor: 3,
		excerpt: 'Use the docs.',
		author,
		acceptedAt: '2026-11-19T00:00:00.000Z',
	},
}

const html = (element: ReturnType<typeof createElement>, i18n = zh) =>
	renderToStaticMarkup(
		createElement(
			I18nProvider,
			{ i18n },
			createElement(MemoryRouter, { initialEntries: ['/t/1001'] }, element),
		),
	)

describe('forum-solved slots', () => {
	it('speaks the interface language', () => {
		expect(html(createElement(SolvedBadge, { thread: thread(SOLVED) }), en)).toContain('Solved')
		expect(html(createElement(AcceptedMark, { post: post(3, SOLVED) }), en)).not.toContain('已采纳')
	})

	it('badges solved threads only', () => {
		expect(html(createElement(SolvedBadge, { thread: thread(SOLVED) }))).toContain('已解决')
		expect(html(createElement(SolvedBadge, { thread: thread() }))).toBe('')
		// Data of another shape is ignored rather than trusted.
		expect(
			html(createElement(SolvedBadge, { thread: thread({ 'forum-solved': { floor: 'x' } }) })),
		).toBe('')
	})

	it('pins the answer under the opening post and links to its floor', () => {
		const pinned = html(createElement(SolutionPin, { post: post(1), thread: thread(SOLVED) }))
		expect(pinned).toContain('已采纳的答案')
		expect(pinned).toContain('Bob · #3')
		expect(pinned).toContain('Use the docs.')
		expect(pinned).toContain('href="/t/1001?floor=3"')
		expect(html(createElement(SolutionPin, { post: post(2), thread: thread(SOLVED) }))).toBe('')
		expect(html(createElement(SolutionPin, { post: post(1), thread: thread() }))).toBe('')
	})

	it('marks the accepted post', () => {
		expect(
			html(createElement(AcceptedMark, { post: post(3, { 'forum-solved': { accepted: true } }) })),
		).toContain('已采纳的答案')
		expect(html(createElement(AcceptedMark, { post: post(2) }))).toBe('')
	})
})
