import type { Config } from '@react-router/dev/config'

// React Router refuses an action whose browser `Origin` differs from the request URL it sees.
// Every way this app is opened rebuilds that URL differently: behind the TLS proxy the public
// origin arrives as http://, the dev server sits behind the tailscale origin and the pitchfork
// proxy (`PITCHFORK_URL`, e.g. http://web.pluxum.localhost:8088) and sees 127.0.0.1. Allow
// exactly those origins' hosts; every other host is still refused.
const allowedActionOrigins = [
	process.env.FORUM_WEB_PUBLIC_ORIGIN,
	process.env.FORUM_WEB_DEV_ORIGIN,
	process.env.PITCHFORK_URL,
].flatMap((origin) => {
	if (origin === undefined || origin === '') return []
	try {
		return [new URL(origin).host]
	} catch {
		return []
	}
})

export default {
	// Server-side render every route; the forum needs SEO and first-paint content.
	ssr: true,
	// `web-public` serves ./build from memory, so a check build must go elsewhere (FORUM_WEB_BUILD_DIR).
	buildDirectory: process.env.FORUM_WEB_BUILD_DIR || 'build',
	allowedActionOrigins: allowedActionOrigins.length > 0 ? allowedActionOrigins : undefined,
} satisfies Config
