import type { Role } from './permissions'

// Wire shapes shared by forum-api and the frontend. Timestamps are ISO 8601 strings.

export type UserDto = Readonly<{
	id: string
	handle: string
	displayName: string
	ext?: ExtensionData
}>

/** One entry of the command palette that a running plugin offers. */
export type PaletteCommandDto = Readonly<{
	/** `<contributor>.<command>`, unique. */
	id: string
	label: string
	group: string
	keywords: string[]
	/** A forum path or an http(s) URL. */
	href: string
	/** Whether `href` leaves the forum. */
	external: boolean
}>

/** Who is around: the overview's community panel. */
export type CommunityDto = Readonly<{
	members: number
	/** The newest members, newest first. */
	newMembers: UserDto[]
	/** Members with the most posts in the last `days` days (in categories the viewer may see). */
	activeMembers: Array<Readonly<{ user: UserDto; posts: number }>>
	days: number
}>

/**
 * `board`: an ordinary category of titled topics. `stream`: where notes go (short untitled
 * posts, like a microblog); navigation and category lists leave it out.
 */
export type CategoryKind = 'board' | 'stream'

export type CategoryDto = Readonly<{
	id: string
	slug: string
	name: string
	description: string
	position: number
	kind: CategoryKind
	threadCount: number
	postCount: number
}>

/**
 * Data that extension plugins attach to an entity, keyed by extension ID (`forum-reactions`). An
 * extension that is not running, failed or had nothing to say is simply absent: readers must
 * treat every key as optional and its value as untrusted in shape.
 */
export type ExtensionData = Readonly<Record<string, unknown>>

/** `topic`: a titled thread in a board. `note`: an untitled one in the stream, shown as a card. */
export type ThreadKind = 'topic' | 'note'

export type ThreadDto = Readonly<{
	id: string
	number: number
	slug: string
	/** Canonical URL segment (`1001` or `1001-ascii-slug`). */
	ref: string
	categoryId: string
	kind: ThreadKind
	/** Empty for a note. */
	title: string
	author: UserDto
	createdAt: string
	lastPostAt: string
	replyCount: number
	pinned: boolean
	locked: boolean
	/**
	 * A note's opening post, in thread lists only, so a feed can show the note as a card. Absent
	 * for topics and on the thread page (whose posts include it).
	 */
	opening?: PostDto
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
	/** 1-based floor number inside the thread (`1` for the opening post). */
	number: number
	/**
	 * The top-level post this one replies to inside the thread ("楼中楼"), or null for a top-level
	 * post. Only one level deep: a reply to a reply hangs under the same top-level post.
	 */
	parentId: string | null
	/** For a reply inside a floor: the author it answers when that is not the floor's author. */
	replyTo: UserDto | null
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
	/**
	 * On the thread page, for a top-level post: the first replies inside it, oldest first, and how
	 * many there are in all (`listReplies` pages through the rest). Absent everywhere else.
	 */
	replies?: Readonly<{ items: PostDto[]; total: number }>
	ext: ExtensionData
}>

/** A post body rendered without saving it, for previews and for comparing two sources. */
export type PreviewDto = Readonly<{
	bodyHtml: string
	bodyFormat: BodyFormat
}>

/** A notification delivered through the forum's notification channels. */
export type ForumNotification = Readonly<{
	id: string
	recipientId: string
	kind: string
	title: string
	body?: string
	path?: string
	threadId?: string
	postId?: string
	actor?: UserDto | null
	createdAt: string
}>

/** A persisted in-app notification item returned by `forum-notifications`. */
export type NotificationDto = Readonly<{
	id: string
	recipientId: string
	kind: string
	title: string
	body: string | null
	path: string | null
	threadId: string | null
	postId: string | null
	actor: UserDto | null
	read: boolean
	readAt: string | null
	createdAt: string
}>

export type NotificationPageDto = PageDto<NotificationDto> &
	Readonly<{
		unreadCount: number
	}>

export type SearchRequest = Readonly<{
	query: string
	categoryId?: string
	authorId?: string
	threadsOnly?: boolean
	page?: number
	pageSize?: number
}>

export type SearchHitDto = Readonly<{
	postId: string
	postNumber: number
	threadId: string
	threadRef: string
	categoryId: string
	opening: boolean
	title: string
	/** Safe HTML excerpt where matched terms are wrapped in `<mark>`. */
	snippetHtml: string
	author: UserDto
	createdAt: string
}>

export type SearchPageDto = PageDto<SearchHitDto>

export type ModerationTargetType = 'post' | 'thread'

export type ModerationReportStatus = 'open' | 'resolved' | 'dismissed'

export type ModerationQueueStatus = ModerationReportStatus | 'all'

export type ModerationReportDto = Readonly<{
	id: string
	targetType: ModerationTargetType
	targetId: string
	threadId: string
	postId: string | null
	reason: string
	status: ModerationReportStatus
	reporter: UserDto
	targetAuthor: UserDto | null
	resolutionNote: string | null
	resolvedBy: UserDto | null
	resolvedAt: string | null
	createdAt: string
}>

export type ModerationQueuePageDto = PageDto<ModerationReportDto> &
	Readonly<{
		openCount: number
	}>

