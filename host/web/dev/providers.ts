import { pluginDefinitionAddressOf, pluginNodeAddressOf } from '@pluxel/core'
import { hostStatePatch, requirePluginHostCoordinator } from '@pluxel/host/internal'
import { defineDevConsole } from '@pluxel/host-vite/console'
import { Redis } from '@pluxel/plugin-redis'
import { ForumRedisPlugin } from '@forum/forum-redis'

// vp exec pluxel dev run host/web/dev/providers.ts → make ForumRedisPlugin the provider of `Redis`
// Needed once on a data directory whose saved state still routes `Redis` to the official
// RedisPlugin, which this host no longer installs; consumers of `Redis` cannot start until then.
export default defineDevConsole(async (dev) => {
	const report = await requirePluginHostCoordinator(dev.ctx).updateRuntimeState(
		hostStatePatch({
			type: 'set-provider-default',
			token: pluginDefinitionAddressOf(Redis),
			provider: pluginNodeAddressOf(ForumRedisPlugin),
		}),
		'provider-default',
	)
	return { issues: report.reconciliation }
})
