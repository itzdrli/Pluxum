// The interface languages. Pure helpers (no Lingui import) so the server loader, the browser and
// the tests all read a request's language the same way. Catalogs live in app/locales/<id>.po.

export const LOCALES = [
	// `label` is each language's own name and is never translated.
	{ id: 'zh-CN', label: '简体中文' },
	{ id: 'en', label: 'English' },
] as const

export type LocaleId = (typeof LOCALES)[number]['id']

export const DEFAULT_LOCALE: LocaleId = 'zh-CN'

/** Cookie that remembers the visitor's language, so server-rendered pages come out right first time. */
export const LOCALE_COOKIE = 'forum_locale'

export function isLocaleId(value: unknown): value is LocaleId {
	return LOCALES.some((locale) => locale.id === value)
}

/** The first supported language in an Accept-Language header (`en-US,en;q=0.9` → `en`). */
function fromAcceptLanguage(header: string): LocaleId | null {
	for (const part of header.split(',')) {
		const tag = part.split(';')[0]?.trim().toLowerCase() ?? ''
		if (tag === 'zh' || tag.startsWith('zh-')) return 'zh-CN'
		if (tag === 'en' || tag.startsWith('en-')) return 'en'
	}
	return null
}

/** The language the request asks for: its cookie, else its Accept-Language, else the default. */
export function localeFromRequest(request: Pick<Request, 'headers'>): LocaleId {
	for (const part of (request.headers.get('cookie') ?? '').split(';')) {
		const separator = part.indexOf('=')
		if (separator > 0 && part.slice(0, separator).trim() === LOCALE_COOKIE) {
			const value = part.slice(separator + 1).trim()
			if (isLocaleId(value)) return value
		}
	}
	return fromAcceptLanguage(request.headers.get('accept-language') ?? '') ?? DEFAULT_LOCALE
}

export function localeCookie(id: LocaleId): string {
	return `${LOCALE_COOKIE}=${id}; Path=/; Max-Age=31536000; SameSite=Lax`
}
