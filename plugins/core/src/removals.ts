import { CONTRIBUTION_ID } from './policies'

/** Subject of the Ghost account: no login method issues it, so nobody signs in as Ghost. */
export const GHOST_SUBJECT = 'forum:ghost'
/** Ghost's handle when it is free (`/u/ghost`); new accounts cannot take it. */
export const GHOST_HANDLE = 'ghost'
export const GHOST_DISPLAY_NAME = 'Ghost'

/** What a plugin is told when an account is removed. */
export type UserRemoval = Readonly<{
	/** The account going away; its Pluxum Core row is deleted right after every handler ran. */
	userId: string
	/** The Ghost account, which takes over what the removed account authored. */
	ghostId: string
}>

/**
 * A plugin's part in removing an account, contributed by a plugin that keeps rows about users:
 * hand what the account authored to Ghost (`ghostId`) and delete what was only theirs (follows,
 * read marks, preferences). Pluxum Core does the same for its own tables afterwards.
 */
export type UserRemovalContribution = Readonly<{
	/** Stable contribution ID, e.g. `forum-reactions.removal`. */
	id: string
	remove: (removal: UserRemoval) => void | Promise<void>
}>

/** Open registry of user removal handlers, scoped like the other registries to a generation. */
export class UserRemovalRegistry {
	private readonly entries = new Map<string, UserRemovalContribution>()

	register(contribution: UserRemovalContribution): () => void {
		const { id, remove } = contribution
		if (typeof id !== 'string' || !CONTRIBUTION_ID.test(id)) {
			throw new TypeError(`Invalid user removal ID: ${id}`)
		}
		if (typeof remove !== 'function') {
			throw new TypeError(`User removal "${id}" must provide a remove function`)
		}
		if (this.entries.has(id)) throw new Error(`User removal "${id}" is already registered`)
		this.entries.set(id, contribution)
		return () => {
			if (this.entries.get(id) === contribution) this.entries.delete(id)
		}
	}

	ids(): string[] {
		return [...this.entries.keys()]
	}

	/** Runs every handler one after another; a failing one is reported and the rest still run. */
	async run(
		removal: UserRemoval,
		onFailure: (error: unknown, contributionId: string) => void,
	): Promise<void> {
		for (const entry of this.entries.values()) {
			try {
				// oxlint-disable-next-line no-await-in-loop -- handlers run one at a time on purpose.
				await entry.remove(removal)
			} catch (error) {
				onFailure(error, entry.id)
			}
		}
	}
}
