import { createHash } from 'node:crypto'
import type { RenderedBody } from './content'
import { EXTENSION_TIMEOUT_MS, TIMED_OUT, withTimeout } from './extensions'
import { CONTRIBUTION_ID } from './policies'

/**
 * Caching the core may use, contributed by a bridge plugin (forum-cache) that owns the actual
 * cache. Without one the core reads everything fresh; with one it keeps two things:
 *
 * - `rendered`: post bodies already turned into HTML, keyed by the renderer generation and a
 *   digest of the source. Synchronous and process-local, because rendering is.
 * - `listings`: read models of the overview feed, category pages and the community panel, before
 *   extension data is attached (that part is per viewer). Values are plain JSON, so the store may
 *   be shared between processes.
 */
export type ForumCacheContribution = Readonly<{
	/** Stable contribution ID, e.g. `forum-cache.cache`. */
	id: string
	rendered: Readonly<{
		get: (key: string) => RenderedBody | undefined
		set: (key: string, value: RenderedBody) => void
		clear: () => void
	}>
	listings: Readonly<{
		/** The value kept for `key`, or undefined when there is none. */
		get: (key: string) => Promise<unknown>
		/** Keeps a listing for `key`; the cache decides for how long. */
		set: (key: string, value: unknown) => Promise<void>
		/** Drops every listing; the core calls it after each write that changes one. */
		clear: () => Promise<void>
	}>
}>

/** Short, stable digest for cache keys (a post body, a set of category IDs). */
export function digest(value: string): string {
	return createHash('sha256').update(value).digest('base64url').slice(0, 22)
}

/**
 * The core's cache slot. It holds at most one cache: registration is scoped to the contributor's
 * generation, and the returned disposer withdraws exactly that registration. Every call fails
 * open: a cache that throws or hangs is reported and bypassed, never surfaced to readers.
 */
export class ForumCacheRegistry {
	private installed: ForumCacheContribution | undefined
	/** Loads in progress by key, so concurrent misses read the database once. */
	private readonly loading = new Map<string, Promise<unknown>>()
	/** Bumped by every clear, so a load that raced a write is not kept. */
	private generation = 0

	register(contribution: ForumCacheContribution): () => void {
		const { id, rendered, listings } = contribution
		if (typeof id !== 'string' || !CONTRIBUTION_ID.test(id)) {
			throw new TypeError(`Invalid cache ID: ${id}`)
		}
		if (
			typeof rendered?.get !== 'function' ||
			typeof rendered.set !== 'function' ||
			typeof rendered.clear !== 'function' ||
			typeof listings?.get !== 'function' ||
			typeof listings.set !== 'function' ||
			typeof listings.clear !== 'function'
		) {
			throw new TypeError(`Cache "${id}" must provide rendered.{get,set,clear} and listings`)
		}
		if (this.installed) {
			throw new Error(`Cache "${this.installed.id}" is already installed; "${id}" cannot be added`)
		}
		this.installed = contribution
		return () => {
			if (this.installed === contribution) this.installed = undefined
		}
	}

	id(): string | null {
		return this.installed?.id ?? null
	}

	/** A rendered body from the cache, or `render()`'s answer, kept unless it `failed`. */
	rendered(
		key: string,
		render: () => Readonly<{ body: RenderedBody; failed: boolean }>,
		onFailure: (error: unknown, cacheId: string) => void,
	): RenderedBody {
		const cache = this.installed
		if (cache) {
			try {
				const hit = cache.rendered.get(key)
				if (hit !== undefined) return hit
			} catch (error) {
				onFailure(error, cache.id)
			}
		}
		const { body, failed } = render()
		if (cache && !failed) {
			try {
				cache.rendered.set(key, body)
			} catch (error) {
				onFailure(error, cache.id)
			}
		}
		return body
	}

	/** Drops every rendered body, after the renderer changed. */
	clearRendered(onFailure: (error: unknown, cacheId: string) => void): void {
		const cache = this.installed
		if (!cache) return
		try {
			cache.rendered.clear()
		} catch (error) {
			onFailure(error, cache.id)
		}
	}

	/**
	 * A listing from the cache, or `load()`'s answer, which is then kept. The cache side is
	 * bounded by `EXTENSION_TIMEOUT_MS` and fails open; `load()` itself is never timed or retried,
	 * and its errors reach the caller unchanged. A `null` answer is not kept. `parse` checks what the cache returns, since a
	 * shared store may hold values written by another version.
	 */
	async listing<V>(
		key: string,
		load: () => Promise<V>,
		parse: (value: unknown) => value is V,
		onFailure: (error: unknown, cacheId: string) => void,
	): Promise<V> {
		const cache = this.installed
		if (!cache) return load()
		try {
			const hit = await bounded(Promise.resolve().then(() => cache.listings.get(key)))
			if (hit !== undefined && parse(hit)) return hit
		} catch (error) {
			onFailure(error, cache.id)
		}
		const pending = this.loading.get(key)
		if (pending) {
			const shared = await pending
			if (parse(shared)) return shared
		}
		const generation = this.generation
		const loaded = load()
		this.loading.set(key, loaded)
		try {
			const value = await loaded
			// A missing thing (`null`) is not kept: anyone could ask for any number of them.
			if (value !== null && this.installed === cache && this.generation === generation) {
				void bounded(Promise.resolve().then(() => cache.listings.set(key, value))).catch(
					(error: unknown) => onFailure(error, cache.id),
				)
			}
			return value
		} finally {
			if (this.loading.get(key) === loaded) this.loading.delete(key)
		}
	}

	/** Drops every listing; waits at most `EXTENSION_TIMEOUT_MS`. */
	async clearListings(onFailure: (error: unknown, cacheId: string) => void): Promise<void> {
		this.generation += 1
		this.loading.clear()
		const cache = this.installed
		if (!cache) return
		try {
			await bounded(Promise.resolve().then(() => cache.listings.clear()))
		} catch (error) {
			onFailure(error, cache.id)
		}
	}
}

/** A cache operation's answer, or a rejection once `EXTENSION_TIMEOUT_MS` passed. */
async function bounded<T>(work: Promise<T>): Promise<T> {
	const outcome = await withTimeout(work, EXTENSION_TIMEOUT_MS)
	if (outcome === TIMED_OUT) throw new Error(`No answer within ${EXTENSION_TIMEOUT_MS} ms`)
	return outcome
}
