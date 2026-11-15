import { data } from 'react-router'

import type { Route } from './+types/theme'
import { isThemeId, themeCookie } from '../lib/theme'

// Remembers the visitor's theme. The theme picker posts here through a fetcher; the shell shows
// the new theme at once and the root loader reads the cookie from then on.
export async function action({ request }: Route.ActionArgs) {
	const theme = (await request.formData()).get('theme')
	if (!isThemeId(theme)) return data({ theme: null }, { status: 400 })
	return data({ theme }, { headers: { 'set-cookie': themeCookie(theme) } })
}
