import type { Config } from '@react-router/dev/config'

export default {
	// Server-side render every route; the forum needs SEO and first-paint content.
	ssr: true,
} satisfies Config
