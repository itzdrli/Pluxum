// Server-only: the mail plugin's own managed database. Rows refer to forum core users by their
// stable IDs only; there are no foreign keys across plugins.
import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { defineDatabase } from '@pluxel/services/database'
import type { MailLocale } from './templates'

/**
 * Per-account notification mail preferences. No row means mail is on in the site default language.
 * The address is not kept here; it comes from the identity provider (core's contact email).
 */
export const mailPreferences = pgTable('mail_preferences', {
	userId: uuid('user_id').primaryKey(),
	enabled: boolean('enabled').notNull(),
	locale: text('locale').$type<MailLocale>(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const MailDatabase = defineDatabase({
	schema: { mailPreferences },
})
