import { defineConfig } from 'vite-plus'
import { buildTask, checkCache } from '../../scripts/vite-tasks'

export default defineConfig({
	run: {
		tasks: {
			compile: buildTask('pluxel build'),
			'check-tests': {
				command: 'vp test run',
				dependsOn: ['compile'],
				// The live Redis test runs only when the dev valkey URL is provided (see mise.toml).
				cache: { ...checkCache, env: [...checkCache.env, 'FORUM_TEST_REDIS_URL'] },
			},
			'check-types': { command: 'tsc --noEmit --pretty false', cache: checkCache },
		},
	},
})
