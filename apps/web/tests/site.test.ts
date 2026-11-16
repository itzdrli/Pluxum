import { describe, expect, it } from 'vitest'

import { DEFAULT_FOOTER, DEFAULT_SITE, pageTitle, siteOf } from '../app/lib/site'

const root = (name: string) => ({
	meta: { site: { name, tagline: '', description: '' }, footer: DEFAULT_FOOTER },
})

describe('site', () => {
	it('falls back to the defaults while the API is down', () => {
		expect(siteOf(undefined)).toBe(DEFAULT_SITE)
		expect(siteOf({ meta: null })).toBe(DEFAULT_SITE)
	})

	it('ends page titles in the configured name and skips empty parts', () => {
		expect(pageTitle(root('小站'), '通知')).toBe('通知 · 小站')
		expect(pageTitle(root('小站'), '发布主题', undefined)).toBe('发布主题 · 小站')
		expect(pageTitle(root('小站'))).toBe('小站')
	})
})
