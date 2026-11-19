import { msg } from '@lingui/core/macro'
import { describe, expect, it } from 'vitest'

import { createI18n } from '../app/lib/i18n'

const label = msg`亮色`

describe('i18n', () => {
	it('returns the Chinese source text without a catalog', () => {
		expect(createI18n('zh-CN')._(label)).toBe('亮色')
		expect(createI18n('en')._(label)).toBe('亮色')
	})

	it('translates through a per-instance catalog, and instances stay independent', async () => {
		const { loadMessages } = await import('../app/lib/i18n.server')
		const en = createI18n('en', await loadMessages('en'))
		const zh = createI18n('zh-CN', await loadMessages('zh-CN'))
		expect(en._(label)).toBe('Light')
		expect(zh._(label)).toBe('亮色')
	})
})
