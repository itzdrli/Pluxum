import { ForumCorePlugin } from '@pluxum/core'
import type { Script } from '@pluxel/agent-sdk/host'

// vp exec pluxel dev run host/web/dev/roles.ts --input '{"userId":"<id>"}'
//   → show the account and its roles
// vp exec pluxel dev run host/web/dev/roles.ts --export grant --input '{"userId":"<id>","role":"admin"}'
//   → grant a role (admin | moderator); takes effect on the user's next request
// `userId` is the forum's own ID (`viewer.user.id` in /api/forum/meta), not the provider's.
function field(input: unknown, name: string): string {
	const value: unknown =
		typeof input === 'object' && input !== null ? Reflect.get(input, name) : undefined
	if (typeof value !== 'string' || value === '') throw new Error(`--input needs a "${name}" string`)
	return value
}

export default (async (sdk, run) => {
	const { instance: core } = await sdk.plugin(ForumCorePlugin.nodeAddress()).instance()
	const user = await core.getUser(field(run.input, 'userId'))
	if (user.isErr()) throw new Error(user.error.message)
	return { user: user.value, roles: (await core.principalOf(user.value.id)).roles }
}) satisfies Script

export const grant = (async (sdk, run) => {
	const { instance: core } = await sdk.plugin(ForumCorePlugin.nodeAddress()).instance()
	const userId = field(run.input, 'userId')
	const role = field(run.input, 'role')
	if (role !== 'admin' && role !== 'moderator') throw new Error('role must be admin or moderator')
	const granted = await core.grantRole(userId, role)
	if (granted.isErr()) throw new Error(granted.error.message)
	return {
		user: (await core.getUser(userId)).unwrapOr(null),
		roles: (await core.principalOf(userId)).roles,
	}
}) satisfies Script
