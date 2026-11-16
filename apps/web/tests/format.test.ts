import { describe, expect, it } from 'vitest'

import { formatHumanTime } from '../app/lib/format'

const NOW = Date.parse('2026-11-16T12:00:00+08:00')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('formatHumanTime', () => {
	it('counts seconds, minutes, hours, days and weeks within a month', () => {
		expect(formatHumanTime(ago(0), NOW)).toBe('刚刚')
		expect(formatHumanTime(ago(12 * SECOND), NOW)).toBe('12秒前')
		expect(formatHumanTime(ago(59 * SECOND), NOW)).toBe('59秒前')
		expect(formatHumanTime(ago(MINUTE), NOW)).toBe('1分钟前')
		expect(formatHumanTime(ago(59 * MINUTE), NOW)).toBe('59分钟前')
		expect(formatHumanTime(ago(3 * HOUR), NOW)).toBe('3小时前')
		expect(formatHumanTime(ago(23 * HOUR), NOW)).toBe('23小时前')
		expect(formatHumanTime(ago(DAY), NOW)).toBe('1天前')
		expect(formatHumanTime(ago(6 * DAY), NOW)).toBe('6天前')
		expect(formatHumanTime(ago(7 * DAY), NOW)).toBe('1周前')
		expect(formatHumanTime(ago(29 * DAY), NOW)).toBe('4周前')
	})

	it('shows the date without the year after a month and within a year', () => {
		expect(formatHumanTime(ago(30 * DAY), NOW)).toBe('10月17日')
		expect(formatHumanTime(ago(200 * DAY), NOW)).toBe('4月30日')
		expect(formatHumanTime(ago(364 * DAY), NOW)).toBe('11月17日')
	})

	it('shows the full date, no time of day, after a year', () => {
		expect(formatHumanTime(ago(365 * DAY), NOW)).toBe('2025年11月16日')
		expect(formatHumanTime('2020-03-02T23:30:00+08:00', NOW)).toBe('2020年3月2日')
	})

	it('reads a future time with 后, and an invalid one as empty', () => {
		expect(formatHumanTime(new Date(NOW + 2 * HOUR).toISOString(), NOW)).toBe('2小时后')
		expect(formatHumanTime('nope', NOW)).toBe('')
	})
})
