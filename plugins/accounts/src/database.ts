// Server-only: the accounts plugin's own managed database. Rows refer to Pluxum Core's users by
// their stable IDs only; there are no foreign keys across plugins.
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { defineDatabase } from '@pluxel/services/database'

/**
 * One email-and-password login per forum user. `id` names the account in the user's subject
 * (`local:<id>`), so the forum account exists before any login method knows its user ID.
 */
export const accounts = pgTable('accounts', {
	id: uuid('id').primaryKey(),
	userId: uuid('user_id').notNull().unique(),
	/** As typed with the domain lower-cased; matched case-insensitively through `emailKey`. */
	email: text('email').notNull(),
	/** `email` lower-cased: one account per address, whatever its case. */
	emailKey: text('email_key').notNull().unique(),
	/** `scrypt$N$r$p$salt$hash`, base64url parts. */
	passwordHash: text('password_hash').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	passwordChangedAt: timestamp('password_changed_at', { withTimezone: true })
		.defaultNow()
		.notNull(),
})

/** Outstanding password resets; only the SHA-256 of the token is kept. */
export const passwordResets = pgTable(
	'password_resets',
	{
		tokenHash: text('token_hash').primaryKey(),
		accountId: uuid('account_id').notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [index('password_resets_account_idx').on(table.accountId)],
)

export const AccountsDatabase = defineDatabase({
	schema: { accounts, passwordResets },
})
