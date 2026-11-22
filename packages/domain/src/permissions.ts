/** Built-in roles, weakest first. `guest` is implicit for every unauthenticated request. */
export const ROLES = ['guest', 'member', 'moderator', 'admin'] as const
export type Role = (typeof ROLES)[number]

/** Roles that are granted explicitly. `guest` and `member` follow from having an account or not. */
export const ASSIGNABLE_ROLES = ['moderator', 'admin'] as const
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number]

export function isAssignableRole(value: unknown): value is AssignableRole {
	return ASSIGNABLE_ROLES.some((role) => role === value)
}

/** A role's place in `ROLES`: the higher, the more it may do. */
export function roleRank(role: Role): number {
	return ROLES.indexOf(role)
}

/** The strongest role a principal holds (`guest` for none). */
export function rankOf(roles: readonly Role[]): number {
	return Math.max(0, ...roles.map(roleRank))
}

/** Roles a category may ask for to post or reply: an account is always needed. */
export const POSTING_ROLES = ['member', 'moderator', 'admin'] as const
export type PostingRole = (typeof POSTING_ROLES)[number]

/**
 * Who may do what in a category: see it (and its threads), start threads in it, reply in it.
 * Each is the weakest role that may; a stronger one may too. Posting never asks for less than
 * seeing.
 */
export type CategoryAccess = Readonly<{ view: Role; post: PostingRole; reply: PostingRole }>

/** Every category starts open: anyone sees it, every member writes in it. */
export const OPEN_ACCESS: CategoryAccess = Object.freeze({
	view: 'guest',
	post: 'member',
	reply: 'member',
})

export function isRole(value: unknown): value is Role {
	return ROLES.some((role) => role === value)
}

export function isPostingRole(value: unknown): value is PostingRole {
	return POSTING_ROLES.some((role) => role === value)
}

/** Raises posting to the role needed to see the category, so the three never contradict. */
export function normalizeAccess(access: CategoryAccess): CategoryAccess {
	const view = access.view
	const floor = (role: PostingRole): PostingRole =>
		roleRank(role) >= roleRank(view) || !isPostingRole(view) ? role : view
	return { view: access.view, post: floor(access.post), reply: floor(access.reply) }
}

/** Whether these roles meet one of a category's thresholds. */
export function meetsAccess(
	roles: readonly Role[],
	access: CategoryAccess,
	what: keyof CategoryAccess,
): boolean {
	return rankOf(roles) >= roleRank(access[what])
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
	// Reacting to a post (a like). The feature itself lives in an extension plugin.
	'post.react',
	// Editing a user's profile (display name, avatar).
	'user.edit',
] as const
export type ForumAction = (typeof FORUM_ACTIONS)[number]

/** Facts about the target that policies may need; every field is optional by action. */
export type ForumResource = Readonly<{
	categoryId?: string
	/**
	 * Who may see and write in the category. The core fills it in from `categoryId`; without
	 * either the category is taken as open.
	 */
	access?: CategoryAccess
	threadId?: string
	postId?: string
	/** Target user for profile operations. */
	userId?: string | null
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
	const access = resource.access ?? OPEN_ACCESS
	const meets = (what: keyof CategoryAccess) => meetsAccess(principal.roles, access, what)

	// Managing categories is about all of them; everything else happens inside one, and nothing
	// happens in a category its threshold hides from the principal.
	if (action === 'category.manage') return hasRole(principal, 'admin') ? 'allow' : 'abstain'
	if (action !== 'user.edit' && !meets('view')) return 'abstain'

	switch (action) {
		case 'category.view':
		case 'thread.view':
			return 'allow'
		case 'thread.moderate':
			return staff ? 'allow' : 'abstain'
		case 'thread.create':
			return member && meets('post') ? 'allow' : 'abstain'
		case 'post.react':
			return member ? 'allow' : 'abstain'
		case 'post.create':
			if (!member || !meets('reply')) return 'abstain'
			if (staff) return 'allow'
			return resource.locked ? 'deny' : 'allow'
		case 'thread.edit':
		case 'post.edit':
		case 'thread.delete':
		case 'post.delete':
			if (staff) return 'allow'
			if (!member || !isAuthor) return 'abstain'
			return resource.locked ? 'deny' : 'allow'
		case 'user.edit':
			if (hasRole(principal, 'admin')) return 'allow'
			return member && principal.userId !== null && resource.userId === principal.userId
				? 'allow'
				: 'abstain'
		// An action this policy does not know stays closed until some policy opens it.
		default:
			return 'abstain'
	}
}
