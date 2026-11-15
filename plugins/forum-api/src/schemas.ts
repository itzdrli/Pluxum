// HTTP contract of the forum API. The static types of these schemas must stay assignable from the
// DTOs in @forum/domain; handlers return domain DTOs, so a drift fails type-checking.
import { LIMITS } from '@forum/domain'
import { t } from 'elysia'

const paged = { page: t.Number(), pageSize: t.Number(), total: t.Number() }

export const user = t.Object({ id: t.String(), displayName: t.String() })

const bodyFormat = t.Union([t.Literal('markdown'), t.Literal('plain')])

// Extension data is opaque to the API: each extension owns the shape under its own ID.
const ext = t.Record(t.String(), t.Unknown())

export const category = t.Object({
	id: t.String(),
	slug: t.String(),
	name: t.String(),
	description: t.String(),
	position: t.Number(),
	threadCount: t.Number(),
	postCount: t.Number(),
})

export const thread = t.Object({
	id: t.String(),
	categoryId: t.String(),
	title: t.String(),
	author: user,
	createdAt: t.String(),
	lastPostAt: t.String(),
	replyCount: t.Number(),
	pinned: t.Boolean(),
	locked: t.Boolean(),
	ext,
})

export const post = t.Object({
	id: t.String(),
	threadId: t.String(),
	author: user,
	body: t.String(),
	bodyHtml: t.String(),
	bodyFormat,
	createdAt: t.String(),
	editedAt: t.Union([t.String(), t.Null()]),
	deleted: t.Boolean(),
	can: t.Object({ edit: t.Boolean(), delete: t.Boolean() }),
	ext,
})

export const preview = t.Object({ bodyHtml: t.String(), bodyFormat })

export const categoryList = t.Object({ items: t.Array(category) })

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
	}),
})

export const meta = t.Object({
	viewer: t.Object({
		user: t.Union([user, t.Null()]),
		roles: t.Array(
			t.Union([
				t.Literal('guest'),
				t.Literal('member'),
				t.Literal('moderator'),
				t.Literal('admin'),
			]),
		),
		can: t.Object({ manageCategories: t.Boolean() }),
	}),
	auth: t.Object({ loginAvailable: t.Boolean() }),
	limits: t.Object({
		categoryNameMax: t.Number(),
		threadTitleMax: t.Number(),
		postBodyMax: t.Number(),
	}),
	content: t.Object({ format: bodyFormat }),
	uiSlots: t.Array(
		t.Object({
			// Mirrors UI_SLOTS in @forum/domain; a missing name fails type-checking of `/meta`.
			slot: t.Union([
				t.Literal('post.footer'),
				t.Literal('post.actions'),
				t.Literal('thread.sidebar'),
				t.Literal('user.profile.tabs'),
				t.Literal('composer.toolbar'),
			]),
			extId: t.String(),
		}),
	),
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
})

export const postBody = t.Object({ body: text(LIMITS.postBodyMax) })
