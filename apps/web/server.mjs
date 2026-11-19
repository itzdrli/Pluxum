// Production entry for prebuilt images: `react-router-serve ./server.mjs` (cwd apps/web).
// React Router bakes `allowedActionOrigins` into the server build, but an image is built once and
// deployed under any domain, so the public origin is read here at start instead.
import { allowedActionOrigins as builtOrigins } from './build/server/index.js'

export * from './build/server/index.js'

const hosts = [process.env.FORUM_WEB_PUBLIC_ORIGIN].flatMap((origin) => {
	if (!origin) return []
	try {
		return [new URL(origin).host]
	} catch {
		throw new TypeError(`FORUM_WEB_PUBLIC_ORIGIN is not a URL: ${origin}`)
	}
})

const merged = [...new Set([...(Array.isArray(builtOrigins) ? builtOrigins : []), ...hosts])]

export const allowedActionOrigins = merged.length > 0 ? merged : undefined
