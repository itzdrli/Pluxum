import * as nativeFs from 'node:fs'
import { resolve } from 'node:path'
import { Passthrough } from '@pluxel/core/fs'
import { defineHostApplication } from '@pluxel/host'
import { resolveHostEnv } from '@pluxel/host/environment'
import { CachePlugin } from '@pluxel/plugin-cache'
import { FontsPlugin } from '@pluxel/plugin-fonts'
import { RatesPlugin } from '@pluxel/plugin-rates'
import { RedisCacheBackendPlugin, RedisRatesBackendPlugin } from '@pluxel/plugin-redis'
import { TakumiPlugin } from '@pluxel/plugin-takumi'
import { listenElysia } from '@pluxel/services/elysia/node'
import { pglite } from '@pluxel/services/pg/pglite'
import { postgres } from '@pluxel/services/pg/postgres'
import { VaultAdminPlugin } from '@pluxel/services/plugins'
import { servicesPreset } from '@pluxel/services/preset'
import { ForumApiPlugin } from '@pluxum/api'
import { ForumAttachmentsPlugin, ForumStoragePlugin } from '@pluxum/attachments'
import { ForumAccountsPlugin, ForumAuthPlugin } from '@pluxum/auth'
import { ForumCachePlugin, ForumCorePlugin, ForumMarkdownPlugin } from '@pluxum/core'
import { ForumDraftsPlugin } from '@pluxum/drafts'
import { ForumFollowsPlugin } from '@pluxum/follows'
import { ForumFooterPlugin } from '@pluxum/footer'
import { ForumMailPlugin } from '@pluxum/mail'
import { ForumMessagesPlugin } from '@pluxum/messages'
import { ForumModerationPlugin, ForumRatesPlugin } from '@pluxum/moderation'
import { ForumNotificationsPlugin } from '@pluxum/notifications'
import { ForumOgPlugin } from '@pluxum/og'
import { ForumMentionsPlugin, ForumOutlinePlugin } from '@pluxum/posts'
import { ForumPushPlugin } from '@pluxum/push'
import { ForumReactionsPlugin } from '@pluxum/reactions'
import { ForumReadsPlugin } from '@pluxum/reads'
import { ForumRedisPlugin } from '@pluxum/redis'
import { ForumSearchPlugin } from '@pluxum/search'
import { ForumSolvedPlugin } from '@pluxum/solved'

import { listenAdminRelay } from './admin-relay'
import { product } from './product'
import {
	appConfig,
	appHostPolicy,
	authConfig,
	fontsConfig,
	mailConfig,
	redisCacheBackendConfig,
	redisConfig,
	redisRatesBackendConfig,
	storageConfig,
} from './runtime-state'

export { product }

