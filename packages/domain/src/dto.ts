import type { Role } from './permissions'

// Wire shapes shared by forum-api and the frontend. Timestamps are ISO 8601 strings.

export type UserDto = Readonly<{
	id: string
	displayName: string
}>

export type CategoryDto = Readonly<{
	id: string
	slug: string
	name: string
	description: string
	position: number
	threadCount: number
	postCount: number
}>

export type ThreadDto = Readonly<{
	id: string
	categoryId: string
	title: string
	author: UserDto
	createdAt: string
	lastPostAt: string
	replyCount: number
	pinned: boolean
	locked: boolean
}>

export type PostDto = Readonly<{
	id: string
	threadId: string
	author: UserDto
	/** Source text as written; empty when the post was deleted. */
	body: string
	createdAt: string
	editedAt: string | null
	deleted: boolean
	/** What the current viewer may do with this post. */
	can: Readonly<{ edit: boolean; delete: boolean }>
}>

export type PageDto<T> = Readonly<{
	items: T[]
	page: number
	pageSize: number
	total: number
}>

export type CategoryThreadsDto = Readonly<{
	category: CategoryDto
	threads: PageDto<ThreadDto>
	can: Readonly<{ createThread: boolean }>
}>

export type ThreadDetailDto = Readonly<{
	thread: ThreadDto
	category: CategoryDto
	posts: PageDto<PostDto>
	can: Readonly<{ reply: boolean; edit: boolean; delete: boolean; moderate: boolean }>
}>

export type ViewerDto = Readonly<{
	user: UserDto | null
	roles: Role[]
	can: Readonly<{ manageCategories: boolean }>
}>

export type MetaDto = Readonly<{
	viewer: ViewerDto
	auth: Readonly<{
		/** Whether the forum can start a login right now (an identity provider is configured). */
		loginAvailable: boolean
	}>
	limits: Readonly<{
		categoryNameMax: number
		threadTitleMax: number
		postBodyMax: number
	}>
}>

export const FORUM_ERROR_CODES = [
	'invalid',
	'unauthenticated',
	'forbidden',
	'not_found',
	'conflict',
] as const
export type ForumErrorCode = (typeof FORUM_ERROR_CODES)[number]

/** An expected, recoverable failure of a forum operation. `message` is safe to show to users. */
export type ForumError = Readonly<{
	code: ForumErrorCode
	message: string
}>

/**
 * Error as the HTTP API reports it. `unavailable`: a dependency (session store, identity provider)
 * is down and retrying later may work; `internal` covers other failures outside the forum's rules.
 */
export type ApiError = Readonly<{
	code: ForumErrorCode | 'unavailable' | 'internal'
	message: string
}>

export type ApiErrorDto = Readonly<{ error: ApiError }>
