// HTTP contract of the forum API. The static types of these schemas must stay assignable from the
// DTOs in @pluxum/domain; handlers return domain DTOs, so a drift fails type-checking.
import { LIMITS, THEME_IDS } from '@pluxum/domain'
import { t } from 'elysia'

const paged = { page: t.Number(), pageSize: t.Number(), total: t.Number() }

// Extension data is opaque to the API: each extension owns the shape under its own ID.
const ext = t.Record(t.String(), t.Unknown())

export const user = t.Object({
	id: t.String(),
	handle: t.String(),
	displayName: t.String(),
	ext: t.Optional(ext),
})

const role = t.Union([
	t.Literal('guest'),
	t.Literal('member'),
	t.Literal('moderator'),
	t.Literal('admin'),
])

const bodyFormat = t.Union([t.Literal('markdown'), t.Literal('plain')])
const categoryKind = t.Union([t.Literal('board'), t.Literal('stream')])
const threadKind = t.Union([t.Literal('topic'), t.Literal('note')])

export const category = t.Object({
	id: t.String(),
	slug: t.String(),
	name: t.String(),
	description: t.String(),
	position: t.Number(),
	kind: categoryKind,
	threadCount: t.Number(),
	postCount: t.Number(),
})

export const categorySummary = t.Object({
	id: t.String(),
	slug: t.String(),
	name: t.String(),
})

/** A post without the replies inside it: a reply itself, or a note's opening post in a list. */
const postFields = {
	id: t.String(),
	threadId: t.String(),
	number: t.Number(),
	parentId: t.Union([t.String(), t.Null()]),
	replyTo: t.Union([user, t.Null()]),
	author: user,
	body: t.String(),
	bodyHtml: t.String(),
	bodyFormat,
	createdAt: t.String(),
	editedAt: t.Union([t.String(), t.Null()]),
	deleted: t.Boolean(),
	can: t.Object({ edit: t.Boolean(), delete: t.Boolean() }),
	ext,
}
const innerPost = t.Object(postFields)

export const post = t.Object({
	...postFields,
	replies: t.Optional(t.Object({ items: t.Array(innerPost), total: t.Number() })),
})

export const replyPage = t.Object({ items: t.Array(innerPost), ...paged })

export const floorLocation = t.Object({
	threadRef: t.String(),
	floor: t.Number(),
	page: t.Number(),
	parentFloor: t.Union([t.Number(), t.Null()]),
})

export const thread = t.Object({
	id: t.String(),
	number: t.Number(),
	slug: t.String(),
	ref: t.String(),
	categoryId: t.String(),
	kind: threadKind,
	title: t.String(),
	author: user,
	createdAt: t.String(),
	lastPostAt: t.String(),
	replyCount: t.Number(),
	pinned: t.Boolean(),
	locked: t.Boolean(),
	opening: t.Optional(innerPost),
	latestReply: t.Optional(innerPost),
	ext,
})

export const recentThread = t.Object({
	...thread.properties,
	category: categorySummary,
})

/** Where a post lives: its thread's URL segment and its floor number. */
export const postLocation = t.Object({ threadRef: t.String(), postNumber: t.Number() })

export const preview = t.Object({ bodyHtml: t.String(), bodyFormat })

export const searchHit = t.Object({
	postId: t.String(),
	postNumber: t.Number(),
	threadId: t.String(),
	threadRef: t.String(),
	categoryId: t.String(),
	opening: t.Boolean(),
	title: t.String(),
	snippetHtml: t.String(),
	author: user,
	createdAt: t.String(),
})

export const searchPage = t.Object({ items: t.Array(searchHit), ...paged })

export const categoryList = t.Object({ items: t.Array(category) })

export const recentThreads = t.Object({
	items: t.Array(recentThread),
	...paged,
})

export const categoryThreads = t.Object({
	category,
	threads: t.Object({ items: t.Array(thread), ...paged }),
	can: t.Object({ createThread: t.Boolean() }),
})

export const threadDetail = t.Object({
	thread,
	category,
	posts: t.Object({ items: t.Array(post), ...paged }),
	can: t.Object({
		reply: t.Boolean(),
		edit: t.Boolean(),
		delete: t.Boolean(),
		moderate: t.Boolean(),
		move: t.Boolean(),
	}),
})

export const userProfile = t.Object({
	user,
	roles: t.Array(role),
	createdAt: t.String(),
	threadCount: t.Number(),
	postCount: t.Number(),
	threads: t.Object({ items: t.Array(thread), ...paged }),
	noteCount: t.Number(),
	can: t.Object({ edit: t.Boolean() }),
	ext,
	ghost: t.Boolean(),
})

