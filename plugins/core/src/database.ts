// Server-only: the forum core's managed database. Extension plugins never import these tables;
// they keep their own and refer to the stable IDs (userId / threadId / postId) published in DTOs.
import {
	type AnyPgColumn,
	boolean,
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core'
import { defineDatabase } from '@pluxel/services/database'

const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull()

export const users = pgTable('users', {
	id: uuid('id').defaultRandom().primaryKey(),
	/** Monotonic account number (`1`, `2`, …); drives fallback handles (`u1`, `u2`, …). */
	number: integer('number').generatedByDefaultAsIdentity().notNull().unique(),
	/** Unique lowercase URL handle (`/u/:handle`). */
	handle: text('handle').notNull().unique(),
	/** Identity provider subject (OIDC `sub` from M2 on); unique per account. */
	subject: text('subject').notNull().unique(),
	displayName: text('display_name').notNull(),
	/**
	 * Verified address the identity provider gave at the latest login, for notification mail.
	 * Never part of a DTO; null when the provider shares none.
	 */
	email: text('email'),
	createdAt: createdAt(),
})

export const userRoles = pgTable(
	'user_roles',
	{
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		role: text('role').notNull(),
	},
	(table) => [primaryKey({ columns: [table.userId, table.role] })],
)

export const categories = pgTable('categories', {
	id: uuid('id').defaultRandom().primaryKey(),
	slug: text('slug').notNull().unique(),
	name: text('name').notNull(),
	description: text('description').notNull().default(''),
	position: integer('position').notNull().default(0),
	/** `board` holds titled topics; `stream` holds notes and stays out of category navigation. */
	kind: text('kind', { enum: ['board', 'stream'] })
		.notNull()
		.default('board'),
	/** The weakest role that may see the category and its threads (`guest`: everyone). */
	viewRole: text('view_role', { enum: ['guest', 'member', 'moderator', 'admin'] })
		.notNull()
		.default('guest'),
	/** The weakest role that may start threads in it. */
	postRole: text('post_role', { enum: ['member', 'moderator', 'admin'] })
		.notNull()
		.default('member'),
	/** The weakest role that may reply in it. */
	replyRole: text('reply_role', { enum: ['member', 'moderator', 'admin'] })
		.notNull()
		.default('member'),
	// Counters cover visible (not deleted) threads and posts and change with them in one transaction.
	threadCount: integer('thread_count').notNull().default(0),
	postCount: integer('post_count').notNull().default(0),
	createdAt: createdAt(),
})

export const threads = pgTable(
	'threads',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** Monotonic thread number starting at 1001 (`/t/1001-...`). */
		number: integer('number').generatedByDefaultAsIdentity({ startWith: 1001 }).notNull().unique(),
		/** Concise ASCII slug derived from `title`, or `""` for non-ASCII titles. */
		slug: text('slug').notNull().default(''),
		/** Highest floor number assigned in this thread (`1` for the opening post; never decrements). */
		postSeq: integer('post_seq').notNull().default(1),
		categoryId: uuid('category_id')
			.notNull()
			.references(() => categories.id),
		authorId: uuid('author_id')
			.notNull()
			.references(() => users.id),
		title: text('title').notNull(),
		pinned: boolean('pinned').notNull().default(false),
		locked: boolean('locked').notNull().default(false),
		/** Visible posts after the opening post. */
		replyCount: integer('reply_count').notNull().default(0),
		/** Interaction points extensions add (likes, ...); counts towards "hot" with the replies. */
		engagement: integer('engagement').notNull().default(0),
		createdAt: createdAt(),
		lastPostAt: timestamp('last_post_at', { withTimezone: true }).defaultNow().notNull(),
		deletedAt: timestamp('deleted_at', { withTimezone: true }),
	},
	(table) => [index('threads_listing_idx').on(table.categoryId, table.pinned, table.lastPostAt)],
)

export const posts = pgTable(
	'posts',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		threadId: uuid('thread_id')
			.notNull()
			.references(() => threads.id),
		/** 1-based floor number inside the thread (`1` for the opening post). */
		number: integer('number').notNull().default(1),
		/** The top-level post of the same thread this one replies inside; null for a top-level post. */
		parentId: uuid('parent_id').references((): AnyPgColumn => posts.id),
		/** Author of the reply this one answers inside the floor, when it answered a reply. */
		replyToId: uuid('reply_to_id').references(() => users.id),
		authorId: uuid('author_id')
			.notNull()
			.references(() => users.id),
		/** Source text as written; rendering is a separate pipeline (M3). */
		body: text('body').notNull(),
		/** The opening post carries the thread body and is removed only with its thread. */
		opening: boolean('opening').notNull().default(false),
		createdAt: createdAt(),
		editedAt: timestamp('edited_at', { withTimezone: true }),
		deletedAt: timestamp('deleted_at', { withTimezone: true }),
	},
	(table) => [
		index('posts_thread_idx').on(table.threadId, table.createdAt),
		index('posts_thread_parent_idx').on(table.threadId, table.parentId, table.createdAt),
		uniqueIndex('posts_thread_number_idx').on(table.threadId, table.number),
	],
)

/** The body a post had before each edit. */
export const postRevisions = pgTable(
	'post_revisions',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		postId: uuid('post_id')
			.notNull()
			.references(() => posts.id),
		editorId: uuid('editor_id')
			.notNull()
			.references(() => users.id),
		body: text('body').notNull(),
		createdAt: createdAt(),
	},
	(table) => [index('post_revisions_post_idx').on(table.postId, table.createdAt)],
)

export const ForumDatabase = defineDatabase({
	schema: { users, userRoles, categories, threads, posts, postRevisions },
})
