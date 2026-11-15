import { defineConfig } from 'vitest/config'

// Plain Vitest for the frontend's own logic. Only the Markdown round trip needs a DOM (the editor
// is built on ProseMirror), which happy-dom provides without a browser.
export default defineConfig({
	test: {
		environment: 'happy-dom',
		include: ['tests/**/*.test.ts'],
		passWithNoTests: false,
	},
})
