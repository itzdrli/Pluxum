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
					'@forum/forum-api#check-tests',
					'@forum/forum-redis#check-tests',
					'@forum/audit-plugin#check-tests',
					'@forum/http-plugin#check-tests',
					'@forum/todo-plugin#check-tests',
					'@forum/web#typecheck',
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
