import { defineConfig } from 'vite-plus/pack'
import { pluxel } from '@pluxel/rolldown'

export default defineConfig({
	entry: './src/app.ts',
	tsconfig: './tsconfig.build.json',
	plugins: [
		// One self-starting bundle (`node dist/app.mjs`) that needs no node_modules at run time.
		// The jieba tokenizer is a native addon, so it is copied beside the bundle instead.
		pluxel({ residualDependencies: { packages: ['@node-rs/jieba'] } }),
	],
	copy: [
		{
			from: './web/dist',
			to: 'dist',
			rename: 'public',
		},
	],
})
