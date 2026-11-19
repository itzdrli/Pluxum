import type { I18n, Messages } from '@lingui/core'

import { messages as sourceMessages } from '../locales/zh-CN.po'
import { createI18n } from './i18n'
import { localeFromRequest, type LocaleId } from './locale'

// One entry per language (a missing one is a type error). The source language is bundled anyway
// (see createI18n), so only the others are loaded on demand.
const CATALOGS: Record<LocaleId, () => Promise<{ messages: Messages }>> = {
	'zh-CN': () => Promise.resolve({ messages: sourceMessages }),
	en: () => import('../locales/en.po'),
}

/** The compiled catalog of one language (the Lingui Vite plugin compiles the .po on import). */
export async function loadMessages(locale: LocaleId): Promise<Messages> {
	return (await CATALOGS[locale]()).messages
}

/** The request's i18n, for the words a loader or action itself produces (error messages). */
export async function i18nFromRequest(request: Request): Promise<I18n> {
	const locale = localeFromRequest(request)
	return createI18n(locale, await loadMessages(locale))
}
