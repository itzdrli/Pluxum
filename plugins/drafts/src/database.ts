// Server-only: the drafts plugin's own managed database. Rows refer to the forum core's users by
// their stable IDs only; there are no foreign keys across plugins.
import { index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { defineDatabase } from '@pluxel/services/pg'

/** One unsent text per member and writing place (`reply:<threadId>`, `thread:<categoryId>`, …). */
export const drafts = pgTable(
	'drafts',
	{
		userId: uuid('user_id').notNull(),
		key: text('key').notNull(),
		body: text('body').notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.userId, table.key] }),
		// Finds a member's oldest drafts when they go over the limit.
		index('drafts_user_updated_idx').on(table.userId, table.updatedAt),
	],
)

export const DraftsDatabase = defineDatabase({ schema: { drafts } })
