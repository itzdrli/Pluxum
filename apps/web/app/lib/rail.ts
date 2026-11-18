// The category column (rail) on wide screens: the visitor can fold it down to its icons. The
// choice is kept in a cookie, like the theme, so a server-rendered page comes out at the right
// width with no jump after hydration.

/** `full`: icons and labels. `mini`: icons only, at every wide width. */
export type RailPreference = 'full' | 'mini'

/**
 * How the rail lays out right now:
 *   full  icons and labels
 *   mini  icons only (the visitor folded it)
 *   auto  icons only on laptops (lg up to xl), labels beyond: a detail is open beside a list
 */
export type RailMode = 'full' | 'mini' | 'auto'

export const RAIL_COOKIE = 'forum_rail'

export function railFromRequest(request: Request): RailPreference {
	for (const part of (request.headers.get('cookie') ?? '').split(';')) {
		const separator = part.indexOf('=')
		if (separator > 0 && part.slice(0, separator).trim() === RAIL_COOKIE) {
			return part.slice(separator + 1).trim() === 'mini' ? 'mini' : 'full'
		}
	}
	return 'full'
}

export function railCookie(preference: RailPreference): string {
	return `${RAIL_COOKIE}=${preference}; Path=/; Max-Age=31536000; SameSite=Lax`
}

/** The rail's layout for the visitor's choice and the stage's depth. */
export function railMode(preference: RailPreference, depth: number): RailMode {
	if (preference === 'mini') return 'mini'
	return depth === 2 ? 'auto' : 'full'
}

/** The rail's width for a mode. Every change of it animates (see the rail's `transition`). */
export function railWidthClass(mode: RailMode): string {
	if (mode === 'mini') return 'lg:w-16'
	if (mode === 'auto') return 'lg:w-16 xl:w-[260px] 2xl:w-[288px]'
	return 'lg:w-[220px] xl:w-[260px] 2xl:w-[288px]'
}
