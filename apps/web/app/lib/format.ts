import type { I18n } from '@lingui/core'
import { t, plural } from '@lingui/core/macro'

// The forum shows one fixed time zone so that server-rendered and hydrated markup always agree.
const FORUM_TIME_ZONE = 'Asia/Shanghai'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const MONTH = 30 * DAY
const YEAR = 365 * DAY

/** The Intl locale tag of an interface language (the ids are already BCP 47). */
function intlLocale(locale: string): string {
	return locale === 'en' ? 'en-US' : locale
}

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatter(locale: string, kind: 'full' | 'day' | 'dayYear'): Intl.DateTimeFormat {
	const key = `${locale}|${kind}`
	let found = formatters.get(key)
	if (found === undefined) {
		const base = { timeZone: FORUM_TIME_ZONE }
		found = new Intl.DateTimeFormat(
			intlLocale(locale),
			kind === 'full'
				? {
						...base,
						year: 'numeric',
						month: locale === 'en' ? 'short' : '2-digit',
						day: locale === 'en' ? 'numeric' : '2-digit',
						hour: '2-digit',
						minute: '2-digit',
						hourCycle: 'h23',
					}
				: {
						...base,
						year: kind === 'dayYear' ? 'numeric' : undefined,
						month: 'short',
						day: 'numeric',
					},
		)
		formatters.set(key, found)
	}
	return found
}

/** An ISO timestamp as `2026/11/13 18:20` (`Nov 13, 2026, 18:20`) in the forum's time zone: for tooltips. */
export function formatDateTime(iso: string, locale: string): string {
	const date = new Date(iso)
	return Number.isNaN(date.getTime()) ? '' : formatter(locale, 'full').format(date)
}

/**
 * A time the way a person says it. Within a month: how long ago, in the largest whole unit
 * (`12秒前`, `5分钟前`, `3小时前`, `2天前`, `3周前`; a future time reads `…后`). After a month but
 * within a year: the date without its year (`3月2日`). Beyond that: the full date without the time
 * of day (`2025年3月2日`).
 */
export function formatHumanTime(iso: string, now: number, i18n: I18n): string {
	const time = new Date(iso).getTime()
	if (Number.isNaN(time)) return ''
	const delta = now - time
	const span = Math.abs(delta)
	if (span < MONTH) {
		if (span < 1000) return t(i18n)`刚刚`
		const past = delta >= 0
		const seconds = Math.floor(span / 1000)
		const minutes = Math.floor(span / MINUTE)
		const hours = Math.floor(span / HOUR)
		const days = Math.floor(span / DAY)
		const weeks = Math.floor(span / WEEK)
		if (span < MINUTE) {
			return past
				? t(i18n)`${plural(seconds, { other: '#秒前' })}`
				: t(i18n)`${plural(seconds, { other: '#秒后' })}`
		}
		if (span < HOUR) {
			return past
				? t(i18n)`${plural(minutes, { other: '#分钟前' })}`
				: t(i18n)`${plural(minutes, { other: '#分钟后' })}`
		}
		if (span < DAY) {
			return past
				? t(i18n)`${plural(hours, { other: '#小时前' })}`
				: t(i18n)`${plural(hours, { other: '#小时后' })}`
		}
		if (span < WEEK) {
			return past
				? t(i18n)`${plural(days, { other: '#天前' })}`
				: t(i18n)`${plural(days, { other: '#天后' })}`
		}
		return past
			? t(i18n)`${plural(weeks, { other: '#周前' })}`
			: t(i18n)`${plural(weeks, { other: '#周后' })}`
	}
	return formatter(i18n.locale, span < YEAR ? 'day' : 'dayYear').format(time)
}

export function pageCount(total: number, pageSize: number): number {
	return Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
}
