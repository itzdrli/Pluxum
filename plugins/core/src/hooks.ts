import type { ForumError, ForumErrorCode, Principal, ThreadKind } from '@pluxum/domain'
import { EXTENSION_TIMEOUT_MS, TIMED_OUT, withTimeout } from './extensions'
import { CONTRIBUTION_ID } from './policies'

/** A write that is about to happen, handed to synchronous `beforeWrite` hooks for inspection. */
export type PostBeforeWriteEvent =
	| Readonly<{
			kind: 'thread.create'
			principal: Principal
			categoryId: string
			/** `note` for a post to the stream (its `title` is empty). */
			threadKind: ThreadKind
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
			/** The top-level post it replies inside, or null for a top-level reply. */
			parentId: string | null
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

/**
 * A write that passed validation and permission checks and is about to open its transaction,
 * handed to asynchronous `admit` hooks (rate limits, quotas). Only who is writing and what kind
 * of write it is: the content checks belong to `beforeWrite`.
 */
export type PostAdmitEvent = Readonly<{
	kind: PostBeforeWriteEvent['kind']
	principal: Principal
}>

export type PostHookRejectionCode = Extract<ForumErrorCode, 'invalid' | 'forbidden'>

/** Returned by an `admit` hook that refuses the write. */
export type PostAdmitRejection = Readonly<{
	code?: PostHookRejectionCode | 'rate_limited'
	message: string
}>

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
			threadRef: string
			threadKind: ThreadKind
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
			/** Where the thread was before this write: differs from `categoryId` after a move. */
			previousCategoryId: string
			threadId: string
			threadRef: string
			threadKind: ThreadKind
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
			threadRef: string
			threadKind: ThreadKind
			threadAuthorId: string
			/** Empty for a note. */
			threadTitle: string
			postId: string
			postNumber: number
			/** The top-level post this reply sits inside ("楼中楼"), or null for a top-level reply. */
			parentId: string | null
			/** Author of that top-level post; null for a top-level reply. */
			parentAuthorId: string | null
			/** Inside a floor: the author of the reply it answered, when it answered one. */
			replyToAuthorId: string | null
			/** The thread's last activity before this reply ("revived after 400 days"). */
			previousLastPostAt: string
			authorId: string
			body: string
			createdAt: string
	  }>
	| Readonly<{
			kind: 'post.updated'
			principal: Principal
			categoryId: string
			threadId: string
			threadRef: string
			threadTitle: string
			postId: string
			postNumber: number
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

/**
 * Who a new reply answers, and so who hears about it: inside a floor, the author of the reply it
 * answered or else the floor's author; otherwise the thread's author.
 */
export function answeredAuthorOf(
	event: Extract<PostAfterWriteEvent, Readonly<{ kind: 'post.created' }>>,
): string {
	return event.replyToAuthorId ?? event.parentAuthorId ?? event.threadAuthorId
}

/** How a notice names the place of a post: `《title》` for a topic, `动态` for a note. */
export function threadPlace(kind: ThreadKind, title: string): string {
	return kind === 'note' ? '动态' : `《${title}》`
}

/** Pre-write validation and/or post-write notification contributed by an extension plugin. */
export type PostHookContribution = Readonly<{
	/** Stable contribution ID, e.g. `forum-moderation.filter` or `forum-search.indexer`. */
	id: string
	/**
	 * Asynchronous admission before a write opens its transaction: runs after the core's own
	 * validation and permission checks, and may refuse with `rate_limited`. A hook that throws or
	 * takes too long is skipped, so a broken limiter never blocks writing.
	 */
	admit?: (event: PostAdmitEvent) => PostAdmitRejection | void | Promise<PostAdmitRejection | void>
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

function isRejection(
	value: unknown,
	codes: (code: unknown) => boolean,
): value is PostAdmitRejection {
	return (
		typeof value === 'object' &&
		value !== null &&
		'message' in value &&
		typeof value.message === 'string' &&
		value.message.trim() !== '' &&
		(!('code' in value) || value.code === undefined || codes(value.code))
	)
}

/**
 * Open registry of post hooks. Registration is scoped to the contributor's generation: the
 * returned disposer withdraws exactly that registration and is safe to call more than once.
 */
export class PostHookRegistry {
	private readonly entries = new Map<string, PostHookContribution>()

	register(contribution: PostHookContribution): () => void {
		const { id, admit, beforeWrite, afterWrite } = contribution
		if (typeof id !== 'string' || !CONTRIBUTION_ID.test(id)) {
			throw new TypeError(`Invalid post hook ID: ${id}`)
		}
		if (admit !== undefined && typeof admit !== 'function') {
			throw new TypeError(`Post hook "${id}" admit must be a function`)
		}
		if (beforeWrite !== undefined && typeof beforeWrite !== 'function') {
			throw new TypeError(`Post hook "${id}" beforeWrite must be a function`)
		}
		if (afterWrite !== undefined && typeof afterWrite !== 'function') {
			throw new TypeError(`Post hook "${id}" afterWrite must be a function`)
		}
		if (admit === undefined && beforeWrite === undefined && afterWrite === undefined) {
			throw new TypeError(`Post hook "${id}" must provide admit, beforeWrite or afterWrite`)
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
	 * Runs every registered `admit` hook in parallel and returns the first refusal in registration
	 * order, or null. A hook that throws, answers with something that is not a refusal or takes longer than
	 * `EXTENSION_TIMEOUT_MS` is reported via `onFailure` and skipped.
	 */
	async admit(
		event: PostAdmitEvent,
		onFailure: (error: unknown, hookId: string) => void,
	): Promise<ForumError | null> {
		const hooks = [...this.entries.values()]
		const verdicts = await Promise.all(
			hooks.map(async (entry): Promise<ForumError | null> => {
				const { admit } = entry
				if (!admit) return null
				try {
					const verdict = await withTimeout(
						Promise.resolve().then(() => admit(event)),
						EXTENSION_TIMEOUT_MS,
					)
					if (verdict === TIMED_OUT) throw new Error(`No answer within ${EXTENSION_TIMEOUT_MS} ms`)
					if (verdict === undefined) return null
					if (!isRejection(verdict, (code) => isRejectionCode(code) || code === 'rate_limited')) {
						throw new TypeError('The hook returned an invalid rejection')
					}
					// Withdrawn while answering: its verdict no longer counts.
					if (this.entries.get(entry.id) !== entry) return null
					return { code: verdict.code ?? 'invalid', message: verdict.message }
				} catch (error) {
					onFailure(error, entry.id)
					return null
				}
			}),
		)
		return verdicts.find((verdict) => verdict !== null) ?? null
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
