// Server-only: the search plugin's own managed database. Rows refer to the forum core's posts,
// threads, categories and users by their stable IDs only; there are no foreign keys across plugins.
import { boolean, customType, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { defineDatabase } from '@pluxel/services/pg'

const tsvector = customType<{ data: string }>({
	dataType() {
		return 'tsvector'
	},
})

export const searchDocuments = pgTable(
	'search_documents',
	{
		postId: uuid('post_id').primaryKey(),
		threadId: uuid('thread_id').notNull(),
		categoryId: uuid('category_id').notNull(),
		authorId: uuid('author_id').notNull(),
		opening: boolean('opening').notNull(),
		title: text('title').notNull(),
		plainBody: text('plain_body').notNull(),
		titleTokens: text('title_tokens').notNull(),
		bodyTokens: text('body_tokens').notNull(),
		searchVector: tsvector('search_vector').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
	},
	(table) => [
		index('search_documents_vector_idx').using('gin', table.searchVector),
		index('search_documents_thread_idx').on(table.threadId),
		index('search_documents_category_created_idx').on(table.categoryId, table.createdAt),
	],
)

export const SearchDatabase = defineDatabase({
	schema: { searchDocuments },
})
