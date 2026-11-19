import { setupI18n, type I18n, type Messages } from '@lingui/core'

import { messages as sourceMessages } from '../locales/zh-CN.po'
import { DEFAULT_LOCALE, type LocaleId } from './locale'

/**
 * One instance per render: the server handles requests concurrently, so the global `i18n`
 * singleton of @lingui/core must never be used here.
 *
 * Production builds strip the source text from every `t`/`<Trans>`, so an instance without a
 * catalog would show raw message ids. The Chinese source catalog is therefore bundled and is the
 * fallback for any render that has no loader data (a failed root loader).
 */
export function createI18n(
	locale: LocaleId = DEFAULT_LOCALE,
	messages: Messages = sourceMessages,
): I18n {
	return setupI18n({ locale, messages: { [locale]: messages } })
}
