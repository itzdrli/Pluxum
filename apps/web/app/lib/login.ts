import type { MetaDto } from '@pluxum/domain'

/**
 * Where "登录" goes: the sign-in page when email and password login exists (it also offers the
 * provider), else straight to the identity provider through the API.
 */
export function loginHref(auth: MetaDto['auth'] | null | undefined, returnTo: string): string {
	const query = `returnTo=${encodeURIComponent(returnTo)}`
	return auth?.password === true ? `/login?${query}` : `/api/forum/auth/login?${query}`
}

/** A same-origin path to return to; anything that could leave the origin becomes `/`. */
export function safeReturnTo(value: string | null): string {
	if (value === null || value.length > 512) return '/'
	// One leading slash only: `//host` and `/\host` are read by browsers as another origin.
	return /^\/(?![/\\])[\x21-\x7E]*$/.test(value) ? value : '/'
}
