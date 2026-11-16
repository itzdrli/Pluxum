import { describe, expect, it } from 'vitest'

import { withoutLeadingTitle } from '../app/lib/post-html'

describe('withoutLeadingTitle', () => {
	it('drops a first heading that repeats the thread title', () => {
		expect(
			withoutLeadingTitle('<h2>Hello &amp; welcome</h2>\n<p>Body</p>', 'Hello & welcome'),
		).toBe('<p>Body</p>')
		expect(withoutLeadingTitle('<h2><em>Plan</em></h2><p>x</p>', ' Plan ')).toBe('<p>x</p>')
	})

	it('keeps a different heading, a later heading and plain text', () => {
		const other = '<h2>Other</h2><p>x</p>'
		expect(withoutLeadingTitle(other, 'Title')).toBe(other)
		const later = '<p>x</p><h2>Title</h2>'
		expect(withoutLeadingTitle(later, 'Title')).toBe(later)
		expect(withoutLeadingTitle('<p>Title</p>', 'Title')).toBe('<p>Title</p>')
	})
})
