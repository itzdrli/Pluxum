// Server-only: the mail plugin's own managed database. Rows refer to forum core users by their
// stable IDs only; there are no foreign keys across plugins.
import { boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { defineDatabase } from '@pluxel/services/database'

/** One address per account. It receives notifications once confirmed and while `enabled`. */
export const mailAddresses = pgTable('mail_addresses', {
	userId: uuid('user_id').primaryKey(),
	email: text('email').notNull(),
	/** Set once the account entered the code mailed to `email`; cleared when the address changes. */
	verifiedAt: timestamp('verified_at', { withTimezone: true }),
	enabled: boolean('enabled').default(true).notNull(),
	/** SHA-256 of the pending confirmation code; null when none is pending. */
	codeHash: text('code_hash'),
	codeExpiresAt: timestamp('code_expires_at', { withTimezone: true }),
	codeSentAt: timestamp('code_sent_at', { withTimezone: true }),
	codeAttempts: integer('code_attempts').default(0).notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const MailDatabase = defineDatabase({
	schema: { mailAddresses },
})