export const meta = t.Object({
	viewer: t.Object({
		user: t.Union([user, t.Null()]),
		roles: t.Array(role),
		can: t.Object({ manageCategories: t.Boolean(), postNote: t.Boolean() }),
		following: t.Object({ available: t.Boolean(), any: t.Boolean() }),
	}),
	auth: t.Object({
		loginAvailable: t.Boolean(),
		provider: t.Boolean(),
		providerLabel: t.Union([t.String(), t.Null()]),
		password: t.Boolean(),
	}),
	search: t.Object({ available: t.Boolean() }),
	limits: t.Object({
		categoryNameMax: t.Number(),
		threadTitleMax: t.Number(),
		postBodyMax: t.Number(),
		noteBodyMax: t.Number(),
		displayNameMax: t.Number(),
		handleMax: t.Number(),
	}),
	content: t.Object({ format: bodyFormat }),
	stream: t.Union([categorySummary, t.Null()]),
	ghostUserId: t.Union([t.String(), t.Null()]),
	uiSlots: t.Array(
		t.Object({
			// Mirrors UI_SLOTS in @pluxum/domain; a missing name fails type-checking of `/meta`.
			slot: t.Union([
				t.Literal('post.footer'),
				t.Literal('post.actions'),
				t.Literal('thread.sidebar'),
				t.Literal('thread.view'),
				t.Literal('category.header'),
				t.Literal('post.before'),
				t.Literal('post.after'),
				t.Literal('thread.badges'),
				t.Literal('user.header'),
				t.Literal('user.profile.tabs'),
				t.Literal('composer.toolbar'),
				t.Literal('composer.editor'),
				t.Literal('shell.actions'),
				t.Literal('thread.social'),
			]),
			extId: t.String(),
		}),
	),
	site: t.Object({
		name: t.String(),
		tagline: t.String(),
		description: t.String(),
		defaultTheme: t.UnionEnum(THEME_IDS),
		brand: t.Object({
			logo: t.Union([t.String(), t.Null()]),
			icon: t.Union([t.String(), t.Null()]),
			social: t.Union([t.String(), t.Null()]),
		}),
	}),
	footer: t.Object({
		groups: t.Array(
			t.Object({
				title: t.String(),
				links: t.Array(t.Object({ label: t.String(), href: t.String() })),
			}),
		),
		icons: t.Array(
			t.Object({
				label: t.String(),
				href: t.String(),
				// Mirrors FOOTER_ICONS in @pluxum/domain.
				icon: t.Union([
					t.Literal('github'),
					t.Literal('rss'),
					t.Literal('mail'),
					t.Literal('link'),
				]),
			}),
		),
		notes: t.Array(t.String()),
		siteLinks: t.Boolean(),
	}),
})

export const ping = t.Object({
	status: t.Literal('ok'),
	service: t.Literal('forum-api'),
	time: t.String(),
})

// Request bodies only bound sizes here; the forum core owns the actual content rules. The bounds
// are in UTF-16 units and deliberately looser than the core's code-point limits.
const text = (max: number) => t.String({ maxLength: max * 2 })

export const paging = t.Object({
	page: t.Optional(t.String({ maxLength: 10 })),
	pageSize: t.Optional(t.String({ maxLength: 10 })),
})

export const threadQuery = t.Object({
	page: t.Optional(t.String({ maxLength: 10 })),
	pageSize: t.Optional(t.String({ maxLength: 10 })),
	/** A top-level floor on the page whose replies are all wanted. */
	expand: t.Optional(t.String({ maxLength: 10 })),
})

export const profileQuery = t.Object({
	page: t.Optional(t.String({ maxLength: 10 })),
	pageSize: t.Optional(t.String({ maxLength: 10 })),
	kind: t.Optional(threadKind),
})

export const paletteCommands = t.Array(
	t.Object({
		id: t.String(),
		label: t.String(),
		group: t.String(),
		keywords: t.Array(t.String()),
		href: t.String(),
		external: t.Boolean(),
	}),
)

export const community = t.Object({
	members: t.Number(),
	newMembers: t.Array(user),
	activeMembers: t.Array(t.Object({ user, posts: t.Number() })),
	days: t.Number(),
})

export const recentThreadsQuery = t.Object({
	page: t.Optional(t.String({ maxLength: 10 })),
	pageSize: t.Optional(t.String({ maxLength: 10 })),
	sort: t.Optional(t.Union([t.Literal('active'), t.Literal('new'), t.Literal('hot')])),
	scope: t.Optional(t.Union([t.Literal('all'), t.Literal('following')])),
})

export const searchQuery = t.Object({
	q: t.Optional(text(LIMITS.searchQueryMax)),
	categoryId: t.Optional(t.String({ maxLength: 64 })),
	authorId: t.Optional(t.String({ maxLength: 64 })),
	threadsOnly: t.Optional(t.String({ maxLength: 10 })),
	page: t.Optional(t.String({ maxLength: 10 })),
	pageSize: t.Optional(t.String({ maxLength: 10 })),
})

export const createCategoryBody = t.Object({
	name: text(LIMITS.categoryNameMax),
	slug: t.Optional(text(LIMITS.slugMax)),
	description: t.Optional(text(LIMITS.categoryDescriptionMax)),
	position: t.Optional(t.Integer()),
})

export const updateCategoryBody = t.Object({
	name: t.Optional(text(LIMITS.categoryNameMax)),
	slug: t.Optional(text(LIMITS.slugMax)),
	description: t.Optional(text(LIMITS.categoryDescriptionMax)),
	position: t.Optional(t.Integer()),
})

export const createThreadBody = t.Object({
	categoryId: t.String({ maxLength: 64 }),
	title: text(LIMITS.threadTitleMax),
	body: text(LIMITS.postBodyMax),
})

export const updateThreadBody = t.Object({
	title: t.Optional(text(LIMITS.threadTitleMax)),
	pinned: t.Optional(t.Boolean()),
	locked: t.Optional(t.Boolean()),
	categoryId: t.Optional(t.String({ maxLength: 64 })),
})

export const postBody = t.Object({ body: text(LIMITS.postBodyMax) })

export const createPostBody = t.Object({
	body: text(LIMITS.postBodyMax),
	parentId: t.Optional(t.String({ maxLength: 64 })),
})

export const updateUserBody = t.Object({
	displayName: t.Optional(text(LIMITS.displayNameMax)),
	handle: t.Optional(text(LIMITS.handleMax)),
})
