// Server-only: the reads plugin's own managed database. Rows refer to the forum core's threads
// and users by their stable IDs only; there are no foreign keys across plugins.
import { pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core'
import { defineDatabase } from '@pluxel/services/pg'

/** When a member last read a thread to its end. */
export const threadReads = pgTable(
	'thread_reads',
	{
		userId: uuid('user_id').notNull(),
		threadId: uuid('thread_id').notNull(),
		readAt: timestamp('read_at', { withTimezone: true }).defaultNow().notNull(),
	},
	// Leading with the member serves the per-page batch read of one viewer.
	(table) => [primaryKey({ columns: [table.userId, table.threadId] })],
)

/** The moment a member first looked at a thread list: what happened before it counts as read. */
export const readerBaselines = pgTable('reader_baselines', {
	userId: uuid('user_id').primaryKey(),
	since: timestamp('since', { withTimezone: true }).defaultNow().notNull(),
})

export const ReadsDatabase = defineDatabase({
	schema: { threadReads, readerBaselines },
})
