const encoder = new TextEncoder()

function base64url(bytes: Uint8Array): string {
	let binary = ''
	for (const byte of bytes) binary += String.fromCodePoint(byte)
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/** An unguessable URL-safe token carrying `bytes` of entropy. */
export function randomToken(bytes = 32): string {
	return base64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

async function sha256(value: string): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

/** Hex SHA-256, used to derive Redis key names so stored keys never contain a usable secret. */
export async function sha256Hex(value: string): Promise<string> {
	return Array.from(await sha256(value), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** The S256 PKCE challenge of a verifier (RFC 7636 §4.2). */
export async function pkceChallenge(verifier: string): Promise<string> {
	return base64url(await sha256(verifier))
}

/** Whether `value` hashes to `expectedHex`, compared in constant time. */
export async function matchesSha256(value: string, expectedHex: string): Promise<boolean> {
	const actual = await sha256Hex(value)
	if (actual.length !== expectedHex.length) return false
	let diff = 0
	for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expectedHex.charCodeAt(i)
	return diff === 0
}
