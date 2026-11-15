import { createLocalJWKSet, jwtVerify, type JSONWebKeySet, type JWTPayload } from 'jose'

const NETWORK_TIMEOUT_MS = 7_500
const MAX_RESPONSE_BYTES = 256 * 1024
const DISCOVERY_TTL_MS = 60 * 60_000
/** Lower bound between two JWKS downloads, so unknown key IDs cannot be used to flood the provider. */
const JWKS_REFRESH_COOLDOWN_MS = 30_000
const BACKCHANNEL_LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout'
const SIGNATURE_ALGORITHMS = ['RS256', 'RS384', 'RS512', 'PS256', 'ES256', 'ES384', 'EdDSA']

export type OidcSettings = Readonly<{
	issuer: string
	clientId: string
	scopes: readonly string[]
}>

type Discovery = Readonly<{
	authorizationEndpoint: string
	tokenEndpoint: string
	jwksUri: string
	userinfoEndpoint: string | undefined
	endSessionEndpoint: string | undefined
}>

/** What the forum keeps from a verified ID token. */
export type OidcIdentity = Readonly<{
	subject: string
	/** Provider session ID, when the provider issues one; needed for back-channel logout. */
	sid: string | undefined
	/** Best available human-readable name; may be empty. */
	name: string
}>

export type LogoutTokenClaims = Readonly<{ subject: string | undefined; sid: string | undefined }>

/** The provider could not be reached or answered outside the protocol; retrying later may work. */
export class OidcUnavailableError extends Error {}
/** The provider or the user's browser presented something that must not be accepted. */
export class OidcRejectedError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | undefined {
	return typeof value === 'string' && value !== '' ? value : undefined
}

/** Best available human-readable name among the standard profile claims; may be empty. */
function nameOf(claims: Record<string, unknown>): string {
	return (
		text(claims.name) ??
		text(claims.preferred_username)?.split('@')[0] ??
		text(claims.email)?.split('@')[0] ??
		''
	)
}

function isJwks(value: unknown): value is JSONWebKeySet {
	return isRecord(value) && Array.isArray(value.keys) && value.keys.every(isRecord)
}

function errorCode(error: unknown): unknown {
	return isRecord(error) || error instanceof Error
		? 'code' in error
			? error.code
			: undefined
		: undefined
}

/**
 * Minimal OpenID Connect relying party for one provider: authorization code flow with PKCE, ID
 * token verification against the provider's published keys, and logout token verification.
 * It holds no secrets and no per-login state; callers own both.
 */
export class OidcClient {
	private discovery: { value: Discovery; expiresAt: number } | undefined
	private jwks: { verify: ReturnType<typeof createLocalJWKSet>; fetchedAt: number } | undefined

	constructor(readonly settings: OidcSettings) {}

	async authorizationUrl(
		input: Readonly<{
			redirectUri: string
			state: string
			nonce: string
			codeChallenge: string
		}>,
	): Promise<string> {
		const { authorizationEndpoint } = await this.discover()
		const url = new URL(authorizationEndpoint)
		url.searchParams.set('response_type', 'code')
		url.searchParams.set('client_id', this.settings.clientId)
		url.searchParams.set('redirect_uri', input.redirectUri)
		url.searchParams.set('scope', this.settings.scopes.join(' '))
		url.searchParams.set('state', input.state)
		url.searchParams.set('nonce', input.nonce)
		url.searchParams.set('code_challenge', input.codeChallenge)
		url.searchParams.set('code_challenge_method', 'S256')
		return url.href
	}

