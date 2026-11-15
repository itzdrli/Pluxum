import type { Config } from '@react-router/dev/config'

// Behind the TLS-terminating proxy, react-router-serve rebuilds request URLs as http://, so the
// browser's https:// Origin never matches and React Router rejects every action as cross-site
// (400). Allow the public origin's host explicitly; other hosts are still refused.
const publicOrigin = process.env.FORUM_WEB_PUBLIC_ORIGIN

export default {
	// Server-side render every route; the forum needs SEO and first-paint content.
	ssr: true,
	allowedActionOrigins: publicOrigin ? [new URL(publicOrigin).host] : undefined,
} satisfies Config
