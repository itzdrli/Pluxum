// The forum's colour themes. Colours themselves live in app.css under `[data-theme='<id>']`;
// this module only knows their names and whether they are dark.

export const THEMES = [
	{ id: 'nord', label: 'Nord', dark: true },
	{ id: 'dusk', label: 'Dusk', dark: true },
	{ id: 'frost', label: 'Frost', dark: false },
	{ id: 'sand', label: 'Sand', dark: false },
] as const

export type ThemeId = (typeof THEMES)[number]['id']

export const DEFAULT_THEME: ThemeId = 'nord'

/** Cookie that remembers the visitor's theme, so server-rendered pages come out right first time. */
export const THEME_COOKIE = 'forum_theme'

export function isThemeId(value: unknown): value is ThemeId {
	return THEMES.some((theme) => theme.id === value)
}

export function isDarkTheme(id: ThemeId): boolean {
	return THEMES.find((theme) => theme.id === id)?.dark ?? true
}

/** The theme named by the request's cookie, or the default. */
export function themeFromRequest(request: Request): ThemeId {
	for (const part of (request.headers.get('cookie') ?? '').split(';')) {
		const separator = part.indexOf('=')
		if (separator > 0 && part.slice(0, separator).trim() === THEME_COOKIE) {
			const value = part.slice(separator + 1).trim()
			return isThemeId(value) ? value : DEFAULT_THEME
		}
	}
	return DEFAULT_THEME
}

export function themeCookie(id: ThemeId): string {
	return `${THEME_COOKIE}=${id}; Path=/; Max-Age=31536000; SameSite=Lax`
}
