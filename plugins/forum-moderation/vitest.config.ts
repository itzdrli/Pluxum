import { definePluxelVitestConfig } from '@pluxel/test/vitest'

export default definePluxelVitestConfig({
	test: {
		passWithNoTests: false,
		// Each test boots a real Pluxel host; cold `vp run verify` runs many builds in parallel.
		testTimeout: 20_000,
	},
	pluxel: {
		include: ['src/**/*.ts', 'tests/**/*.ts'],
	},
})
