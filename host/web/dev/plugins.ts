import { pluginNodeAddressOf } from '@pluxel/core'
import { defineDevConsole } from '@pluxel/host-vite/console'
import { Commands } from '@pluxel/services/commands'
import { ForumRedisPlugin } from '@pluxum/redis'
import { ForumApiPlugin } from '@pluxum/api'
import { ForumAttachmentsPlugin, ForumStoragePlugin } from '@pluxum/attachments'
import { ForumAuthPlugin } from '@pluxum/auth'
import { ForumCorePlugin } from '@pluxum/core'
import { ForumMarkdownPlugin } from '@pluxum/markdown'
import { ForumModerationPlugin } from '@pluxum/moderation'
import { ForumFooterPlugin } from '@pluxum/footer'
import { ForumNotificationsPlugin } from '@pluxum/notifications'
import { ForumReactionsPlugin } from '@pluxum/reactions'
import { ForumSearchPlugin } from '@pluxum/search'

// Forum plugins that run in every dev session by default.
const forumPlugins = [
	ForumRedisPlugin,
	ForumStoragePlugin,
	ForumCorePlugin,
	ForumAuthPlugin,
	ForumApiPlugin,
	ForumMarkdownPlugin,
	ForumReactionsPlugin,
	ForumAttachmentsPlugin,
	ForumNotificationsPlugin,
	ForumSearchPlugin,
	ForumModerationPlugin,
	ForumFooterPlugin,
] as const

// vp exec pluxel dev run host/web/dev/plugins.ts                    → list plugin states
// vp exec pluxel dev run host/web/dev/plugins.ts --export start     → start forum plugins now
// vp exec pluxel dev run host/web/dev/plugins.ts --export autostart → persist cold-boot auto start
//   (needed when the saved runtime state predates a plugin; state.initial only seeds a fresh store)
export default defineDevConsole(async (dev) =>
	(await dev.plugins.list()).map((plugin) => ({
		plugin: plugin.rootExportName,
		lifecycle: plugin.lifecycleState,
		autoStart: plugin.autoStart,
		issues: plugin.issues,
	})),
)

export const start = defineDevConsole(async (dev) =>
	Promise.all(forumPlugins.map((plugin) => dev.plugins.start(plugin))),
)

export const autostart = defineDevConsole(async (dev) => {
	const commands = dev.ctx.require(Commands)
	return Promise.all(
		forumPlugins.map(async (plugin) => {
			const result = await commands.execute('plugin.auto-start.set', {
				address: pluginNodeAddressOf(plugin),
				autoStart: true,
			})
			return { plugin: plugin.name, ok: result.isOk() }
		}),
	)
})

// vp exec pluxel dev run host/web/dev/plugins.ts --export prune → clear auto start on nodes that
// are no longer in the catalog (left over in saved runtime state after renames/removals)
export const prune = defineDevConsole(async (dev) => {
	const commands = dev.ctx.require(Commands)
	const stale = (await dev.plugins.list()).filter(
		(plugin) => plugin.autoStart && plugin.availability !== 'available',
	)
	return Promise.all(
		stale.map(async (plugin) => {
			const result = await commands.execute('plugin.auto-start.set', {
				address: plugin.address,
				autoStart: false,
			})
			return { address: plugin.address, ok: result.isOk() }
		}),
	)
})
