import { lingui } from '@lingui/vite-plugin'
import babel from '@rolldown/plugin-babel'
import { defineConfig } from 'vitest/config'

// Plain Vitest for the frontend's own logic. Only the Markdown round trip needs a DOM (the editor
// is built on ProseMirror), which happy-dom provides without a browser.
export default defineConfig({
	// The same Lingui macro pipeline as vite.config.ts, for tests that import translated modules.
	plugins: [lingui(), babel({ plugins: ['@lingui/babel-plugin-lingui-macro'] })],
	test: {
		environment: 'happy-dom',
		include: ['tests/**/*.test.{ts,tsx}'],
		passWithNoTests: false,
	},
})
