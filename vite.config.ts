import { defineConfig } from 'vite-plus'
import lint from './oxlint.config'
import fmt from './oxfmt.config'

export default defineConfig({
	fmt,
	lint: { ...lint, options: { typeAware: true, typeCheck: true } },
	run: {
		cache: { scripts: false, tasks: true },
		tasks: {
			'governance:check': {
				command: 'pluxel workspace doctor && node scripts/check-workspace-governance.mjs',
				cache: false,
			},
			'verify:checks': { command: 'vp check', cache: false },
			'workspace:build': { command: [], dependsOn: ['@pluxum/host#compile', '@pluxum/web#build'] },
			'workspace:test': {
				command: [],
				dependsOn: [
					'@pluxum/domain#check-tests',
					'@pluxum/core#check-tests',
					'@pluxum/markdown#check-tests',
					'@pluxum/auth#check-tests',
					'@pluxum/api#check-tests',
					'@pluxum/redis#check-tests',
					'@pluxum/reactions#check-tests',
					'@pluxum/follows#check-tests',
					'@pluxum/solved#check-tests',
					'@pluxum/notifications#check-tests',
					'@pluxum/search#check-tests',
					'@pluxum/moderation#check-tests',
					'@pluxum/footer#check-tests',
					'@pluxum/web#typecheck',
					'@pluxum/web#test',
				],
			},
			'workspace:verify': {
				command: [],
				cache: false,
				dependsOn: ['governance:check', 'verify:checks', 'workspace:test', 'workspace:build'],
			},
		},
	},
})
