// The forum shows one fixed time zone so that server-rendered and hydrated markup always agree.
const FORUM_TIME_ZONE = 'Asia/Shanghai'

const dateTime = new Intl.DateTimeFormat('zh-CN', {
	timeZone: FORUM_TIME_ZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23',
})

/** An ISO timestamp as `2026/11/13 18:20` in the forum's time zone. */
export function formatDateTime(iso: string): string {
	const date = new Date(iso)
	return Number.isNaN(date.getTime()) ? '' : dateTime.format(date)
}

export function pageCount(total: number, pageSize: number): number {
	return Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
}
