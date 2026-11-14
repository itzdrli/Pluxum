export const LIMITS = Object.freeze({
	categoryNameMax: 40,
	categoryDescriptionMax: 200,
	slugMax: 48,
	threadTitleMax: 120,
	postBodyMax: 20_000,
	displayNameMax: 40,
	pageSizeDefault: 20,
	pageSizeMax: 50,
})

export type Validated<T> =
	| Readonly<{ ok: true; value: T }>
	| Readonly<{ ok: false; reason: string }>

const valid = <T>(value: T): Validated<T> => ({ ok: true, value })
const invalid = (reason: string): Validated<never> => ({ ok: false, reason })

/** Length as users count it for the limits: Unicode code points, not UTF-16 units. */
function codePoints(value: string): number {
	return Array.from(value).length
}

/** Single-line text: trimmed, inner whitespace collapsed, control characters rejected. */
function singleLine(input: string, label: string, max: number): Validated<string> {
	if (typeof input !== 'string') return invalid(`${label}必须是文本`)
	const value = input.trim().replaceAll(/\s+/g, ' ')
	if (!value) return invalid(`${label}不能为空`)
	if (/\p{Cc}/u.test(value)) return invalid(`${label}包含不允许的字符`)
	if (codePoints(value) > max) return invalid(`${label}不能超过 ${max} 个字符`)
	return valid(value)
}

export function validateThreadTitle(input: string): Validated<string> {
	return singleLine(input, '标题', LIMITS.threadTitleMax)
}

export function validateCategoryName(input: string): Validated<string> {
	return singleLine(input, '版块名称', LIMITS.categoryNameMax)
}

export function validateDisplayName(input: string): Validated<string> {
	return singleLine(input, '昵称', LIMITS.displayNameMax)
}

export function validateCategoryDescription(input: string): Validated<string> {
	if (typeof input !== 'string') return invalid('版块简介必须是文本')
	const value = input.trim().replaceAll(/\s+/g, ' ')
	if (codePoints(value) > LIMITS.categoryDescriptionMax) {
		return invalid(`版块简介不能超过 ${LIMITS.categoryDescriptionMax} 个字符`)
	}
	return valid(value)
}

/** Post source text: line endings normalized, outer blank lines dropped, NUL rejected. */
export function validatePostBody(input: string): Validated<string> {
	if (typeof input !== 'string') return invalid('内容必须是文本')
	const value = input
		.replaceAll(/\r\n?/g, '\n')
		.replace(/^(?:[ \t]*\n)+/, '')
		.trimEnd()
	if (!value.trim()) return invalid('内容不能为空')
	if (value.includes('\0')) return invalid('内容包含不允许的字符')
	if (codePoints(value) > LIMITS.postBodyMax) {
		return invalid(`内容不能超过 ${LIMITS.postBodyMax} 个字符`)
	}
	return valid(value)
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function validateSlug(input: string): Validated<string> {
	if (typeof input !== 'string' || !SLUG.test(input)) {
		return invalid('标识只能包含小写字母、数字和连字符')
	}
	if (input.length > LIMITS.slugMax) return invalid(`标识不能超过 ${LIMITS.slugMax} 个字符`)
	return valid(input)
}

/**
 * Best-effort ASCII slug from a name. Returns an empty string when nothing usable remains (for
 * example a name written entirely in Chinese); callers then ask for an explicit slug.
 */
export function slugify(input: string): string {
	return input
		.normalize('NFKD')
		.replaceAll(/\p{M}/gu, '')
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, '-')
		.replaceAll(/^-+|-+$/g, '')
		.slice(0, LIMITS.slugMax)
		.replace(/-+$/, '')
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Entity IDs are UUIDs; anything else cannot exist and is treated as not found. */
export function isEntityId(value: unknown): value is string {
	return typeof value === 'string' && UUID.test(value)
}

export type PageRequest = Readonly<{ page?: number; pageSize?: number }>

/** Clamps untrusted paging input to a 1-based page and a bounded page size. */
export function normalizePage(input: PageRequest = {}): { page: number; pageSize: number } {
	const page = Number.isSafeInteger(input.page) && input.page! >= 1 ? input.page! : 1
	const requested = Number.isSafeInteger(input.pageSize) ? input.pageSize! : LIMITS.pageSizeDefault
	return { page, pageSize: Math.min(Math.max(requested, 1), LIMITS.pageSizeMax) }
}
