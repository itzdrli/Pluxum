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
			'workspace:build': { command: [], dependsOn: ['@forum/host#compile', '@forum/web#build'] },
			'workspace:test': {
				command: [],
				dependsOn: [
					'@forum/domain#check-tests',
					'@forum/forum-core#check-tests',
					'@forum/forum-markdown#check-tests',
					'@forum/forum-auth#check-tests',
					'@forum/forum-api#check-tests',
					'@forum/forum-redis#check-tests',
					'@forum/forum-reactions#check-tests',
					'@forum/web#typecheck',
					'@forum/web#test',
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
