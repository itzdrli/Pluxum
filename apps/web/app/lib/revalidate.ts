import type { ShouldRevalidateFunctionArgs } from 'react-router'

// Extension actions update their own slot data; they never change the category list.
function isExtensionAction(formAction: string | undefined): boolean {
	return formAction?.startsWith('/ext/') === true
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
 * Stage layout `shouldRevalidate`: the category list stays mounted across stage transitions and
 * only reloads after forum write actions (POST/PATCH/DELETE) or explicit `revalidate()`.
 */
export function stageShouldRevalidate(args: ShouldRevalidateFunctionArgs): boolean {
	const { formAction, formMethod, defaultShouldRevalidate } = args
	if (isExtensionAction(formAction)) return false
	if (isExplicitRevalidate(args)) return defaultShouldRevalidate
	if (!formMethod || formMethod === 'GET') return false
	return defaultShouldRevalidate
}
