import { definePluxelVitestConfig } from '@pluxel/test/vitest'

export default definePluxelVitestConfig({
	// tsconfig `paths` only redirect type-checking to built declarations.
	resolve: { tsconfigPaths: false },
	test: {
		passWithNoTests: false,
	},
	pluxel: {
		include: ['src/**/*.ts', 'tests/**/*.ts'],
	},
})
