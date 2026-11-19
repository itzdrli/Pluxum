import type { Messages } from '@lingui/core'

import { messages as sourceMessages } from '../locales/zh-CN.po'
import type { LocaleId } from './locale'

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
