import { defineDevConsole } from '@pluxel/host-vite/console'
import { ForumRedisPlugin } from '@pluxum/redis'
import { ForumApiPlugin } from '@pluxum/api'
import { ForumAttachmentsPlugin, ForumStoragePlugin } from '@pluxum/attachments'
import { ForumAuthPlugin } from '@pluxum/auth'
import { ForumCorePlugin } from '@pluxum/core'
import { ForumMarkdownPlugin } from '@pluxum/markdown'
import { ForumModerationPlugin } from '@pluxum/moderation'
import { ForumFooterPlugin } from '@pluxum/footer'
import { ForumNotificationsPlugin } from '@pluxum/notifications'
import { ForumOutlinePlugin } from '@pluxum/outline'
import { ForumReactionsPlugin } from '@pluxum/reactions'
import { ForumReadsPlugin } from '@pluxum/reads'
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
	ForumReadsPlugin,
	ForumOutlinePlugin,
	ForumAttachmentsPlugin,
	ForumNotificationsPlugin,
	ForumSearchPlugin,
	ForumModerationPlugin,
	ForumFooterPlugin,
] as const

// vp exec pluxel dev run host/web/dev/plugins.ts                    → list plugin states
// vp exec pluxel dev run host/web/dev/plugins.ts --export start     → start forum plugins now
// Cold-boot auto start and provider routing are declared in host/src/runtime-state.ts.
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
