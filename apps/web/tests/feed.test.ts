import { describe, expect, it } from 'vitest'

import { absolutizeHtml, clip, escapeXml, renderAtom, textOf } from '../app/lib/feed'

describe('feed helpers', () => {
	it('escapes markup and drops characters XML cannot hold', () => {
		expect(escapeXml(`<a href="x">Tom & 'Jerry'</a>\u0001`)).toBe(
			'&lt;a href=&quot;x&quot;&gt;Tom &amp; &apos;Jerry&apos;&lt;/a&gt;',
		)
	})

	it('reads the text of HTML on one line', () => {
		expect(textOf('<p>Hello&nbsp;<b>world</b></p>\n<p>&lt;3 &#x4F60;&#22909;</p>')).toBe(
			'Hello world <3 你好',
		)
		expect(textOf('<style>p{}</style><p>a</p>')).toBe('a')
	})

	it('clips by characters, not UTF-16 units', () => {
		expect(clip('abc', 3)).toBe('abc')
		expect(clip('😀😀😀😀', 3)).toBe('😀😀…')
	})

	it('makes site-relative links absolute and leaves the rest', () => {
		expect(
			absolutizeHtml(
				'<img src="/api/x.png"><a href="//cdn.example/y">y</a><a href="https://e.com/">e</a>',
				'https://f.example',
			),
		).toBe(
			'<img src="https://f.example/api/x.png"><a href="//cdn.example/y">y</a><a href="https://e.com/">e</a>',
		)
	})
})

describe('renderAtom', () => {
	it('writes a feed whose updated time is its newest entry', () => {
		const xml = renderAtom({
			title: 'Forum & co',
			pageUrl: 'https://f.example/',
			selfUrl: 'https://f.example/feed.xml',
			entries: [
				{
					url: 'https://f.example/t/1001',
					title: 'First',
					authorName: 'Ann',
					authorUrl: 'https://f.example/u/ann',
					published: '2026-01-01T00:00:00.000Z',
					updated: '2026-01-03T00:00:00.000Z',
					category: 'General',
					html: '<p>Hi</p>',
				},
				{
					url: 'https://f.example/t/1002',
					title: 'Second',
					authorName: 'Bo',
					authorUrl: 'https://f.example/u/bo',
					published: '2026-01-02T00:00:00.000Z',
					updated: '2026-01-02T00:00:00.000Z',
				},
			],
		})
		expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>\n<feed')).toBe(true)
		expect(xml).toContain('<title>Forum &amp; co</title>')
		expect(xml).toContain('<updated>2026-01-03T00:00:00.000Z</updated>\n<link rel="self"')
		expect(xml).toContain('<content type="html">&lt;p&gt;Hi&lt;/p&gt;</content>')
		expect(xml).toContain('<category term="General"/>')
		expect(xml.match(/<entry>/g)).toHaveLength(2)
	})

	it('writes an empty feed', () => {
		const xml = renderAtom({ title: 'F', pageUrl: 'p', selfUrl: 's', entries: [] })
		expect(xml).toContain('<updated>1970-01-01T00:00:00.000Z</updated>')
		expect(xml).not.toContain('<entry>')
	})
})
