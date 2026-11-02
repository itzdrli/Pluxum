// Forum frontend: React Router (framework mode, SSR) on its own Node process. The browser only
// talks to this origin; /api/forum/** is forwarded to the Pluxel host (app/routes/api-forum.ts).
import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite-plus'

const publicOrigin = process.env.FORUM_WEB_PUBLIC_ORIGIN

export default defineConfig({
	plugins: [tailwindcss(), reactRouter()],
	server: {
		host: '127.0.0.1',
		// Pitchfork assigns PORT; 3000 is the documented default (tailscale serve :8082 points here).
		port: Number(process.env.PORT ?? 3000),
		strictPort: true,
		// A tailscale-served public origin must pass Vite's Host check.
		allowedHosts: publicOrigin ? [new URL(publicOrigin).hostname] : undefined,
	},
})
