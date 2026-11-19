// Forum frontend: React Router (framework mode, SSR) on its own Node process. The browser only
// talks to this origin; /api/forum/** is forwarded to the Pluxel host (app/routes/api-forum.ts).
import { lingui } from '@lingui/vite-plugin'
import { reactRouter } from '@react-router/dev/vite'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite-plus'

// Origin under which the dev server is opened. It differs from the public origin once that one is
// served by the production build (pitchfork `web-public`).
const devOrigin = process.env.FORUM_WEB_DEV_ORIGIN ?? process.env.FORUM_WEB_PUBLIC_ORIGIN

export default defineConfig({
	// Lingui's `t`/`<Trans>` macros are compiled by its Babel plugin (run through rolldown); the
	// `lingui()` plugin makes `import('./x.po')` return the compiled catalog.
	plugins: [
		tailwindcss(),
		reactRouter(),
		lingui(),
		babel({ plugins: ['@lingui/babel-plugin-lingui-macro'] }),
	],
	build: {
		// Tablets and phones often run vendor browsers on an older Chromium. A chunk with syntax the
		// engine cannot parse stops hydration, and every click becomes a full page load, so lower
		// the syntax to what module-capable browsers parse. Missing APIs: app/lib/polyfills.ts.
		target: ['es2020', 'chrome87', 'edge88', 'firefox78', 'safari14'],
	},
	server: {
		host: '127.0.0.1',
		// Pitchfork assigns PORT; 3000 is the documented default (tailscale serve :8082 points here).
		port: Number(process.env.PORT ?? 3000),
		strictPort: true,
		// A tailscale-served origin must pass Vite's Host check.
		allowedHosts: devOrigin ? [new URL(devOrigin).hostname] : undefined,
	},
})
