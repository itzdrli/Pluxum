import type { ShouldRevalidateFunctionArgs } from 'react-router'

function isDetailPath(pathname: string): boolean {
	return /\/(?:t\/[^/]+|new)\/?$/.test(pathname)
}

function parsePositivePage(raw: string | null): number {
	return raw !== null && /^[1-9]\d{0,5}$/.test(raw) ? Number(raw) : 1
}

/**
 * Extracts the 1-based category list page from a URL (`?cpage=`, falling back to legacy `?page=`
 * only on `/c/:slug` exact so thread pagination `?page=` on `/c/:slug/t/:id` stays orthogonal).
 */
export function categoryPageOf(url: URL): number {
	if (url.searchParams.has('cpage')) {
		return parsePositivePage(url.searchParams.get('cpage'))
	}
	if (!isDetailPath(url.pathname)) {
		return parsePositivePage(url.searchParams.get('page'))
	}
	return 1
}

function isIgnoredStageAction(formAction: string | undefined): boolean {
	return formAction === '/theme' || Boolean(formAction?.startsWith('/ext/'))
}

function isExplicitRevalidate({
	formMethod,
	currentUrl,
	nextUrl,
}: Pick<ShouldRevalidateFunctionArgs, 'formMethod' | 'currentUrl' | 'nextUrl'>): boolean {
	return (
		!formMethod &&
		currentUrl.pathname === nextUrl.pathname &&
		currentUrl.search === nextUrl.search &&
		currentUrl.hash === nextUrl.hash
	)
}

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

/**
 * Stage layout `shouldRevalidate`: the category list stays mounted across stage transitions and
 * only reloads after forum write actions (POST/PATCH/DELETE) or explicit `revalidate()`.
 */
export function stageShouldRevalidate(args: ShouldRevalidateFunctionArgs): boolean {
	const { formAction, formMethod, defaultShouldRevalidate } = args
	if (isIgnoredStageAction(formAction)) return false
	if (isExplicitRevalidate(args)) return defaultShouldRevalidate
	if (!formMethod || formMethod === 'GET') return false
	return defaultShouldRevalidate
}

/**
 * Category stage `shouldRevalidate`: switching between threads (or `/new`) or paginating thread
 * posts (`?page=`) inside the same category with the same category page (`?cpage=`) keeps the
 * thread list without refetching; changing `slug`, `?cpage=`, or submitting a forum mutation
 * revalidates.
 */
export function categoryStageShouldRevalidate(args: ShouldRevalidateFunctionArgs): boolean {
	const {
		currentParams,
		nextParams,
		currentUrl,
		nextUrl,
		formAction,
		formMethod,
		defaultShouldRevalidate,
	} = args
	if (isIgnoredStageAction(formAction)) return false
	if (isExplicitRevalidate(args)) return defaultShouldRevalidate
	if (
		currentParams.slug === nextParams.slug &&
		categoryPageOf(currentUrl) === categoryPageOf(nextUrl) &&
		(!formMethod || formMethod === 'GET')
	) {
		return false
	}
	return defaultShouldRevalidate
}
