// Server-only: the messages plugin's own managed database. Rows refer to the forum core's users by
// their stable IDs only; there are no foreign keys across plugins.
import {
	bigint,
	index,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core'
import { defineDatabase } from '@pluxel/services/pg'

/** A private conversation: two people (`direct`) or a small group with a name and an owner. */
export const conversations = pgTable(
	'conversations',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		kind: text('kind', { enum: ['direct', 'group'] }).notNull(),
		/** A group's name; empty for a direct conversation. */
		title: text('title').notNull().default(''),
		/** Who started it; for a group, the one who may rename it and add or remove people. */
		ownerId: uuid('owner_id').notNull(),
		/** The two people of a direct conversation, sorted (`<id>:<id>`), so a pair has one. */
		directKey: text('direct_key'),
		/** `seq` of the newest message; orders the conversation list. */
		lastSeq: bigint('last_seq', { mode: 'number' }).notNull().default(0),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [uniqueIndex('conversations_direct_key_idx').on(table.directKey)],
)

export const members = pgTable(
	'conversation_members',
	{
		conversationId: uuid('conversation_id').notNull(),
		userId: uuid('user_id').notNull(),
		/** `seq` of the newest message the member has seen. */
		lastReadSeq: bigint('last_read_seq', { mode: 'number' }).notNull().default(0),
		joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.conversationId, table.userId] }),
		index('conversation_members_user_idx').on(table.userId),
	],
)

export const messages = pgTable(
	'messages',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** Increases with every message across all conversations: the cursor of reads and polls. */
		seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity().notNull().unique(),
		conversationId: uuid('conversation_id').notNull(),
		authorId: uuid('author_id').notNull(),
		body: text('body').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [index('messages_conversation_idx').on(table.conversationId, table.seq)],
)

/** Who may start a conversation with a member. No row means the default: everyone. */
export const messageSettings = pgTable('message_settings', {
	userId: uuid('user_id').primaryKey(),
	allow: text('allow', { enum: ['everyone', 'following', 'nobody'] }).notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const MessagesDatabase = defineDatabase({
	schema: { conversations, members, messages, messageSettings },
})
