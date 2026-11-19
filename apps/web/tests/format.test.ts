import { describe, expect, it } from 'vitest'

import { formatDateTime, formatHumanTime } from '../app/lib/format'
import { createI18n } from '../app/lib/i18n'
import { loadMessages } from '../app/lib/i18n.server'

const SHANGHAI = 'Asia/Shanghai'
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
		expect(formatHumanTime(ago(0), NOW, zh, SHANGHAI)).toBe('刚刚')
		expect(formatHumanTime(ago(12 * SECOND), NOW, zh, SHANGHAI)).toBe('12秒前')
		expect(formatHumanTime(ago(59 * SECOND), NOW, zh, SHANGHAI)).toBe('59秒前')
		expect(formatHumanTime(ago(MINUTE), NOW, zh, SHANGHAI)).toBe('1分钟前')
		expect(formatHumanTime(ago(59 * MINUTE), NOW, zh, SHANGHAI)).toBe('59分钟前')
		expect(formatHumanTime(ago(3 * HOUR), NOW, zh, SHANGHAI)).toBe('3小时前')
		expect(formatHumanTime(ago(23 * HOUR), NOW, zh, SHANGHAI)).toBe('23小时前')
		expect(formatHumanTime(ago(DAY), NOW, zh, SHANGHAI)).toBe('1天前')
		expect(formatHumanTime(ago(6 * DAY), NOW, zh, SHANGHAI)).toBe('6天前')
		expect(formatHumanTime(ago(7 * DAY), NOW, zh, SHANGHAI)).toBe('1周前')
		expect(formatHumanTime(ago(29 * DAY), NOW, zh, SHANGHAI)).toBe('4周前')
	})

	it('shows the date without the year after a month and within a year', () => {
		expect(formatHumanTime(ago(30 * DAY), NOW, zh, SHANGHAI)).toBe('10月17日')
		expect(formatHumanTime(ago(200 * DAY), NOW, zh, SHANGHAI)).toBe('4月30日')
		expect(formatHumanTime(ago(364 * DAY), NOW, zh, SHANGHAI)).toBe('11月17日')
	})

	it('shows the full date, no time of day, after a year', () => {
		expect(formatHumanTime(ago(365 * DAY), NOW, zh, SHANGHAI)).toBe('2025年11月16日')
		expect(formatHumanTime('2020-03-02T23:30:00+08:00', NOW, zh, SHANGHAI)).toBe('2020年3月2日')
	})

	it('reads a future time with 后, and an invalid one as empty', () => {
		expect(formatHumanTime(new Date(NOW + 2 * HOUR).toISOString(), NOW, zh, SHANGHAI)).toBe(
			'2小时后',
		)
		expect(formatHumanTime('nope', NOW, zh, SHANGHAI)).toBe('')
	})
})

describe('formatHumanTime in English', () => {
	it('pluralises units and reads the future with "in"', () => {
		expect(formatHumanTime(ago(0), NOW, en, SHANGHAI)).toBe('just now')
		expect(formatHumanTime(ago(SECOND * 1.5), NOW, en, SHANGHAI)).toBe('1 second ago')
		expect(formatHumanTime(ago(12 * SECOND), NOW, en, SHANGHAI)).toBe('12 seconds ago')
		expect(formatHumanTime(ago(MINUTE), NOW, en, SHANGHAI)).toBe('1 minute ago')
		expect(formatHumanTime(ago(3 * HOUR), NOW, en, SHANGHAI)).toBe('3 hours ago')
		expect(formatHumanTime(ago(DAY), NOW, en, SHANGHAI)).toBe('1 day ago')
		expect(formatHumanTime(ago(7 * DAY), NOW, en, SHANGHAI)).toBe('1 week ago')
		expect(formatHumanTime(new Date(NOW + 2 * HOUR).toISOString(), NOW, en, SHANGHAI)).toBe(
			'in 2 hours',
		)
	})

	it('writes dates the English way, in the forum time zone', () => {
		expect(formatHumanTime(ago(30 * DAY), NOW, en, SHANGHAI)).toBe('Oct 17')
		expect(formatHumanTime(ago(365 * DAY), NOW, en, SHANGHAI)).toBe('Nov 16, 2025')
	})
})

describe('formatDateTime', () => {
	it('shows the minute and zone of the visitor', () => {
		expect(formatDateTime('2026-11-13T18:20:00+08:00', 'zh-CN', SHANGHAI)).toBe(
			'2026/11/13 18:20 GMT+8',
		)
		expect(formatDateTime('2026-11-13T18:20:00+08:00', 'en', SHANGHAI)).toBe(
			'Nov 13, 2026, 18:20 GMT+8',
		)
		expect(formatDateTime('nope', 'en', SHANGHAI)).toBe('')
	})
})

describe('time zones', () => {
	it('draws the same moment in the zone it is asked for', () => {
		const moment = '2026-11-13T18:20:00+08:00'
		expect(formatDateTime(moment, 'en', 'America/New_York')).toBe('Nov 13, 2026, 05:20 EST')
		expect(formatDateTime(moment, 'zh-CN', 'UTC')).toBe('2026/11/13 10:20 UTC')
	})

	it('moves a date across midnight with the zone', () => {
		const late = '2025-03-02T23:30:00+08:00'
		expect(formatHumanTime(late, NOW, zh, SHANGHAI)).toBe('2025年3月2日')
		expect(formatHumanTime(late, NOW, zh, 'America/Los_Angeles')).toBe('2025年3月2日')
		expect(formatHumanTime(late, NOW, zh, 'Pacific/Auckland')).toBe('2025年3月3日')
	})
})
