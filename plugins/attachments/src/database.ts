// Server-only: the attachments plugin's own managed database. Rows refer to the forum core's
// users and posts by their stable IDs only; there are no foreign keys across plugins.
import { index, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { defineDatabase } from '@pluxel/services/pg'

const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull()

export const attachments = pgTable('attachments', {
	id: uuid('id').defaultRandom().primaryKey(),
	uploaderId: uuid('uploader_id').notNull(),
	/** `'avatar'` or `'attachment'`. */
	purpose: text('purpose').notNull(),
	/** Object key inside the configured S3 bucket. */
	objectKey: text('object_key').notNull().unique(),
	filename: text('filename').notNull(),
	contentType: text('content_type').notNull(),
	size: integer('size').notNull(),
	sha256: text('sha256').notNull(),
	createdAt: createdAt(),
})

export const userAvatars = pgTable('user_avatars', {
	userId: uuid('user_id').primaryKey(),
	attachmentId: uuid('attachment_id')
		.notNull()
		.references(() => attachments.id, { onDelete: 'cascade' }),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const postAttachments = pgTable(
	'post_attachments',
	{
		postId: uuid('post_id').notNull(),
		attachmentId: uuid('attachment_id')
			.notNull()
			.references(() => attachments.id, { onDelete: 'cascade' }),
		position: integer('position').notNull().default(0),
	},
	(table) => [
		primaryKey({ columns: [table.postId, table.attachmentId] }),
		index('post_attachments_post_idx').on(table.postId, table.position),
	],
)

export const AttachmentsDatabase = defineDatabase({
	schema: { attachments, userAvatars, postAttachments },
})
