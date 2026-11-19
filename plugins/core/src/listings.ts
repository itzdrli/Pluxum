import type { CategoryDto, ThreadDto, UserDto } from '@pluxum/domain'

/**
 * Read models the core keeps in the cache (see `cache.ts`), before extension data is attached.
 * A shared cache may hand back what another version wrote, so every value is checked on the way
 * out; one that does not match is read fresh.
 *
 * `OpeningSource`: the opening post of a note in a listing, as stored; the core renders it on the
 * way out.
 */
export type OpeningSource = Readonly<{
	threadId: string
	postId: string
	body: string
	createdAt: string
	editedAt: string | null
}>
export type ThreadListing = Readonly<{
	threads: ThreadDto[]
	openings: OpeningSource[]
	total: number
}>
export type CategoryListing = ThreadListing & Readonly<{ category: CategoryDto }>
export type CommunityListing = Readonly<{
	members: number
	newest: UserDto[]
	active: Array<UserDto & { posts: number }>
}>

type Fields = Record<string, unknown>

function isFields(value: unknown): value is Fields {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCount(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function hasStrings(value: Fields, keys: readonly string[]): boolean {
	return keys.every((key) => typeof value[key] === 'string')
}

function isUser(value: unknown): value is UserDto {
	return isFields(value) && hasStrings(value, ['id', 'handle', 'displayName'])
}

function isThread(value: unknown): value is ThreadDto {
	return (
		isFields(value) &&
		hasStrings(value, ['id', 'slug', 'ref', 'categoryId', 'title', 'createdAt', 'lastPostAt']) &&
		(value.kind === 'topic' || value.kind === 'note') &&
		isCount(value.number) &&
		isCount(value.replyCount) &&
		typeof value.pinned === 'boolean' &&
		typeof value.locked === 'boolean' &&
		isUser(value.author) &&
		isFields(value.ext)
	)
}

function isCategory(value: unknown): value is CategoryDto {
	return (
		isFields(value) &&
		hasStrings(value, ['id', 'slug', 'name', 'description']) &&
		(value.kind === 'board' || value.kind === 'stream') &&
		Number.isSafeInteger(value.position) &&
		isCount(value.threadCount) &&
		isCount(value.postCount)
	)
}

function isOpening(value: unknown): value is OpeningSource {
	return (
		isFields(value) &&
		hasStrings(value, ['threadId', 'postId', 'body', 'createdAt']) &&
		(value.editedAt === null || typeof value.editedAt === 'string')
	)
}

export function isThreadListing(value: unknown): value is ThreadListing {
	return (
		isFields(value) &&
		isCount(value.total) &&
		Array.isArray(value.threads) &&
		value.threads.every(isThread) &&
		Array.isArray(value.openings) &&
		value.openings.every(isOpening)
	)
}

export function isCategoryListing(value: unknown): value is CategoryListing {
	return isThreadListing(value) && isCategory((value as Fields).category)
}

export function isCommunityListing(value: unknown): value is CommunityListing {
	return (
		isFields(value) &&
		isCount(value.members) &&
		Array.isArray(value.newest) &&
		value.newest.every(isUser) &&
		Array.isArray(value.active) &&
		value.active.every((entry) => isUser(entry) && isCount((entry as Fields).posts))
	)
}
