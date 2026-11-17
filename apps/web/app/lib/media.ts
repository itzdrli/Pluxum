import { useSyncExternalStore } from 'react'

/** Below the `lg` breakpoint: phones and tablets, where the frame has no category column. */
export const NARROW_QUERY = '(max-width: 1023px)'

/**
 * Whether a media query matches, kept current as the window changes. The server and the first
 * client render answer `false`, so markup that depends on it should be something opened later
 * (a menu, a sheet), never what the page first shows.
 */
export function useMediaQuery(query: string): boolean {
	return useSyncExternalStore(
		(onChange) => {
			const list = window.matchMedia(query)
			list.addEventListener('change', onChange)
			return () => list.removeEventListener('change', onChange)
		},
		() => window.matchMedia(query).matches,
		() => false,
	)
}
