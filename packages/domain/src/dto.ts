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

/**
 * Data that extension plugins attach to an entity, keyed by extension ID (`forum-reactions`). An
 * extension that is not running, failed or had nothing to say is simply absent: readers must
 * treat every key as optional and its value as untrusted in shape.
 */
export type ExtensionData = Readonly<Record<string, unknown>>

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
	ext: ExtensionData
}>

/**
 * How a post body was rendered: `markdown` by the content renderer plugin, `plain` when none is
 * running and the source is shown as written.
 */
export type BodyFormat = 'markdown' | 'plain'

export type PostDto = Readonly<{
	id: string
	threadId: string
	author: UserDto
	/** Source text as written, for editing; empty when the post was deleted. */
	body: string
	/**
	 * The body as HTML that is safe to insert into a page. For `plain` it is the escaped source
	 * without any markup, so line breaks need `white-space: pre-wrap`.
	 */
	bodyHtml: string
	bodyFormat: BodyFormat
	createdAt: string
	editedAt: string | null
	deleted: boolean
	/** What the current viewer may do with this post. */
	can: Readonly<{ edit: boolean; delete: boolean }>
	ext: ExtensionData
}>

/** A post body rendered without saving it, for previews and for comparing two sources. */
export type PreviewDto = Readonly<{
	bodyHtml: string
	bodyFormat: BodyFormat
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

/** The places in the frontend where extension plugins may show a component of their own. */
export const UI_SLOTS = [
	'post.footer',
	'post.actions',
	'thread.sidebar',
	'user.profile.tabs',
	'composer.toolbar',
] as const
export type UiSlot = (typeof UI_SLOTS)[number]

export function isUiSlot(value: unknown): value is UiSlot {
	return UI_SLOTS.some((slot) => slot === value)
}

/** One running extension that fills a slot; the frontend ships the component for it. */
export type UiSlotDto = Readonly<{
	slot: UiSlot
	extId: string
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
	content: Readonly<{
		/** How new posts will be rendered right now; the composer offers formatting only for `markdown`. */
		format: BodyFormat
	}>
	/** Slots filled by the extensions that are running, in display order. */
	uiSlots: UiSlotDto[]
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
