import type { PermissionPolicy } from '@forum/domain'

/** A permission policy contributed by a plugin, identified by a stable ID. */
export type PermissionPolicyContribution = Readonly<{
	/** Stable contribution ID, e.g. `forum-moderation.bans`. */
	id: string
	evaluate: PermissionPolicy
}>

const CONTRIBUTION_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/

/**
 * Open registry of permission policies. Registration is scoped to the contributor's generation:
 * the returned disposer withdraws exactly that registration and is safe to call more than once.
 */
export class PolicyRegistry {
	private readonly entries = new Map<string, PermissionPolicy>()

	register(contribution: PermissionPolicyContribution): () => void {
		const { id, evaluate } = contribution
		if (typeof id !== 'string' || !CONTRIBUTION_ID.test(id)) {
			throw new TypeError(`Invalid permission policy ID: ${id}`)
		}
		if (typeof evaluate !== 'function') {
			throw new TypeError(`Permission policy "${id}" must provide an evaluate function`)
		}
		if (this.entries.has(id)) {
			throw new Error(`Permission policy "${id}" is already registered`)
		}
		this.entries.set(id, evaluate)
		return () => {
			// A later registration under the same ID belongs to someone else; leave it alone.
			if (this.entries.get(id) === evaluate) this.entries.delete(id)
		}
	}

	ids(): string[] {
		return [...this.entries.keys()]
	}

	policies(): PermissionPolicy[] {
		return [...this.entries.values()]
	}
}
