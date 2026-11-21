import { ForumAuthPlugin } from '@pluxum/auth'
import { ForumCorePlugin } from '@pluxum/core'
import { defineDevConsole } from '@pluxel/host-vite/console'

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

export default defineDevConsole(async (dev) => {
	const core = dev.plugins.require(ForumCorePlugin)
	const guest = await core.principalOf(null)
	const list = await core.listUsers({ query: field(dev.input, 'query'), pageSize: 50 })
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
})

export const remove = defineDevConsole(async (dev) => {
	const core = dev.plugins.require(ForumCorePlugin)
	const auth = dev.plugins.require(ForumAuthPlugin)
	const user = await core.getUser(field(dev.input, 'user'))
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
})
