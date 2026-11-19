export const LIMITS = Object.freeze({
	categoryNameMax: 40,
	categoryDescriptionMax: 200,
	slugMax: 48,
	threadSlugMax: 48,
	threadSlugMaxWords: 6,
	threadNumberStart: 1001,
	threadTitleMax: 120,
	postBodyMax: 20_000,
	/** Default length limit of a note's body; Forum Core's config may change it. */
	noteBodyMax: 500,
	displayNameMax: 40,
	handleMin: 2,
	handleMax: 24,
	searchQueryMax: 120,
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

export function validateSearchQuery(input: string): Validated<string> {
	return singleLine(input, '搜索词', LIMITS.searchQueryMax)
}

export function validateCategoryDescription(input: string): Validated<string> {
	if (typeof input !== 'string') return invalid('版块简介必须是文本')
	const value = input.trim().replaceAll(/\s+/g, ' ')
	if (codePoints(value) > LIMITS.categoryDescriptionMax) {
		return invalid(`版块简介不能超过 ${LIMITS.categoryDescriptionMax} 个字符`)
	}
	return valid(value)
}

/**
 * Post source text: line endings normalized, outer blank lines dropped, NUL rejected. `max`
 * (code points) defaults to the limit of an ordinary post; notes pass their own.
 */
export function validatePostBody(
	input: string,
	max: number = LIMITS.postBodyMax,
): Validated<string> {
	if (typeof input !== 'string') return invalid('内容必须是文本')
	const value = input
		.replaceAll(/\r\n?/g, '\n')
		.replace(/^(?:[ \t]*\n)+/, '')
		.trimEnd()
	if (!value.trim()) return invalid('内容不能为空')
	if (value.includes('\0')) return invalid('内容包含不允许的字符')
	const limit = Math.min(max, LIMITS.postBodyMax)
	if (codePoints(value) > limit) return invalid(`内容不能超过 ${limit} 个字符`)
	return valid(value)
}

/** Body length as the limits count it (Unicode code points). */
export function bodyLength(input: string): number {
	return codePoints(input)
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

/**
 * Extracts a concise ASCII slug from a thread title (at most `threadSlugMaxWords` words and
 * `threadSlugMax` characters, cut on word boundaries). Returns `""` when the title has no ASCII
 * letters or digits, so pure-CJK titles produce clean `/t/1001` URLs without percent-encoding.
 */
export function slugifyAsciiTitle(input: string): string {
	if (typeof input !== 'string') return ''
	const words =
		input
			.normalize('NFKD')
			.replaceAll(/\p{M}/gu, '')
			.normalize('NFKC')
			.toLowerCase()
			.match(/[a-z0-9]+/g) ?? []
	if (words.length === 0) return ''
	const picked: string[] = []
	let length = 0
	for (const word of words.slice(0, LIMITS.threadSlugMaxWords)) {
		if (picked.length === 0) {
			picked.push(word.slice(0, LIMITS.threadSlugMax))
			length = picked[0].length
			continue
		}
		if (length + 1 + word.length > LIMITS.threadSlugMax) break
		picked.push(word)
		length += 1 + word.length
	}
	return picked.join('-')
}

/** Canonical URL segment for a thread: `1001` or `1001-ascii-slug`. */
export function formatThreadRef(number: number, slug: string): string {
	return slug === '' ? String(number) : `${number}-${slug}`
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const THREAD_REF = /^([1-9]\d{0,8})(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$/
const FLOOR_NUMBER = /^[1-9]\d{0,6}$/
const HANDLE = /^[a-z](?:[a-z0-9]|[-_](?=[a-z0-9]))+$/

/** Entity IDs are UUIDs; anything else cannot exist and is treated as not found. */
export function isEntityId(value: unknown): value is string {
	return typeof value === 'string' && UUID.test(value)
}

export type ParsedThreadRef =
	| Readonly<{ kind: 'id'; id: string }>
	| Readonly<{ kind: 'number'; number: number; slug: string }>

/**
 * Parses a thread URL segment (`1001`, `1001-pluxel-hmr`, or a legacy 36-char UUID).
 * UUIDs are checked first so a UUID whose first 8 hex digits are all decimal is never misread as
 * a thread number.
 */
export function parseThreadRef(raw: unknown): ParsedThreadRef | null {
	if (isEntityId(raw)) return { kind: 'id', id: raw }
	if (typeof raw !== 'string') return null
	const match = THREAD_REF.exec(raw)
	if (!match) return null
	const number = Number(match[1])
	if (!Number.isSafeInteger(number) || number < 1) return null
	return { kind: 'number', number, slug: match[2] ?? '' }
}

/** Parses a 1-based post floor number from a URL segment. */
export function parseFloorNumber(raw: unknown): number | null {
	if (typeof raw !== 'string' || !FLOOR_NUMBER.test(raw)) return null
	const floor = Number(raw)
	return Number.isSafeInteger(floor) && floor >= 1 ? floor : null
}

/** 1-based thread page that holds the given 1-based post floor number. */
export function floorPageOf(floor: number, pageSize: number = LIMITS.pageSizeDefault): number {
	const safeFloor = Number.isSafeInteger(floor) && floor >= 1 ? floor : 1
	const safeSize =
		Number.isSafeInteger(pageSize) && pageSize >= 1 ? pageSize : LIMITS.pageSizeDefault
	return Math.ceil(safeFloor / safeSize)
}

export function validateHandle(input: string): Validated<string> {
	if (typeof input !== 'string') return invalid('用户名必须是文本')
	const value = input.trim().toLowerCase()
	if (value.length < LIMITS.handleMin) {
		return invalid(`用户名至少需要 ${LIMITS.handleMin} 个字符`)
	}
	if (value.length > LIMITS.handleMax) {
		return invalid(`用户名不能超过 ${LIMITS.handleMax} 个字符`)
	}
	if (!HANDLE.test(value)) {
		return invalid(
			'用户名需以小写字母开头，只能包含小写字母、数字、连字符和下划线，且不能以符号结尾',
		)
	}
	return valid(value)
}

/**
 * Derives a candidate ASCII handle stem from an OIDC username or display name. Returns `""` when
 * no usable ASCII stem can be formed; callers then fall back to `u<number>`.
 */
export function deriveHandleBase(input: string): string {
	if (typeof input !== 'string') return ''
	let cleaned = input
		.normalize('NFKD')
		.replaceAll(/\p{M}/gu, '')
		.normalize('NFKC')
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, '-')
		.replaceAll(/^-+|-+$/g, '')
	if (!cleaned) return ''
	if (!/^[a-z]/.test(cleaned)) cleaned = `u-${cleaned}`
	cleaned = cleaned.slice(0, 16).replaceAll(/-+$/g, '')
	return HANDLE.test(cleaned) ? cleaned : ''
}

export type ParsedUserRef =
	| Readonly<{ kind: 'id'; id: string }>
	| Readonly<{ kind: 'handle'; handle: string }>

/** Parses a user URL segment: a legacy 36-char UUID or a normalized user handle. */
export function parseUserRef(raw: unknown): ParsedUserRef | null {
	if (isEntityId(raw)) return { kind: 'id', id: raw }
	if (typeof raw !== 'string') return null
	const checked = validateHandle(raw)
	return checked.ok ? { kind: 'handle', handle: checked.value } : null
}

export type PageRequest = Readonly<{ page?: number; pageSize?: number }>

/** Clamps untrusted paging input to a 1-based page and a bounded page size. */
export function normalizePage(input: PageRequest = {}): { page: number; pageSize: number } {
	const page = Number.isSafeInteger(input.page) && input.page! >= 1 ? input.page! : 1
	const requested = Number.isSafeInteger(input.pageSize) ? input.pageSize! : LIMITS.pageSizeDefault
	return { page, pageSize: Math.min(Math.max(requested, 1), LIMITS.pageSizeMax) }
}
