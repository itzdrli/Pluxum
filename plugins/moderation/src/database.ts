// Server-only: the moderation plugin's own managed database. Rows refer to the forum core's
// users, threads and posts by their stable IDs only; there are no foreign keys across plugins.
import { defineDatabase } from '@pluxel/services/pg'
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const reports = pgTable(
	'reports',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		reporterId: uuid('reporter_id').notNull(),
		targetType: text('target_type').$type<'post' | 'thread'>().notNull(),
		targetId: uuid('target_id').notNull(),
		threadId: uuid('thread_id').notNull(),
		postId: uuid('post_id'),
		targetAuthorId: uuid('target_author_id'),
		reason: text('reason').notNull(),
		status: text('status').$type<'open' | 'resolved' | 'dismissed'>().default('open').notNull(),
		resolutionNote: text('resolution_note'),
		resolvedBy: uuid('resolved_by'),
		resolvedAt: timestamp('resolved_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('reports_status_created_idx').on(table.status, table.createdAt),
		index('reports_target_idx').on(table.targetType, table.targetId),
	],
)

export const bans = pgTable('bans', {
	userId: uuid('user_id').primaryKey(),
	reason: text('reason').notNull(),
	bannedBy: uuid('banned_by').notNull(),
	expiresAt: timestamp('expires_at', { withTimezone: true }),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	revokedAt: timestamp('revoked_at', { withTimezone: true }),
	revokedBy: uuid('revoked_by'),
})

export const moderationLogs = pgTable(
	'moderation_logs',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		actorId: uuid('actor_id').notNull(),
		action: text('action').notNull(),
		targetType: text('target_type').notNull(),
		targetId: uuid('target_id').notNull(),
		detail: text('detail'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [index('moderation_logs_created_idx').on(table.createdAt)],
)

export const ModerationDatabase = defineDatabase({
	schema: { reports, bans, moderationLogs },
})
