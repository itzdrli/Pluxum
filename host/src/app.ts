import * as nativeFs from 'node:fs'
import { defineHostApplication } from '@pluxel/host'
import { resolveHostEnv } from '@pluxel/host/environment'
import { servicesPreset } from '@pluxel/services/preset'
import { database } from '@pluxel/services/database'
import { pglite } from '@pluxel/services/database/pglite'
import { Passthrough } from '@pluxel/core/fs'
import { logtape, zenfs } from '@pluxel/core/config'

import { pluginSource } from '@pluxel/host/sources'
import { resolve } from 'node:path'
import { product } from './product'
import { appConfigRecords, appHostState, appPlugins } from './runtime-state'

export { product }

export default defineHostApplication(async (startup) => {
	const environment = resolveHostEnv(startup.env)
	const dataRoot = resolve(startup.deployment?.root ?? startup.root, environment.dataRoot)
	const { env } = startup
	const prefix = resolve(dataRoot, 'fs')
	await nativeFs.promises.mkdir(prefix, { recursive: true })
	return {
		name: 'forum',
		config: {
			logger: logtape(),
			storage: zenfs({
				mounts: { '/': { backend: Passthrough, fs: nativeFs, prefix } },
				durableMounts: ['/'],
			}),
		},
		plugins: appPlugins,
		sources: [
			pluginSource({
				kind: 'directory',
				path: resolve(dataRoot, 'managed-plugins/entries'),
				include: ['*.mjs'],
			}),
		],
		services: [
			...(await servicesPreset(startup, {
				product,
				workbench: environment.workbench ?? true,
			})),
			// Development backend; production switches to native PostgreSQL (M5).
			database({ backend: pglite({ dataDir: resolve(dataRoot, 'database') }) }),
		],
		configRecords: {
			...appConfigRecords(env),
		},
		state: {
			...appHostState(),
		},
	}
})
