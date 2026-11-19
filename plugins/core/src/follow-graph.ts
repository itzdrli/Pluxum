import { EXTENSION_TIMEOUT_MS, TIMED_OUT, withTimeout } from './extensions'
import { CONTRIBUTION_ID } from './policies'

/** Who and what one person follows, as stable IDs. */
export type Followed = Readonly<{
	userIds: readonly string[]
	categoryIds: readonly string[]
}>

/**
 * The follow graph, contributed by a follow plugin (forum-follows) that keeps the follows in its
 * own tables. The core asks it whom a reader follows to build the 「关注」 feed; without one that
 * feed does not exist.
 */
export type FollowGraphContribution = Readonly<{
	/** Stable contribution ID, e.g. `forum-follows.graph`. */
	id: string
	/** The people and categories `userId` follows. */
	following: (userId: string) => Promise<Followed>
}>

/**
 * The core's follow graph slot. It holds at most one graph: registration is scoped to the
 * contributor's generation, and the returned disposer withdraws exactly that registration.
 */
export class FollowGraphRegistry {
	private installed: FollowGraphContribution | undefined

	register(contribution: FollowGraphContribution): () => void {
		const { id, following } = contribution
		if (typeof id !== 'string' || !CONTRIBUTION_ID.test(id)) {
			throw new TypeError(`Invalid follow graph ID: ${id}`)
		}
		if (typeof following !== 'function') {
			throw new TypeError(`Follow graph "${id}" must provide a following function`)
		}
		if (this.installed) {
			throw new Error(
				`Follow graph "${this.installed.id}" is already installed; "${id}" cannot be added`,
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

	/**
	 * Whom `userId` follows, or null without a graph or when it fails or takes longer than
	 * `EXTENSION_TIMEOUT_MS` (reported through `onFailure`).
	 */
	async following(
		userId: string,
		onFailure: (error: unknown, graphId: string) => void,
	): Promise<Followed | null> {
		const graph = this.installed
		if (!graph) return null
		try {
			const outcome = await withTimeout(
				Promise.resolve().then(() => graph.following(userId)),
				EXTENSION_TIMEOUT_MS,
			)
			if (outcome === TIMED_OUT) throw new Error(`No answer within ${EXTENSION_TIMEOUT_MS} ms`)
			if (
				!Array.isArray(outcome?.userIds) ||
				!Array.isArray(outcome.categoryIds) ||
				!outcome.userIds.every((id) => typeof id === 'string') ||
				!outcome.categoryIds.every((id) => typeof id === 'string')
			) {
				throw new TypeError('The follow graph answered something other than ID lists')
			}
			return outcome
		} catch (error) {
			onFailure(error, graph.id)
			return null
		}
	}
}
