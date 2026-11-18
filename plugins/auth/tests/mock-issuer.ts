import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { pkceChallenge } from '../src/crypto'

export const ISSUER = 'https://idp.test'
export const CLIENT_ID = 'forum-client'

export type MockUser = Readonly<{
	sub: string
	name?: string
	sid?: string
	email?: string
	emailVerified?: boolean
}>

/** The `email` / `email_verified` claims of `user`, as a provider would state them. */
function emailClaims(user: MockUser) {
	return {
		...(user.email === undefined ? {} : { email: user.email }),
		...(user.emailVerified === undefined ? {} : { email_verified: user.emailVerified }),
	}
}

type Grant = Readonly<{
	user: MockUser
	nonce: string
	codeChallenge: string
	redirectUri: string
}>

const json = (body: unknown, status = 200) => Response.json(body, { status })

/**
 * An in-process OpenID Connect provider reached through a replaced `fetch`. `authorize()` plays
 * the browser's visit to the authorization endpoint and returns the callback URL it would be
 * redirected to.
 */
export async function createMockIssuer() {
	const { publicKey, privateKey } = await generateKeyPair('RS256')
	const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' }
	const grants = new Map<string, Grant>()
	const profiles = new Map<string, MockUser>()
	const options = {
		nameInIdToken: true,
		tamperNonce: false,
		clientSecret: undefined as string | undefined,
	}

	const sign = (claims: Record<string, unknown>) =>
		new SignJWT(claims)
			.setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
			.setIssuer(ISSUER)
			.setAudience(CLIENT_ID)
			.setIssuedAt()
			.setExpirationTime('5m')
			.sign(privateKey)

	async function token(request: Request): Promise<Response> {
		const form = new URLSearchParams(await request.text())
		const grant = grants.get(form.get('code') ?? '')
		grants.delete(form.get('code') ?? '')
		if (!grant || grant.redirectUri !== form.get('redirect_uri')) {
			return json({ error: 'invalid_grant' }, 400)
		}
		if ((await pkceChallenge(form.get('code_verifier') ?? '')) !== grant.codeChallenge) {
			return json({ error: 'invalid_grant' }, 400)
		}
		if (options.clientSecret !== undefined) {
			// client_secret_basic: both halves arrive form-urlencoded (RFC 6749 §2.3.1).
			const [scheme, encoded = ''] = (request.headers.get('authorization') ?? '').split(' ')
			const [id = '', secret = ''] = atob(encoded).split(':').map(decodeURIComponent)
			if (scheme !== 'Basic' || id !== CLIENT_ID || secret !== options.clientSecret) {
				return json({ error: 'invalid_client' }, 401)
			}
		} else if (form.get('client_id') !== CLIENT_ID) {
			return json({ error: 'invalid_client' }, 401)
		}
		const { user } = grant
		const idToken = await sign({
			sub: user.sub,
			nonce: options.tamperNonce ? 'someone-else' : grant.nonce,
			...(user.name === undefined || !options.nameInIdToken ? {} : { name: user.name }),
			...(options.nameInIdToken ? emailClaims(user) : {}),
			...(user.sid === undefined ? {} : { sid: user.sid }),
		})
		const accessToken = crypto.randomUUID()
		profiles.set(accessToken, user)
		return json({ access_token: accessToken, token_type: 'Bearer', id_token: idToken })
	}

	return {
		options,
		/** Replacement for the global `fetch`; anything but the provider's endpoints fails. */
		fetch: async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
			const request = new Request(input, init)
			const url = new URL(request.url)
			if (url.origin !== ISSUER) throw new TypeError(`unexpected fetch to ${url.origin}`)
			switch (url.pathname) {
				case '/.well-known/openid-configuration':
					return json({
						issuer: ISSUER,
						authorization_endpoint: `${ISSUER}/authorize`,
						token_endpoint: `${ISSUER}/token`,
						jwks_uri: `${ISSUER}/keys`,
						userinfo_endpoint: `${ISSUER}/userinfo`,
						end_session_endpoint: `${ISSUER}/end-session`,
					})
				case '/keys':
					return json({ keys: [jwk] })
				case '/token':
					return token(request)
				case '/userinfo': {
					const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '')
					const user = profiles.get(bearer)
					return user
						? json({ sub: user.sub, name: user.name, ...emailClaims(user) })
						: json({}, 401)
				}
				default:
					return json({ error: 'not_found' }, 404)
			}
		},
		/** The user signs in at the provider; returns the callback URL carrying code and state. */
		authorize(authorizationUrl: string, user: MockUser): string {
			const params = new URL(authorizationUrl).searchParams
			if (params.get('client_id') !== CLIENT_ID || params.get('response_type') !== 'code') {
				throw new Error('unexpected authorization request')
			}
			if (params.get('code_challenge_method') !== 'S256') throw new Error('PKCE S256 expected')
			const code = crypto.randomUUID()
			const redirectUri = params.get('redirect_uri') ?? ''
			grants.set(code, {
				user,
				nonce: params.get('nonce') ?? '',
				codeChallenge: params.get('code_challenge') ?? '',
				redirectUri,
			})
			const callback = new URL(redirectUri)
			callback.searchParams.set('code', code)
			callback.searchParams.set('state', params.get('state') ?? '')
			return callback.href
		},
		logoutToken(
			claims: Readonly<{ sub?: string; sid?: string }>,
			withEvent = true,
		): Promise<string> {
			return sign({
				...claims,
				jti: crypto.randomUUID(),
				...(withEvent
					? { events: { 'http://schemas.openid.net/event/backchannel-logout': {} } }
					: {}),
			})
		},
	}
}
