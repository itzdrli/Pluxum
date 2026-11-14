/** Built-in roles, weakest first. `guest` is implicit for every unauthenticated request. */
export const ROLES = ['guest', 'member', 'moderator', 'admin'] as const
export type Role = (typeof ROLES)[number]

/** Roles that are granted explicitly. `guest` and `member` follow from having an account or not. */
export const ASSIGNABLE_ROLES = ['moderator', 'admin'] as const
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number]

export function isAssignableRole(value: unknown): value is AssignableRole {
	return ASSIGNABLE_ROLES.some((role) => role === value)
}

/** Who is acting. `userId` is null for guests. */
export type Principal = Readonly<{
	userId: string | null
	roles: readonly Role[]
}>

export const GUEST: Principal = Object.freeze({
	userId: null,
	roles: Object.freeze<Role[]>(['guest']),
})

export const FORUM_ACTIONS = [
	'category.view',
	'category.manage',
	'thread.view',
	'thread.create',
	'thread.edit',
	'thread.delete',
	'thread.moderate',
	'post.create',
	'post.edit',
	'post.delete',
] as const
export type ForumAction = (typeof FORUM_ACTIONS)[number]

/** Facts about the target that policies may need; every field is optional by action. */
export type ForumResource = Readonly<{
	categoryId?: string
	threadId?: string
	postId?: string
	/** Author of the thread or post being changed. */
	authorId?: string | null
	/** Whether the containing thread is locked. */
	locked?: boolean
}>

export type PermissionRequest = Readonly<{
	principal: Principal
	action: ForumAction
	resource: ForumResource
}>

export type PolicyDecision = 'allow' | 'deny' | 'abstain'
export type PermissionPolicy = (request: PermissionRequest) => PolicyDecision

/**
 * Any deny wins; otherwise at least one policy must allow. No opinion at all means denied, so a
 * new action is closed until a policy explicitly opens it. A policy that throws counts as a deny.
 */
export function evaluatePolicies(
	policies: Iterable<PermissionPolicy>,
	request: PermissionRequest,
): boolean {
	let allowed = false
	for (const policy of policies) {
		let decision: PolicyDecision
		try {
			decision = policy(request)
		} catch {
			return false
		}
		if (decision === 'deny') return false
		if (decision === 'allow') allowed = true
	}
	return allowed
}

function hasRole(principal: Principal, ...roles: readonly Role[]): boolean {
	return principal.roles.some((role) => roles.includes(role))
}

/** The built-in policy for guests, members, moderators and admins. */
export const defaultRolePolicy: PermissionPolicy = ({ principal, action, resource }) => {
	const staff = hasRole(principal, 'moderator', 'admin')
	const member = staff || hasRole(principal, 'member')
	const isAuthor = principal.userId !== null && resource.authorId === principal.userId

	switch (action) {
		case 'category.view':
		case 'thread.view':
			return 'allow'
		case 'category.manage':
			return hasRole(principal, 'admin') ? 'allow' : 'abstain'
		case 'thread.moderate':
			return staff ? 'allow' : 'abstain'
		case 'thread.create':
			return member ? 'allow' : 'abstain'
		case 'post.create':
			if (staff) return 'allow'
			if (resource.locked) return 'deny'
			return member ? 'allow' : 'abstain'
		case 'thread.edit':
		case 'post.edit':
		case 'thread.delete':
		case 'post.delete':
			if (staff) return 'allow'
			if (!member || !isAuthor) return 'abstain'
			return resource.locked ? 'deny' : 'allow'
		// An action this policy does not know stays closed until some policy opens it.
		default:
			return 'abstain'
	}
}
