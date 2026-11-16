// The forum shows one fixed time zone so that server-rendered and hydrated markup always agree.
const FORUM_TIME_ZONE = 'Asia/Shanghai'
/** China has no daylight saving time, so the zone is a constant offset from UTC. */
const FORUM_UTC_OFFSET_MS = 8 * 3_600_000

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const MONTH = 30 * DAY
const YEAR = 365 * DAY

const fullDateTime = new Intl.DateTimeFormat('zh-CN', {
	timeZone: FORUM_TIME_ZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23',
})

/** An ISO timestamp as `2026/11/13 18:20` in the forum's time zone: for tooltips. */
export function formatDateTime(iso: string): string {
	const date = new Date(iso)
	return Number.isNaN(date.getTime()) ? '' : fullDateTime.format(date)
}

/**
 * A time the way a person says it. Within a month: how long ago, in the largest whole unit
 * (`12秒前`, `5分钟前`, `3小时前`, `2天前`, `3周前`; a future time reads `…后`). After a month but
 * within a year: the date without its year (`3月2日`). Beyond that: the full date without the time
 * of day (`2025年3月2日`).
 */
export function formatHumanTime(iso: string, now: number): string {
	const time = new Date(iso).getTime()
	if (Number.isNaN(time)) return ''
	const delta = now - time
	const span = Math.abs(delta)
	if (span < MONTH) {
		const suffix = delta >= 0 ? '前' : '后'
		if (span < 1000) return '刚刚'
		if (span < MINUTE) return `${Math.floor(span / 1000)}秒${suffix}`
		if (span < HOUR) return `${Math.floor(span / MINUTE)}分钟${suffix}`
		if (span < DAY) return `${Math.floor(span / HOUR)}小时${suffix}`
		if (span < WEEK) return `${Math.floor(span / DAY)}天${suffix}`
		return `${Math.floor(span / WEEK)}周${suffix}`
	}
	const local = new Date(time + FORUM_UTC_OFFSET_MS)
	const day = `${local.getUTCMonth() + 1}月${local.getUTCDate()}日`
	return span < YEAR ? day : `${local.getUTCFullYear()}年${day}`
}

export function pageCount(total: number, pageSize: number): number {
	return Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
}
