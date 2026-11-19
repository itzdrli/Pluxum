import { describe, expect, it } from 'vitest'

import { DEFAULT_LOCALE, LOCALE_COOKIE, localeCookie, localeFromRequest } from '../app/lib/locale'

// Only the headers matter, and a real Request would silently drop the forbidden `cookie` one.
const request = (headers: Record<string, string>) => ({ headers: new Headers(headers) })

describe('locale', () => {
	it('prefers the cookie over Accept-Language', () => {
		expect(
			localeFromRequest(request({ cookie: `${LOCALE_COOKIE}=en`, 'accept-language': 'zh' })),
		).toBe('en')
		expect(
			localeFromRequest(
				request({ cookie: `a=b; ${LOCALE_COOKIE}=zh-CN`, 'accept-language': 'en' }),
			),
		).toBe('zh-CN')
	})

	it('ignores an unknown cookie value and falls through to Accept-Language', () => {
		expect(
			localeFromRequest(request({ cookie: `${LOCALE_COOKIE}=fr`, 'accept-language': 'en-US' })),
		).toBe('en')
	})

	it('picks the first supported language of Accept-Language', () => {
		expect(localeFromRequest(request({ 'accept-language': 'fr-FR,en;q=0.8,zh;q=0.5' }))).toBe('en')
		expect(localeFromRequest(request({ 'accept-language': 'zh-TW,zh;q=0.9' }))).toBe('zh-CN')
	})

	it('falls back to the default language', () => {
		expect(localeFromRequest(request({}))).toBe(DEFAULT_LOCALE)
		expect(localeFromRequest(request({ 'accept-language': 'fr,de' }))).toBe(DEFAULT_LOCALE)
	})

	it('writes a year-long, site-wide cookie', () => {
		expect(localeCookie('en')).toBe(`${LOCALE_COOKIE}=en; Path=/; Max-Age=31536000; SameSite=Lax`)
	})
})
