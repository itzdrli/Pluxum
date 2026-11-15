// Server-only: the notifications plugin's own managed database. Rows refer to the forum core's
// users, threads and posts by their stable IDs only; there are no foreign keys across plugins.
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { defineDatabase } from '@pluxel/services/database'

export const notifications = pgTable(
	'notifications',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		recipientId: uuid('recipient_id').notNull(),
		kind: text('kind').notNull(),
		title: text('title').notNull(),
		body: text('body'),
		path: text('path'),
		threadId: uuid('thread_id'),
		postId: uuid('post_id'),
		actorId: uuid('actor_id'),
		readAt: timestamp('read_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('notifications_recipient_created_idx').on(table.recipientId, table.createdAt),
		index('notifications_recipient_read_idx').on(table.recipientId, table.readAt),
	],
)

export const NotificationsDatabase = defineDatabase({
	schema: { notifications },
})
