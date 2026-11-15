import type { ShouldRevalidateFunctionArgs } from 'react-router'

/**
 * Route `shouldRevalidate`: saving a theme changes no forum data, so it reloads nothing. The shell
 * already shows the new theme, and the cookie applies from the next request on.
 */
export function keepOnThemeChange({
	formAction,
	defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs): boolean {
	return formAction === '/theme' ? false : defaultShouldRevalidate
}
