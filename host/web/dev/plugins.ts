import type { Script } from '@pluxel/agent-sdk/host'
import { CachePlugin } from '@pluxel/plugin-cache'
import { RatesPlugin } from '@pluxel/plugin-rates'
import { RedisCacheBackendPlugin, RedisRatesBackendPlugin } from '@pluxel/plugin-redis'
import { ForumRedisPlugin } from '@pluxum/redis'
import { ForumApiPlugin } from '@pluxum/api'
import { ForumAttachmentsPlugin, ForumStoragePlugin } from '@pluxum/attachments'
import { ForumAccountsPlugin, ForumAuthPlugin } from '@pluxum/auth'
import { ForumCachePlugin, ForumCorePlugin, ForumMarkdownPlugin } from '@pluxum/core'
import { ForumMailPlugin } from '@pluxum/mail'
import { ForumMessagesPlugin } from '@pluxum/messages'
import { ForumModerationPlugin, ForumRatesPlugin } from '@pluxum/moderation'
import { ForumDraftsPlugin } from '@pluxum/drafts'
import { ForumFollowsPlugin } from '@pluxum/follows'
import { ForumFooterPlugin } from '@pluxum/footer'
import { ForumNotificationsPlugin } from '@pluxum/notifications'
import { ForumMentionsPlugin, ForumOutlinePlugin } from '@pluxum/posts'
import { ForumPushPlugin } from '@pluxum/push'
import { ForumReactionsPlugin } from '@pluxum/reactions'
import { ForumReadsPlugin } from '@pluxum/reads'
import { ForumSearchPlugin } from '@pluxum/search'
import { ForumSolvedPlugin } from '@pluxum/solved'

// Forum plugins that run in every dev session by default.
const forumPlugins = [
	ForumRedisPlugin,
	RedisCacheBackendPlugin,
	CachePlugin,
	RedisRatesBackendPlugin,
	RatesPlugin,
	ForumStoragePlugin,
	ForumCorePlugin,
	ForumAuthPlugin,
	ForumAccountsPlugin,
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
	ForumCachePlugin,
	ForumRatesPlugin,
	ForumMailPlugin,
	ForumMentionsPlugin,
	ForumFollowsPlugin,
	ForumSolvedPlugin,
	ForumDraftsPlugin,
	ForumPushPlugin,
	ForumMessagesPlugin,
] as const

// vp exec pluxel dev run host/web/dev/plugins.ts                    → list plugin states
// vp exec pluxel dev run host/web/dev/plugins.ts --export start     → start forum plugins now
// Cold-boot auto start and provider routing are declared in host/src/app.ts & runtime-state.ts.
export default (async (sdk) => {
	const page = await sdk.plugins.list({ limit: 100 })
	return page.nodes.map((node) => ({
		plugin: node.address.definition.exportName,
		lifecycle: node.lifecycleState,
		autoStart: node.autoStart,
		issues: node.issues,
	}))
}) satisfies Script

export const start = (async (sdk) =>
	Promise.all(
		forumPlugins.map((PluginClass) => sdk.plugin(PluginClass.nodeAddress()).start()),
	)) satisfies Script
