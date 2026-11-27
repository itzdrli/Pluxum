// Server-only: the push plugin's own managed database. Rows refer to the forum core's users by
// their stable IDs only; there are no foreign keys across plugins.
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { defineDatabase } from '@pluxel/services/pg'

/** One browser that asked for push notices: its push service address and encryption keys. */
export const pushSubscriptions = pgTable(
	'push_subscriptions',
	{
		/** The push service URL; one browser profile has one, so it identifies the subscription. */
		endpoint: text('endpoint').primaryKey(),
		userId: uuid('user_id').notNull(),
		p256dh: text('p256dh').notNull(),
		auth: text('auth').notNull(),
		/** The language the browser showed the forum in when it subscribed: notices are worded in it. */
		locale: text('locale').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [index('push_subscriptions_user_idx').on(table.userId, table.createdAt)],
)

export const PushDatabase = defineDatabase({ schema: { pushSubscriptions } })
