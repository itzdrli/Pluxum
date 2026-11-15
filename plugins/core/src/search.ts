import sanitizeHtml from 'sanitize-html'
import { EXTENSION_TIMEOUT_MS, TIMED_OUT, withTimeout } from './extensions'
import { CONTRIBUTION_ID } from './policies'

/** A validated search request narrowed to the categories the viewer may see. */
export type SearchProviderQuery = Readonly<{
	query: string
	categoryIds: readonly string[]
	authorId?: string
	threadsOnly: boolean
	page: number
	pageSize: number
}>

/** One hit from a search provider's index; the core resolves `authorId` to a `UserDto`. */
export type SearchProviderHit = Readonly<{
	postId: string
	threadId: string
	categoryId: string
	authorId: string
	opening: boolean
	title: string
	/** Snippet HTML; the core strips every tag except `<mark>`. */
	snippetHtml: string
	createdAt: string
}>

export type SearchProviderResult = Readonly<{
	items: readonly SearchProviderHit[]
	total: number
}>

/** A search backend contributed by a plugin. */
export type SearchProviderContribution = Readonly<{
	/** Stable contribution ID, e.g. `forum-search.pg`. */
	id: string
	search: (query: SearchProviderQuery) => Promise<SearchProviderResult>
}>

const ALLOWED_SNIPPET: sanitizeHtml.IOptions = {
	allowedTags: ['mark'],
	allowedAttributes: {},
}

/** Strips every HTML tag except `<mark>` from a search snippet. */
export function sanitizeSearchSnippet(html: string): string {
	return sanitizeHtml(html, ALLOWED_SNIPPET)
}

/**
 * The forum's search provider slot. It holds at most one provider: registration is scoped to the
 * contributor's generation, and the returned disposer withdraws exactly that registration.
 */
export class SearchProviderRegistry {
	private installed: SearchProviderContribution | undefined

	register(contribution: SearchProviderContribution): () => void {
		const { id, search } = contribution
		if (typeof id !== 'string' || !CONTRIBUTION_ID.test(id)) {
			throw new TypeError(`Invalid search provider ID: ${id}`)
		}
		if (typeof search !== 'function') {
			throw new TypeError(`Search provider "${id}" must provide a search function`)
		}
		if (this.installed) {
			throw new Error(
				`Search provider "${this.installed.id}" is already installed; "${id}" cannot be added`,
			)
		}
		this.installed = contribution
		return () => {
			if (this.installed === contribution) this.installed = undefined
		}
	}

	id(): string | null {
		return this.installed?.id ?? null
	}

	available(): boolean {
		return this.installed !== undefined
	}

	/**
	 * Queries the installed search provider. Returns null when no provider is installed, when it
	 * is withdrawn while answering or when it fails; `onFailure` receives the error in the last
	 * case.
	 */
	async search(
		query: SearchProviderQuery,
		onFailure: (error: unknown, providerId: string) => void,
	): Promise<SearchProviderResult | null> {
		const provider = this.installed
		if (!provider) return null
		try {
			const result = await withTimeout(
				Promise.resolve().then(() => provider.search(query)),
				EXTENSION_TIMEOUT_MS,
			)
			if (result === TIMED_OUT) throw new Error(`No answer within ${EXTENSION_TIMEOUT_MS} ms`)
			if (this.installed !== provider) return null
			if (
				typeof result !== 'object' ||
				result === null ||
				!Array.isArray(result.items) ||
				!Number.isSafeInteger(result.total) ||
				result.total < 0
			) {
				throw new TypeError('The search provider returned an invalid result')
			}
			return result
		} catch (error) {
			onFailure(error, provider.id)
			return null
		}
	}
}