	/** Redeems an authorization code and returns the identity asserted by its verified ID token. */
	async redeem(
		input: Readonly<{
			code: string
			codeVerifier: string
			redirectUri: string
			nonce: string
			clientSecret: string | undefined
		}>,
	): Promise<OidcIdentity> {
		const { tokenEndpoint } = await this.discover()
		const form = new URLSearchParams({
			grant_type: 'authorization_code',
			code: input.code,
			redirect_uri: input.redirectUri,
			code_verifier: input.codeVerifier,
		})
		const headers = new Headers({ accept: 'application/json' })
		if (input.clientSecret === undefined) {
			form.set('client_id', this.settings.clientId)
		} else {
			// client_secret_basic (RFC 6749 §2.3.1): both parts are form-urlencoded before encoding.
			const credentials = `${encodeURIComponent(this.settings.clientId)}:${encodeURIComponent(input.clientSecret)}`
			headers.set('authorization', `Basic ${btoa(credentials)}`)
		}
		const response = await this.request(tokenEndpoint, { method: 'POST', headers, body: form })
		const body = await this.json(response)
		if (!response.ok) {
			// 4xx is the provider refusing this code or client; anything else is the provider failing.
			const reason = text(body.error) ?? `HTTP ${response.status}`
			if (response.status >= 400 && response.status < 500) {
				throw new OidcRejectedError(`Token endpoint refused the code: ${reason}`)
			}
			throw new OidcUnavailableError(`Token endpoint failed: ${reason}`)
		}
		const idToken = text(body.id_token)
		if (idToken === undefined) throw new OidcRejectedError('Token response has no id_token')
		const claims = await this.verify(idToken)
		if (claims.nonce !== input.nonce) throw new OidcRejectedError('ID token nonce mismatch')
		const subject = text(claims.sub)
		if (subject === undefined) throw new OidcRejectedError('ID token has no subject')
		// Providers may leave profile claims out of the ID token and serve them from UserInfo only
		// (Zitadel does unless the application opts in).
		const name =
			nameOf(claims) || (await this.userinfoName(subject, text(body.access_token)).catch(() => ''))
		return { subject, sid: text(claims.sid), name }
	}

	/** The account's name from the UserInfo endpoint; empty when it cannot be had. */
	private async userinfoName(subject: string, accessToken: string | undefined): Promise<string> {
		const { userinfoEndpoint } = await this.discover()
		if (userinfoEndpoint === undefined || accessToken === undefined) return ''
		const response = await this.request(userinfoEndpoint, {
			method: 'GET',
			headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
		})
		if (!response.ok) return ''
		const claims = await this.json(response)
		// The response must describe the account the ID token named (OIDC Core §5.3.2).
		return claims.sub === subject ? nameOf(claims) : ''
	}

	/** Verifies an OIDC Back-Channel Logout token (§2.6) and returns whom it logs out. */
	async verifyLogoutToken(token: string): Promise<LogoutTokenClaims> {
		const claims = await this.verify(token)
		if (!isRecord(claims.events) || !isRecord(claims.events[BACKCHANNEL_LOGOUT_EVENT])) {
			throw new OidcRejectedError('Logout token lacks the back-channel logout event')
		}
		if (claims.nonce !== undefined) throw new OidcRejectedError('Logout token carries a nonce')
		const subject = text(claims.sub)
		const sid = text(claims.sid)
		if (subject === undefined && sid === undefined) {
			throw new OidcRejectedError('Logout token names neither a subject nor a session')
		}
		return { subject, sid }
	}

