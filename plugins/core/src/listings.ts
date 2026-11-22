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
/** `ReplySource`: a note's newest visible reply in the overview feed, as stored. */
export type ReplySource = Readonly<{
	threadId: string
	postId: string
	number: number
	parentId: string | null
	author: UserDto
	body: string
	createdAt: string
	editedAt: string | null
}>
export type ThreadListing = Readonly<{
	threads: ThreadDto[]
	openings: OpeningSource[]
	total: number
}>
export type RecentListing = ThreadListing & Readonly<{ latestReplies: ReplySource[] }>
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

function isReply(value: unknown): value is ReplySource {
	return (
		isFields(value) &&
		hasStrings(value, ['threadId', 'postId', 'body', 'createdAt']) &&
		isCount(value.number) &&
		(value.parentId === null || typeof value.parentId === 'string') &&
		(value.editedAt === null || typeof value.editedAt === 'string') &&
		isUser(value.author)
	)
}

export function isRecentListing(value: unknown): value is RecentListing {
	if (!isThreadListing(value)) return false
	const replies: unknown = (value as Fields).latestReplies
	return Array.isArray(replies) && replies.every(isReply)
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
