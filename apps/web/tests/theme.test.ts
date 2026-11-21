import { describe, expect, it } from 'vitest'

import { themeFromRequest } from '../app/lib/theme'

// Only the headers matter, and a real Request would silently drop the forbidden `cookie` one.
const request = (cookie?: string) => ({ headers: new Headers(cookie ? { cookie } : {}) })

describe('theme', () => {
	it("uses the visitor's cookie over the site default", () => {
		expect(themeFromRequest(request('forum_theme=sand'), 'frost')).toBe('sand')
	})

	it("falls back to the site's default theme without a valid cookie", () => {
		expect(themeFromRequest(request(), 'frost')).toBe('frost')
		expect(themeFromRequest(request('forum_theme=graphite'), 'dusk')).toBe('dusk')
		expect(themeFromRequest(request())).toBe('nord')
	})
})
