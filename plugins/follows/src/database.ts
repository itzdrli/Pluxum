// Server-only: the follows plugin's own managed database. Rows refer to the forum core's users and
// categories by their stable IDs only; there are no foreign keys across plugins.
import { boolean, index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { defineDatabase } from '@pluxel/services/pg'

export const follows = pgTable(
	'follows',
	{
		followerId: uuid('follower_id').notNull(),
		/** `user` or `category`. */
		targetKind: text('target_kind').notNull(),
		targetId: uuid('target_id').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	// The key serves "whom does X follow" and makes a repeated follow a no-op; the index serves
	// follower counts.
	(table) => [
		primaryKey({ columns: [table.followerId, table.targetKind, table.targetId] }),
		index('follows_target_idx').on(table.targetKind, table.targetId),
	],
)

/** Per-account choice about follow notices. No row means the default: notify. */
export const followSettings = pgTable('follow_settings', {
	userId: uuid('user_id').primaryKey(),
	notify: boolean('notify').notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const FollowsDatabase = defineDatabase({
	schema: { follows, followSettings },
})
