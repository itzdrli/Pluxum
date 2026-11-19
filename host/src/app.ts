import * as nativeFs from 'node:fs'
import { defineHostApplication } from '@pluxel/host'
import { resolveHostEnv } from '@pluxel/host/environment'
import { servicesPreset } from '@pluxel/services/preset'
import { listenElysia } from '@pluxel/services/elysia/node'
import { database } from '@pluxel/services/database'
import { pglite } from '@pluxel/services/database/pglite'
import { postgres } from '@pluxel/services/database/postgres'
import { Passthrough } from '@pluxel/core/fs'
import { logtape, zenfs } from '@pluxel/core/config'

import { resolve } from 'node:path'
import { listenAdminRelay } from './admin-relay'
import { product } from './product'
import { appConfig, appHostPolicy, appPlugins } from './runtime-state'

export { product }

export default defineHostApplication(async (startup) => {
	const environment = resolveHostEnv(startup.env)
	const dataRoot = resolve(startup.deployment?.root ?? startup.root, environment.dataRoot)
	const { env } = startup
	const prefix = resolve(dataRoot, 'fs')
	await nativeFs.promises.mkdir(prefix, { recursive: true })
	return {
		name: 'forum',
		plugins: appPlugins,
		services: [
			...(await servicesPreset(startup, {
				product,
				workbench: environment.workbench ?? true,
			})),
			// DATABASE_URL selects native PostgreSQL (the deployment images); without it the forum
			// keeps an embedded PGlite database under the data root (local development).
			database({
				backend: env.DATABASE_URL
					? postgres({ connectionString: env.DATABASE_URL })
					: pglite({ dataDir: resolve(dataRoot, 'database') }),
			}),
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
		config: appConfig(env),
		policy: appHostPolicy(),
		runtime: {
			logtape: logtape(),
			zenfs: zenfs({
				mounts: { '/': { backend: Passthrough, fs: nativeFs, prefix } },
				durableMounts: ['/'],
			}),
		},
	}
})