	/** Where to send the browser to end the provider's session, if the provider supports it. */
	async endSessionUrl(postLogoutRedirectUri: string): Promise<string | undefined> {
		const { endSessionEndpoint } = await this.discover()
		if (endSessionEndpoint === undefined) return undefined
		const url = new URL(endSessionEndpoint)
		url.searchParams.set('client_id', this.settings.clientId)
		url.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri)
		return url.href
	}

	private async verify(token: string): Promise<JWTPayload> {
		const attempt = async (): Promise<JWTPayload> => {
			const { verify } = await this.keys()
			const { payload } = await jwtVerify(token, verify, {
				issuer: this.settings.issuer,
				audience: this.settings.clientId,
				algorithms: SIGNATURE_ALGORITHMS,
				requiredClaims: ['iat'],
				clockTolerance: 30,
			})
			return payload
		}
		try {
			try {
				return await attempt()
			} catch (error) {
				// The provider may have rotated its keys since the last download.
				if (errorCode(error) !== 'ERR_JWKS_NO_MATCHING_KEY' || !this.jwksIsStale()) throw error
				this.jwks = undefined
				return await attempt()
			}
		} catch (error) {
			if (error instanceof OidcUnavailableError) throw error
			throw new OidcRejectedError('Token verification failed', { cause: error })
		}
	}

	private jwksIsStale(): boolean {
		return this.jwks === undefined || Date.now() - this.jwks.fetchedAt >= JWKS_REFRESH_COOLDOWN_MS
	}

	private async keys(): Promise<{ verify: ReturnType<typeof createLocalJWKSet> }> {
		if (this.jwks) return this.jwks
		const { jwksUri } = await this.discover()
		const body = await this.json(await this.request(jwksUri, { method: 'GET' }))
		if (!isJwks(body)) throw new OidcUnavailableError('Provider JWKS is malformed')
		this.jwks = { verify: createLocalJWKSet(body), fetchedAt: Date.now() }
		return this.jwks
	}

	private async discover(): Promise<Discovery> {
		if (this.discovery && Date.now() < this.discovery.expiresAt) return this.discovery.value
		const issuer = this.settings.issuer
		const response = await this.request(
			`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`,
			{ method: 'GET' },
		)
		if (!response.ok) {
			throw new OidcUnavailableError(`Provider discovery failed: HTTP ${response.status}`)
		}
		const body = await this.json(response)
		// The document must describe the issuer that was asked for (OIDC Discovery §4.3).
		if (body.issuer !== issuer) throw new OidcUnavailableError('Provider discovery issuer mismatch')
		const authorizationEndpoint = this.endpoint(body.authorization_endpoint)
		const tokenEndpoint = this.endpoint(body.token_endpoint)
		const jwksUri = this.endpoint(body.jwks_uri)
		if (!authorizationEndpoint || !tokenEndpoint || !jwksUri) {
			throw new OidcUnavailableError('Provider discovery lacks required endpoints')
		}
		const value: Discovery = {
			authorizationEndpoint,
			tokenEndpoint,
			jwksUri,
			userinfoEndpoint: this.endpoint(body.userinfo_endpoint),
			endSessionEndpoint: this.endpoint(body.end_session_endpoint),
		}
		this.discovery = { value, expiresAt: Date.now() + DISCOVERY_TTL_MS }
		return value
	}

	/** An endpoint URL from discovery; it may not be weaker than the issuer's own scheme. */
	private endpoint(value: unknown): string | undefined {
		const raw = text(value)
		if (raw === undefined || raw.length > 2048) return undefined
		try {
			const url = new URL(raw)
			if (url.username || url.password || url.hash) return undefined
			const insecureIssuer = this.settings.issuer.startsWith('http://')
			return url.protocol === 'https:' || (insecureIssuer && url.protocol === 'http:')
				? url.href
				: undefined
		} catch {
			return undefined
		}
	}

	private async request(url: string, init: RequestInit): Promise<Response> {
		try {
			return await fetch(url, {
				...init,
				redirect: 'error',
				signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
			})
		} catch (error) {
			throw new OidcUnavailableError(`Cannot reach the identity provider at ${new URL(url).host}`, {
				cause: error,
			})
		}
	}

	private async json(response: Response): Promise<Record<string, unknown>> {
		let parsed: unknown
		try {
			const body = await response.text()
			if (body.length > MAX_RESPONSE_BYTES) throw new Error('response too large')
			parsed = JSON.parse(body)
		} catch (error) {
			throw new OidcUnavailableError('Identity provider sent an unreadable response', {
				cause: error,
			})
		}
		if (!isRecord(parsed)) {
			throw new OidcUnavailableError('Identity provider sent an unexpected response')
		}
		return parsed
	}
}
