// The forum's colour themes. Colours themselves live in app.css under `[data-theme='<id>']`;
// this module only knows their names and whether they are dark.

import type { ThemeId as DomainThemeId } from '@pluxum/domain'

export const THEMES = [
	// `page`: the page colour (app.css `--c-page`), which browsers paint their own bars in.
	{ id: 'nord', label: 'Nord', dark: true, page: '#2e3440' },
	{ id: 'dusk', label: 'Dusk', dark: true, page: '#0d0f13' },
	{ id: 'frost', label: 'Frost', dark: false, page: '#e7ecf2' },
	{ id: 'sand', label: 'Sand', dark: false, page: '#efe7d9' },
] as const

export type ThemeId = (typeof THEMES)[number]['id']
// The themes here and the ones Pluxum Core's "default theme" setting offers must be the same.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never
const themesMatchDomain: Same<ThemeId, DomainThemeId> = true
void themesMatchDomain

export const DEFAULT_THEME: ThemeId = 'nord'

/** Cookie that remembers the visitor's theme, so server-rendered pages come out right first time. */
export const THEME_COOKIE = 'forum_theme'

function isThemeId(value: unknown): value is ThemeId {
	return THEMES.some((theme) => theme.id === value)
}

/** The page colour of a theme, for the browser's `theme-color`. */
export function themePageColor(id: ThemeId): string {
	return THEMES.find((theme) => theme.id === id)?.page ?? THEMES[0].page
}

export function isDarkTheme(id: ThemeId): boolean {
	return THEMES.find((theme) => theme.id === id)?.dark ?? true
}

/** The theme named by the request's cookie, or `fallback` (the site's default theme). */
export function themeFromRequest(
	request: Pick<Request, 'headers'>,
	fallback: ThemeId = DEFAULT_THEME,
): ThemeId {
	for (const part of (request.headers.get('cookie') ?? '').split(';')) {
		const separator = part.indexOf('=')
		if (separator > 0 && part.slice(0, separator).trim() === THEME_COOKIE) {
			const value = part.slice(separator + 1).trim()
			return isThemeId(value) ? value : fallback
		}
	}
	return fallback
}

export function themeCookie(id: ThemeId): string {
	return `${THEME_COOKIE}=${id}; Path=/; Max-Age=31536000; SameSite=Lax`
}
