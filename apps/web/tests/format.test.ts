import { describe, expect, it } from 'vitest'

import { formatDateTime, formatHumanTime } from '../app/lib/format'
import { createI18n } from '../app/lib/i18n'
import { loadMessages } from '../app/lib/i18n.server'

const zh = createI18n('zh-CN')
const en = createI18n('en', await loadMessages('en'))

const NOW = Date.parse('2026-11-16T12:00:00+08:00')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('formatHumanTime', () => {
	it('counts seconds, minutes, hours, days and weeks within a month', () => {
		expect(formatHumanTime(ago(0), NOW, zh)).toBe('刚刚')
		expect(formatHumanTime(ago(12 * SECOND), NOW, zh)).toBe('12秒前')
		expect(formatHumanTime(ago(59 * SECOND), NOW, zh)).toBe('59秒前')
		expect(formatHumanTime(ago(MINUTE), NOW, zh)).toBe('1分钟前')
		expect(formatHumanTime(ago(59 * MINUTE), NOW, zh)).toBe('59分钟前')
		expect(formatHumanTime(ago(3 * HOUR), NOW, zh)).toBe('3小时前')
		expect(formatHumanTime(ago(23 * HOUR), NOW, zh)).toBe('23小时前')
		expect(formatHumanTime(ago(DAY), NOW, zh)).toBe('1天前')
		expect(formatHumanTime(ago(6 * DAY), NOW, zh)).toBe('6天前')
		expect(formatHumanTime(ago(7 * DAY), NOW, zh)).toBe('1周前')
		expect(formatHumanTime(ago(29 * DAY), NOW, zh)).toBe('4周前')
	})

	it('shows the date without the year after a month and within a year', () => {
		expect(formatHumanTime(ago(30 * DAY), NOW, zh)).toBe('10月17日')
		expect(formatHumanTime(ago(200 * DAY), NOW, zh)).toBe('4月30日')
		expect(formatHumanTime(ago(364 * DAY), NOW, zh)).toBe('11月17日')
	})

	it('shows the full date, no time of day, after a year', () => {
		expect(formatHumanTime(ago(365 * DAY), NOW, zh)).toBe('2025年11月16日')
		expect(formatHumanTime('2020-03-02T23:30:00+08:00', NOW, zh)).toBe('2020年3月2日')
	})

	it('reads a future time with 后, and an invalid one as empty', () => {
		expect(formatHumanTime(new Date(NOW + 2 * HOUR).toISOString(), NOW, zh)).toBe('2小时后')
		expect(formatHumanTime('nope', NOW, zh)).toBe('')
	})
})

describe('formatHumanTime in English', () => {
	it('pluralises units and reads the future with "in"', () => {
		expect(formatHumanTime(ago(0), NOW, en)).toBe('just now')
		expect(formatHumanTime(ago(SECOND * 1.5), NOW, en)).toBe('1 second ago')
		expect(formatHumanTime(ago(12 * SECOND), NOW, en)).toBe('12 seconds ago')
		expect(formatHumanTime(ago(MINUTE), NOW, en)).toBe('1 minute ago')
		expect(formatHumanTime(ago(3 * HOUR), NOW, en)).toBe('3 hours ago')
		expect(formatHumanTime(ago(DAY), NOW, en)).toBe('1 day ago')
		expect(formatHumanTime(ago(7 * DAY), NOW, en)).toBe('1 week ago')
		expect(formatHumanTime(new Date(NOW + 2 * HOUR).toISOString(), NOW, en)).toBe('in 2 hours')
	})

	it('writes dates the English way, in the forum time zone', () => {
		expect(formatHumanTime(ago(30 * DAY), NOW, en)).toBe('Oct 17')
		expect(formatHumanTime(ago(365 * DAY), NOW, en)).toBe('Nov 16, 2025')
	})
})

describe('formatDateTime', () => {
	it('shows the minute in the forum time zone', () => {
		expect(formatDateTime('2026-11-13T18:20:00+08:00', 'zh-CN')).toBe('2026/11/13 18:20')
		expect(formatDateTime('2026-11-13T18:20:00+08:00', 'en')).toBe('Nov 13, 2026, 18:20')
		expect(formatDateTime('nope', 'en')).toBe('')
	})
})
