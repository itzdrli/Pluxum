import { describe, expect, it } from 'vitest'

import { mergeFooter, type FooterConfig } from '../app/lib/footer'

const base: FooterConfig = {
	tagline: 't',
	groups: [{ title: '社区', links: [{ label: '版块', href: '/' }] }],
	icons: [{ label: 'GitHub', href: 'https://github.com/x', icon: 'github' }],
	notes: [],
}

describe('mergeFooter', () => {
	it('keeps the config as is without plugin links', () => {
		expect(mergeFooter(base, undefined)).toBe(base)
	})

	it('joins columns by title, appends new ones and skips repeated icon hrefs', () => {
		const merged = mergeFooter(base, {
			groups: [
				{ title: '社区', links: [{ label: '规则', href: '/rules' }] },
				{ title: '文档', links: [{ label: 'API', href: 'https://example.com' }] },
			],
			icons: [
				{ label: 'Repo', href: 'https://github.com/x', icon: 'github' },
				{ label: 'RSS', href: '/feed.xml', icon: 'rss' },
			],
		})
		expect(merged.groups).toEqual([
			{
				title: '社区',
				links: [
					{ label: '版块', href: '/' },
					{ label: '规则', href: '/rules' },
				],
			},
			{ title: '文档', links: [{ label: 'API', href: 'https://example.com' }] },
		])
		expect(merged.icons.map((icon) => icon.label)).toEqual(['GitHub', 'RSS'])
		// The config itself is not changed.
		expect(base.groups[0]?.links).toHaveLength(1)
	})
})
