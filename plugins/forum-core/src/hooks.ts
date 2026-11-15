import type { ForumError, ForumErrorCode, Principal } from '@forum/domain'
import { EXTENSION_TIMEOUT_MS, TIMED_OUT, withTimeout } from './extensions'
import { CONTRIBUTION_ID } from './policies'

/** A write that is about to happen, handed to synchronous `beforeWrite` hooks for inspection. */
export type PostBeforeWriteEvent =
	| Readonly<{
			kind: 'thread.create'
			principal: Principal
			categoryId: string
			title: string
			body: string
	  }>
	| Readonly<{
			kind: 'thread.update'
			principal: Principal
			categoryId: string
			threadId: string
			title: string
	  }>
	| Readonly<{
			kind: 'post.create'
			principal: Principal
			categoryId: string
			threadId: string
			body: string
	  }>
	| Readonly<{
			kind: 'post.update'
			principal: Principal
			categoryId: string
			threadId: string
			postId: string
			opening: boolean
			body: string
	  }>

export type PostHookRejectionCode = Extract<ForumErrorCode, 'invalid' | 'forbidden'>

/** Returned by a `beforeWrite` hook when it refuses the write; `code` defaults to `'invalid'`. */
export type PostHookRejection = Readonly<{
	code?: PostHookRejectionCode
	message: string
}>

/** Facts about a thread or post write that has been committed to the core database. */
export type PostAfterWriteEvent =
	| Readonly<{
			kind: 'thread.created'
			principal: Principal
			categoryId: string
			threadId: string
			postId: string
			authorId: string
			title: string
			body: string
			createdAt: string
	  }>
	| Readonly<{
			kind: 'thread.updated'
			principal: Principal
			categoryId: string
			threadId: string
			postId: string
			authorId: string
			title: string
			body: string
			pinned: boolean
			locked: boolean
			createdAt: string
	  }>
	| Readonly<{
			kind: 'thread.deleted'
			principal: Principal
			categoryId: string
			threadId: string
			authorId: string
	  }>
	| Readonly<{
			kind: 'post.created'
			principal: Principal
			categoryId: string
			threadId: string
			threadAuthorId: string
			threadTitle: string
			postId: string
			authorId: string
			body: string
			createdAt: string
	  }>
	| Readonly<{
			kind: 'post.updated'
			principal: Principal
			categoryId: string
			threadId: string
			threadTitle: string
			postId: string
			authorId: string
			opening: boolean
			body: string
			createdAt: string
			editedAt: string
	  }>
	| Readonly<{
			kind: 'post.deleted'
			principal: Principal
			categoryId: string
			threadId: string
			postId: string
			authorId: string
	  }>

/** Pre-write validation and/or post-write notification contributed by an extension plugin. */
export type PostHookContribution = Readonly<{
	/** Stable contribution ID, e.g. `forum-moderation.filter` or `forum-search.indexer`. */
	id: string
	/**
	 * Synchronous check before a thread or post is created or edited. Returning a rejection aborts
	 * the write with that error; returning undefined lets it proceed.
	 */
	beforeWrite?: (event: PostBeforeWriteEvent) => PostHookRejection | void
	/**
	 * Asynchronous notification after a thread or post write has been committed. Failures are
	 * logged and never roll back the committed write.
	 */
	afterWrite?: (event: PostAfterWriteEvent) => void | Promise<void>
}>

function isRejectionCode(value: unknown): value is PostHookRejectionCode {
	return value === 'invalid' || value === 'forbidden'
}

/**
 * Open registry of post hooks. Registration is scoped to the contributor's generation: the
 * returned disposer withdraws exactly that registration and is safe to call more than once.
 */
export class PostHookRegistry {
	private readonly entries = new Map<string, PostHookContribution>()

	register(contribution: PostHookContribution): () => void {
		const { id, beforeWrite, afterWrite } = contribution
		if (typeof id !== 'string' || !CONTRIBUTION_ID.test(id)) {
			throw new TypeError(`Invalid post hook ID: ${id}`)
		}
		if (beforeWrite !== undefined && typeof beforeWrite !== 'function') {
			throw new TypeError(`Post hook "${id}" beforeWrite must be a function`)
		}
		if (afterWrite !== undefined && typeof afterWrite !== 'function') {
			throw new TypeError(`Post hook "${id}" afterWrite must be a function`)
		}
		if (beforeWrite === undefined && afterWrite === undefined) {
			throw new TypeError(`Post hook "${id}" must provide beforeWrite or afterWrite`)
		}
		if (this.entries.has(id)) {
			throw new Error(`Post hook "${id}" is already registered`)
		}
		this.entries.set(id, contribution)
		return () => {
			if (this.entries.get(id) === contribution) this.entries.delete(id)
		}
	}

	ids(): string[] {
		return [...this.entries.keys()]
	}

	/**
	 * Runs every registered `beforeWrite` hook in registration order. Returns the first rejection,
	 * or null when all hooks let the write through. A hook that throws is reported via `onFailure`
	 * and skipped so a broken extension does not block forum writes.
	 */
	beforeWrite(
		event: PostBeforeWriteEvent,
		onFailure: (error: unknown, hookId: string) => void,
	): ForumError | null {
		for (const entry of this.entries.values()) {
			if (!entry.beforeWrite) continue
			try {
				const verdict = entry.beforeWrite(event)
				if (verdict === undefined) continue
				if (
					typeof verdict !== 'object' ||
					verdict === null ||
					typeof verdict.message !== 'string' ||
					!verdict.message.trim() ||
					(verdict.code !== undefined && !isRejectionCode(verdict.code))
				) {
					throw new TypeError('The hook returned an invalid rejection')
				}
				return { code: verdict.code ?? 'invalid', message: verdict.message }
			} catch (error) {
				onFailure(error, entry.id)
			}
		}
		return null
	}

	/**
	 * Delivers a committed write event to every registered `afterWrite` hook in parallel. One that
	 * throws or takes too long is reported through `onFailure`; the write itself has already
	 * succeeded.
	 */
	async afterWrite(
		event: PostAfterWriteEvent,
		onFailure: (error: unknown, hookId: string) => void,
	): Promise<void> {
		const hooks = [...this.entries.values()].filter(
			(
				entry,
			): entry is PostHookContribution & {
				afterWrite: NonNullable<PostHookContribution['afterWrite']>
			} => typeof entry.afterWrite === 'function',
		)
		if (hooks.length === 0) return
		await Promise.all(
			hooks.map(async (entry) => {
				try {
					const outcome = await withTimeout(
						Promise.resolve().then(() => entry.afterWrite(event)),
						EXTENSION_TIMEOUT_MS,
					)
					if (outcome === TIMED_OUT) throw new Error(`No answer within ${EXTENSION_TIMEOUT_MS} ms`)
				} catch (error) {
					onFailure(error, entry.id)
				}
			}),
		)
	}
}
