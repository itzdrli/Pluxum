// The web app manifest (`/manifest.webmanifest`): installs the forum as an app under its own
// name, and on iPhones it is what lets push notices reach an installed forum.
import type { LoaderFunctionArgs } from 'react-router'

import { forumApi } from '../lib/forum-api.server'
import { siteOf } from '../lib/site'

const BACKGROUND = '#2e3440'

export async function loader({ request }: LoaderFunctionArgs) {
	// The site's name and icon are the same for everyone: read them as a guest.
	const meta = await forumApi.meta(new Request(request.url, { signal: request.signal }))
	const site = siteOf({ meta: meta.ok ? meta.value : null })
	const icons = [
		...(site.brand.icon === null ? [] : [{ src: site.brand.icon, sizes: 'any', purpose: 'any' }]),
		{ src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
		{ src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
		{ src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
	]
	return Response.json(
		{
			id: '/',
			name: site.name,
			short_name: site.name,
			description: site.description,
			start_url: '/',
			scope: '/',
			display: 'standalone',
			background_color: BACKGROUND,
			theme_color: BACKGROUND,
			icons,
		},
		{
			headers: {
				'content-type': 'application/manifest+json',
				'cache-control': 'public, max-age=3600',
			},
		},
	)
}
