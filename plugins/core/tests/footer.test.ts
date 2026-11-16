import { describe, expect, it } from 'vitest'

import { FooterLinkRegistry, isFooterHref } from '../src/footer'

const linkTo = (href: string) => ({ id: 'x', group: 'G', links: [{ label: 'L', href }] })

describe('footer link registry', () => {
	it('merges columns by title and drops repeated icon hrefs', () => {
		const registry = new FooterLinkRegistry()
		registry.register({
			id: 'docs',
			group: '文档',
			links: [{ label: '入门', href: '/t/1' }],
			icons: [{ label: 'GitHub', href: 'https://github.com/x', icon: 'github' }],
		})
		registry.register({
			id: 'more-docs',
			group: '文档',
			links: [{ label: 'API', href: 'https://example.com/api' }],
			icons: [{ label: 'Repo', href: 'https://github.com/x', icon: 'github' }],
		})
		registry.register({ id: 'feed', icons: [{ label: 'RSS', href: '/feed.xml', icon: 'rss' }] })
		expect(registry.list()).toEqual({
			groups: [
				{
					title: '文档',
					links: [
						{ label: '入门', href: '/t/1' },
						{ label: 'API', href: 'https://example.com/api' },
					],
				},
			],
			icons: [
				{ label: 'GitHub', href: 'https://github.com/x', icon: 'github' },
				{ label: 'RSS', href: '/feed.xml', icon: 'rss' },
			],
		})
	})

	it('withdraws exactly its own registration', () => {
		const registry = new FooterLinkRegistry()
		const dispose = registry.register({
			id: 'feed',
			icons: [{ label: 'RSS', href: '/f', icon: 'rss' }],
		})
		dispose()
		expect(registry.list()).toEqual({ groups: [], icons: [] })
		const again = registry.register({
			id: 'feed',
			icons: [{ label: 'RSS', href: '/f', icon: 'rss' }],
		})
		dispose()
		expect(registry.list().icons).toHaveLength(1)
		again()
		expect(registry.list().icons).toHaveLength(0)
	})

	it('refuses unsafe or malformed contributions', () => {
		const registry = new FooterLinkRegistry()
		for (const href of [
			'javascript:alert(1)',
			'//evil.example',
			'data:text/html,x',
			'',
			'ftp://h/',
		]) {
			expect(() => registry.register(linkTo(href))).toThrow(TypeError)
		}
		expect(() => registry.register({ id: 'x' })).toThrow(/at least one link/)
		expect(() => registry.register({ id: 'x', links: [{ label: 'L', href: '/a' }] })).toThrow(
			/group title/,
		)
		expect(() =>
			// @ts-expect-error -- deliberately not one of FOOTER_ICONS
			registry.register({ id: 'x', icons: [{ label: 'L', href: '/a', icon: 'discord' }] }),
		).toThrow(/unknown icon/)
		expect(() =>
			registry.register({ id: 'Bad ID', icons: [{ label: 'L', href: '/a', icon: 'rss' }] }),
		).toThrow(/Invalid footer contributor ID/)
		registry.register({ id: 'x', icons: [{ label: 'L', href: '/a', icon: 'rss' }] })
		expect(() =>
			registry.register({ id: 'x', icons: [{ label: 'M', href: '/b', icon: 'rss' }] }),
		).toThrow(/already registered/)
	})

	it('accepts forum paths and http(s) URLs only', () => {
		expect(isFooterHref('/c/general')).toBe(true)
		expect(isFooterHref('https://example.com')).toBe(true)
		expect(isFooterHref('http://example.com/a?b')).toBe(true)
		expect(isFooterHref('/\\evil.example')).toBe(false)
		expect(isFooterHref('mailto:a@b.c')).toBe(false)
	})
})
