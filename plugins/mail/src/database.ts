// Server-only: the mail plugin's own managed database. Rows refer to forum core users by their
// stable IDs only; there are no foreign keys across plugins.
import { boolean, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core'
import { defineDatabase } from '@pluxel/services/database'

/**
 * Per-account choice about notification mail. No row means the default: mail on. The address
 * itself is not kept here; it comes from the identity provider (core's contact email).
 */
export const mailPreferences = pgTable('mail_preferences', {
	userId: uuid('user_id').primaryKey(),
	enabled: boolean('enabled').notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const MailDatabase = defineDatabase({
	schema: { mailPreferences },
})