export default defineHostApplication(async (startup) => {
	const environment = resolveHostEnv(startup.env)
	const dataRoot = resolve(startup.deployment?.root ?? startup.root, environment.dataRoot)
	const { env } = startup
	const prefix = resolve(dataRoot, 'fs')
	await nativeFs.promises.mkdir(prefix, { recursive: true })
	return {
		name: 'forum',
		plugins: [
			{ plugin: ForumRedisPlugin, autoStart: true, config: redisConfig(env.REDIS_CONNECTIONS) },
			// Official cache and rate capabilities, both backed by the forum's Redis connection.
			{
				plugin: RedisCacheBackendPlugin,
				autoStart: true,
				config: redisCacheBackendConfig(env.REDIS_CONNECTIONS),
			},
			{ plugin: CachePlugin, autoStart: true },
			{
				plugin: RedisRatesBackendPlugin,
				autoStart: true,
				config: redisRatesBackendConfig(env.REDIS_CONNECTIONS),
			},
			{ plugin: RatesPlugin, autoStart: true },
			{ plugin: ForumStoragePlugin, autoStart: true, config: storageConfig(env.S3_BUCKETS) },
			{ plugin: ForumCorePlugin, autoStart: true },
			{ plugin: ForumAuthPlugin, autoStart: true, config: authConfig(env) },
			// Email and password sign-in, so a fresh forum works without an identity provider.
			{ plugin: ForumAccountsPlugin, autoStart: true },
			{ plugin: ForumApiPlugin, autoStart: true },
			{ plugin: ForumMarkdownPlugin, autoStart: true },
			{ plugin: ForumReactionsPlugin, autoStart: true },
			{ plugin: ForumReadsPlugin, autoStart: true },
			{ plugin: ForumOutlinePlugin, autoStart: true },
			{ plugin: ForumAttachmentsPlugin, autoStart: true },
			{ plugin: ForumNotificationsPlugin, autoStart: true },
			{ plugin: ForumSearchPlugin, autoStart: true },
			{ plugin: ForumModerationPlugin, autoStart: true },
			{ plugin: ForumFooterPlugin, autoStart: true },
			{ plugin: ForumCachePlugin, autoStart: true },
			{ plugin: ForumRatesPlugin, autoStart: true },
			{ plugin: ForumMailPlugin, autoStart: true, config: mailConfig(env) },
			{ plugin: ForumMentionsPlugin, autoStart: true },
			{ plugin: ForumFollowsPlugin, autoStart: true },
			{ plugin: ForumSolvedPlugin, autoStart: true },
			// Drafts kept on the server, so writing continues on another device.
			{ plugin: ForumDraftsPlugin, autoStart: true },
			// Browser push notifications; its key pair lives in its Vault.
			{ plugin: ForumPushPlugin, autoStart: true },
			// Private messages and small group chats.
			{ plugin: ForumMessagesPlugin, autoStart: true },
			// Social card images: Takumi draws them with the fonts FontsPlugin holds.
			{ plugin: FontsPlugin, autoStart: true, config: fontsConfig(env.FONT_FILES) },
			{ plugin: TakumiPlugin, autoStart: true },
			{ plugin: ForumOgPlugin, autoStart: true },
			// Workbench's Vault page (status, unlock, recovery). Standalone images need Pluxel with the
			// published-Services bundling fix, or this Plugin's Vault token does not match the host's.
			{ plugin: VaultAdminPlugin, autoStart: true },
		],
		services: [
			...(await servicesPreset(startup, {
				product,
				workbench: environment.workbench === false ? false : undefined,
			})),
			// DATABASE_URL selects native PostgreSQL (the deployment images); without it the forum
			// keeps an embedded PGlite database under the data root (local development).
			env.DATABASE_URL
				? postgres({ connectionString: env.DATABASE_URL })
				: pglite({ dataDir: resolve(dataRoot, 'database') }),
		],
		// Production only: the dev server owns its own listener.
		async launch({ host }) {
			await listenElysia(host, {
				hostname: environment.hostBind,
				port: environment.hostPort,
				publicOrigin: environment.publicOrigin,
				// A standalone build is its own deployment root; a native start runs from host/.
				publicDir: startup.deployment
					? resolve(startup.deployment.root, 'public')
					: resolve(startup.root, 'dist/public'),
			})
			const adminPort = Number(env.PLUXUM_ADMIN_PORT || 0)
			if (adminPort > 0) {
				const relay = await listenAdminRelay(adminPort, environment.hostPort ?? 3000)
				host.ctx.effects.defer(() => new Promise<void>((done) => relay.close(() => done())))
				host.ctx.logger.info(`Workbench relay listening on :${adminPort}`)
			}
			// Containers stop with SIGTERM; close plugins and connections before exiting.
			for (const signal of ['SIGINT', 'SIGTERM'] as const)
				process.once(signal, () => {
					void host.close().then(
						() => process.exit(0),
						(error: unknown) => {
							console.error(error)
							process.exit(1)
						},
					)
				})
		},
		config: appConfig(),
		policy: appHostPolicy(),
		coreConfig: {
			vault: {
				backend: 'encrypted',
				durable: true,
				deployIdentity: env.PLUXEL_VAULT_DEPLOY_IDENTITY,
			},
			logtape: {},
			zenfs: {
				mounts: { '/': { backend: Passthrough, fs: nativeFs, prefix } },
				durableMounts: ['/'],
			},
		},
	}
})
