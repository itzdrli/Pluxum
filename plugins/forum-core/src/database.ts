// Server-only: the forum core's managed database. Extension plugins never import these tables;
// they keep their own and refer to the stable IDs (userId / threadId / postId) published in DTOs.
import {
	boolean,
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uuid,
} from 'drizzle-orm/pg-core'
import { defineDatabase } from '@pluxel/services/database'

const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull()

export const users = pgTable('users', {
	id: uuid('id').defaultRandom().primaryKey(),
	/** Identity provider subject (OIDC `sub` from M2 on); unique per account. */
	subject: text('subject').notNull().unique(),
	displayName: text('display_name').notNull(),
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
	// Counters cover visible (not deleted) threads and posts and change with them in one transaction.
	threadCount: integer('thread_count').notNull().default(0),
	postCount: integer('post_count').notNull().default(0),
	createdAt: createdAt(),
})

export const threads = pgTable(
	'threads',
	{
		id: uuid('id').defaultRandom().primaryKey(),
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
	(table) => [index('posts_thread_idx').on(table.threadId, table.createdAt)],
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