export type ModerationLogDto = Readonly<{
	id: string
	actor: UserDto
	action: string
	targetType: string
	targetId: string
	targetUser: UserDto | null
	detail: string | null
	createdAt: string
}>

export type ModerationLogPageDto = PageDto<ModerationLogDto>

export type UserBanStatusDto = Readonly<{
	banned: boolean
	reason?: string
	expiresAt?: string | null
}>

export type PageDto<T> = Readonly<{
	items: T[]
	page: number
	pageSize: number
	total: number
}>

export type CategorySummaryDto = Readonly<{
	id: string
	slug: string
	name: string
}>

export type RecentThreadDto = ThreadDto &
	Readonly<{
		category: CategorySummaryDto
	}>

export type RecentThreadsDto = PageDto<RecentThreadDto>

export type CategoryThreadsDto = Readonly<{
	category: CategoryDto
	threads: PageDto<ThreadDto>
	can: Readonly<{ createThread: boolean }>
}>

export type ThreadDetailDto = Readonly<{
	thread: ThreadDto
	category: CategoryDto
	/** One page of top-level posts; replies inside a floor ride along on each post's `replies`. */
	posts: PageDto<PostDto>
	can: Readonly<{
		reply: boolean
		edit: boolean
		delete: boolean
		moderate: boolean
		/** Move the thread to another category (a note: turn it into a topic). */
		move: boolean
	}>
}>

/** Where a floor sits on its thread's pages: what a link to `/t/<ref>/<floor>` resolves to. */
export type FloorLocationDto = Readonly<{
	threadRef: string
	floor: number
	/** The page of top-level posts that shows the floor (or the floor it replies inside). */
	page: number
	/** The top-level floor it replies inside, or null when it is top-level itself. */
	parentFloor: number | null
}>

export type ViewerDto = Readonly<{
	user: UserDto | null
	roles: Role[]
	can: Readonly<{ manageCategories: boolean; postNote: boolean }>
}>

export type UserProfileDto = Readonly<{
	user: UserDto
	roles: Role[]
	createdAt: string
	threadCount: number
	postCount: number
	/** Topics or notes, as asked (`kind`). */
	threads: PageDto<ThreadDto>
	noteCount: number
	can: Readonly<{ edit: boolean }>
	ext: ExtensionData
}>

/** The places in the frontend where extension plugins may show a component of their own. */
export const UI_SLOTS = [
	'post.footer',
	'post.actions',
	'thread.sidebar',
	'thread.view',
	'category.header',
	'post.before',
	'user.profile.tabs',
	'composer.toolbar',
	'composer.editor',
	'shell.actions',
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

/** Glyphs a footer icon link may use; the frontend draws each one. */
export const FOOTER_ICONS = ['github', 'rss', 'mail', 'link'] as const
export type FooterIcon = (typeof FOOTER_ICONS)[number]

export function isFooterIcon(value: unknown): value is FooterIcon {
	return FOOTER_ICONS.some((icon) => icon === value)
}

/** A link in the site footer. `href` is a forum path (`/...`) or an http(s) URL. */
export type FooterLinkDto = Readonly<{ label: string; href: string }>

/** Footer links, merged across contributors. */
export type FooterLinksDto = Readonly<{
	/** Columns of text links; contributors naming the same title share one column. */
	groups: Array<Readonly<{ title: string; links: FooterLinkDto[] }>>
	/** Icon-only links in the footer's bottom row. */
	icons: Array<FooterLinkDto & Readonly<{ icon: FooterIcon }>>
}>

/** The site footer: the forum's configured links first, then those of running plugins. */
export type FooterDto = FooterLinksDto &
	Readonly<{
		/** Short lines in the bottom row: licence, filing number, copyright, ... */
		notes: string[]
		/** Whether to show the built-in "站内" column (forum pages) before the link columns. */
		siteLinks: boolean
	}>

/** The forum's name and blurbs, set in Forum Core's config. */
export type SiteDto = Readonly<{
	/** Shown in the header, page titles and social cards. */
	name: string
	/** One line under the name in the footer. */
	tagline: string
	/** The home page's meta description. */
	description: string
}>

export type MetaDto = Readonly<{
	viewer: ViewerDto
	auth: Readonly<{
		/** Whether the forum can start a login right now (an identity provider is configured). */
		loginAvailable: boolean
	}>
	search: Readonly<{
		/** Whether a search provider plugin is currently running. */
		available: boolean
	}>
	limits: Readonly<{
		categoryNameMax: number
		threadTitleMax: number
		postBodyMax: number
		noteBodyMax: number
		displayNameMax: number
		handleMax: number
	}>
	content: Readonly<{
		/** How new posts will be rendered right now; the composer offers formatting only for `markdown`. */
		format: BodyFormat
	}>
	/** The stream notes are posted to, or null when there is none the viewer may see. */
	stream: CategorySummaryDto | null
	/** Slots filled by the extensions that are running, in display order. */
	uiSlots: UiSlotDto[]
	site: SiteDto
	/** The configured footer plus the links running plugins put in it. */
	footer: FooterDto
}>

export const FORUM_ERROR_CODES = [
	'invalid',
	'unauthenticated',
	'forbidden',
	'not_found',
	'conflict',
	'unavailable',
	'rate_limited',
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
