// Server-only: the reactions plugin's own managed database. Rows refer to the forum core's posts
// and users by their stable IDs only; there are no foreign keys across plugins.
import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { defineDatabase } from '@pluxel/services/database'

export const reactions = pgTable(
	'reactions',
	{
		postId: uuid('post_id').notNull(),
		userId: uuid('user_id').notNull(),
		/** Which reaction; `like` is the only one so far. */
		kind: text('kind').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	// Leading with the post serves the per-page batch read; the key makes a repeated reaction a no-op.
	(table) => [primaryKey({ columns: [table.postId, table.userId, table.kind] })],
)

export const ReactionsDatabase = defineDatabase({
	schema: { reactions },
})
