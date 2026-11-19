// Server-only: the solved plugin's own managed database. Rows refer to the forum core's threads,
// posts and users by their stable IDs only; there are no foreign keys across plugins.
import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { defineDatabase } from '@pluxel/services/database'

/**
 * The accepted answer of a thread: at most one per thread. The answer's floor, author and opening
 * words are copied here when it is accepted (and the words again when it is edited), so a thread
 * list can show what solved it without asking the core for the post.
 */
export const solutions = pgTable(
	'solutions',
	{
		threadId: uuid('thread_id').primaryKey(),
		postId: uuid('post_id').notNull(),
		postNumber: integer('post_number').notNull(),
		answerAuthorId: uuid('answer_author_id').notNull(),
		excerpt: text('excerpt').notNull(),
		acceptedBy: uuid('accepted_by').notNull(),
		acceptedAt: timestamp('accepted_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [index('solutions_post_idx').on(table.postId)],
)

export const SolvedDatabase = defineDatabase({
	schema: { solutions },
})
