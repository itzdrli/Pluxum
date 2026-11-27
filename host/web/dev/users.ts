import { ForumAuthPlugin } from '@pluxum/auth'
import { ForumCorePlugin } from '@pluxum/core'
import type { Script } from '@pluxel/agent-sdk/host'

// vp exec pluxel dev run host/web/dev/users.ts --input '{"query":"test-"}'
//   → accounts whose handle or name matches, with what they posted
// vp exec pluxel dev run host/web/dev/users.ts --export remove --input '{"user":"<handle or id>"}'
//   → delete an account the way its owner would: content to Ghost, sessions ended
function field(input: unknown, name: string): string {
	const value: unknown =
		typeof input === 'object' && input !== null ? Reflect.get(input, name) : undefined
	if (typeof value !== 'string' || value === '') throw new Error(`--input needs a "${name}" string`)
	return value
}

export default (async (sdk, run) => {
	const { instance: core } = await sdk.plugin(ForumCorePlugin.nodeAddress()).instance()
	const guest = await core.principalOf(null)
	const list = await core.listUsers({ query: field(run.input, 'query'), pageSize: 50 })
	return Promise.all(
		list.items.map(async (user) => {
			const profile = (await core.getUserProfile(guest, user.id)).unwrapOr(null)
			return {
				id: user.id,
				handle: user.handle,
				displayName: user.displayName,
				roles: user.roles,
				threads: profile?.threadCount,
				notes: profile?.noteCount,
				posts: profile?.postCount,
			}
		}),
	)
}) satisfies Script

export const remove = (async (sdk, run) => {
	const { instance: core } = await sdk.plugin(ForumCorePlugin.nodeAddress()).instance()
	const { instance: auth } = await sdk.plugin(ForumAuthPlugin.nodeAddress()).instance()
	const user = await core.getUser(field(run.input, 'user'))
	if (user.isErr()) throw new Error(user.error.message)
	const removed = await core.removeUser(user.value.id)
	if (removed.isErr()) throw new Error(removed.error.message)
	const sessions = await auth.revokeUserSessions(user.value.id)
	const ghost = (await core.getUserProfile(await core.principalOf(null), 'ghost')).unwrapOr(null)
	return {
		removed: user.value,
		sessionsEnded: sessions,
		ghost:
			ghost === null
				? null
				: {
						id: ghost.user.id,
						handle: ghost.user.handle,
						threads: ghost.threadCount,
						notes: ghost.noteCount,
						posts: ghost.postCount,
					},
	}
}) satisfies Script
