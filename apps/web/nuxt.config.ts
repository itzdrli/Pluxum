// Forum frontend: Nuxt SSR on its own Nitro process. The browser only talks to this origin;
// /api/forum/** is forwarded to the Pluxel host (see server/routes/api/forum/[...path].ts).
const publicOrigin = process.env.FORUM_WEB_PUBLIC_ORIGIN

export default defineNuxtConfig({
	compatibilityDate: '2026-10-01',
	devtools: { enabled: false },
	css: ['~/assets/css/main.css'],
	devServer: {
		host: '127.0.0.1',
		// Pitchfork assigns PORT; 3000 is the documented default (tailscale serve :8082 points here).
		port: Number(process.env.PORT ?? 3000),
	},
	vite: {
		server: {
			// A tailscale-served public origin must pass Vite's Host check.
			allowedHosts: publicOrigin ? [new URL(publicOrigin).hostname] : undefined,
		},
	},
	runtimeConfig: {
		// Server-only: where Nitro reaches the Pluxel host. Override with NUXT_FORUM_API_INTERNAL.
		forumApiInternal: 'http://127.0.0.1:5173',
	},
	app: {
		head: {
			htmlAttrs: { lang: 'zh-CN' },
			title: 'Pluxel Forum',
			meta: [{ name: 'color-scheme', content: 'dark' }],
		},
	},
})
