import { pluginDefinitionAddressOf, pluginNodeAddressOf } from '@pluxel/core'
import { hostStatePatch, requirePluginHostCoordinator } from '@pluxel/host/internal'
import { defineDevConsole } from '@pluxel/host-vite/console'
import { Redis } from '@pluxel/plugin-redis'
import { S3 } from '@pluxel/plugin-storage'
import { ForumStoragePlugin } from '@pluxum/attachments'
import { ForumRedisPlugin } from '@pluxum/redis'

// vp exec pluxel dev run host/web/dev/providers.ts → route `Redis` and `S3` to forum providers
export default defineDevConsole(async (dev) => {
	const coordinator = requirePluginHostCoordinator(dev.ctx)
	const redisReport = await coordinator.updateRuntimeState(
		hostStatePatch({
			type: 'set-provider-default',
			token: pluginDefinitionAddressOf(Redis),
			provider: pluginNodeAddressOf(ForumRedisPlugin),
		}),
		'provider-default',
	)
	const s3Report = await coordinator.updateRuntimeState(
		hostStatePatch({
			type: 'set-provider-default',
			token: pluginDefinitionAddressOf(S3),
			provider: pluginNodeAddressOf(ForumStoragePlugin),
		}),
		'provider-default',
	)
	return { redis: redisReport.reconciliation, s3: s3Report.reconciliation }
})
