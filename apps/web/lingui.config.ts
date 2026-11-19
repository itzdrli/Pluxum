import { defineConfig } from '@lingui/conf'
import { formatter } from '@lingui/format-po'

// Source strings are written in Chinese: the message id IS the zh-CN text, so zh-CN needs no
// translation file content and an untranslated message in any locale falls back to Chinese.
export default defineConfig({
	sourceLocale: 'zh-CN',
	locales: ['zh-CN', 'en'],
	catalogs: [{ path: '<rootDir>/app/locales/{locale}', include: ['<rootDir>/app'] }],
	format: formatter({ lineNumbers: false }),
})
