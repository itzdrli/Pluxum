import * as v from 'valibot'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** A bare origin (`scheme://host[:port]`), HTTPS unless it is plain HTTP for development. */
function isOrigin(value: string): boolean {
	try {
		const url = new URL(value)
		return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value
	} catch {
		return false
	}
}

/** HTTPS issuer without credentials, query or fragment; plain HTTP only on loopback (tests, mocks). */
function isIssuer(value: string): boolean {
	try {
		const url = new URL(value)
		if (url.username || url.password || url.search || url.hash) return false
		return (
			url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))
		)
	} catch {
		return false
	}
}

const seconds = (fallback: number) =>
	v.optional(v.pipe(v.number(), v.integer(), v.minValue(60)), fallback)

export const ForumAuthConfig = v.object({
	/**
	 * Origin of the forum frontend as browsers see it. The OIDC callback, the session cookie and the
	 * cross-site request check are all bound to it; it is never derived from request headers.
	 * Login stays unavailable until this and `oidc` are set.
	 */
	publicOrigin: v.optional(
		v.pipe(v.string(), v.check(isOrigin, 'publicOrigin must be an origin like https://forum.test')),
	),
	/**
	 * OpenID Connect provider (Zitadel). The client secret is not configuration: a confidential
	 * client stores it in this plugin's Vault record `oidc-client-secret`; without that record the
	 * client authenticates with PKCE alone.
	 */
	oidc: v.optional(
		v.object({
			issuer: v.pipe(
				v.string(),
				v.check(isIssuer, 'issuer must be an https:// URL (http:// only on loopback)'),
			),
			clientId: v.pipe(v.string(), v.minLength(1), v.maxLength(255)),
			scopes: v.optional(
				v.pipe(
					v.array(v.pipe(v.string(), v.regex(/^[\x21\x23-\x5B\x5D-\x7E]+$/))),
					v.check((scopes) => scopes.includes('openid'), 'scopes must include "openid"'),
				),
				['openid', 'profile', 'email'],
			),
			/** After a local logout, also end the provider's own session (RP-initiated logout). */
			providerLogout: v.optional(v.boolean(), false),
		}),
	),
	session: v.optional(
		v.object({
			/** Named connection of the `Redis` capability that holds sessions. */
			connectionId: v.optional(v.pipe(v.string(), v.minLength(1)), 'session'),
			/** A session ends after this long without a request. */
			idleTtlSeconds: seconds(7 * 24 * 3600),
			/** A session ends this long after login no matter how active it is. */
			absoluteTtlSeconds: seconds(30 * 24 * 3600),
		}),
		{},
	),
	/** Provider subjects (`sub`) that receive the admin role when they log in. */
	adminSubjects: v.optional(v.array(v.pipe(v.string(), v.minLength(1), v.maxLength(255))), []),
})

export type ForumAuthConfig = v.InferOutput<typeof ForumAuthConfig>
