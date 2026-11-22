// The Web Push protocol with node:crypto alone: VAPID authorisation (RFC 8292) and the
// aes128gcm message encryption (RFC 8291 over RFC 8188).
import {
	createCipheriv,
	createECDH,
	createHmac,
	createPrivateKey,
	generateKeyPairSync,
	randomBytes,
	sign,
} from 'node:crypto'

/** The server's P-256 key pair: the uncompressed public point and the private scalar, base64url. */
export type VapidKeys = Readonly<{ publicKey: string; privateKey: string }>

/** A browser's push subscription: where to send, and the keys its messages are encrypted to. */
export type PushTarget = Readonly<{ endpoint: string; p256dh: string; auth: string }>

/** One record holds the whole message; the payload must stay well under it. */
const RECORD_SIZE = 4096

/**
 * Push services the forum sends to: Chrome / Edge / Android (FCM), Firefox (Mozilla), Safari
 * (Apple) and Windows (WNS). A subscription elsewhere is refused, so a member cannot make the
 * server post to an address of their choosing.
 */
const PUSH_HOSTS = [
	'fcm.googleapis.com',
	'android.googleapis.com',
	'updates.push.services.mozilla.com',
	'.push.services.mozilla.com',
	'.push.apple.com',
	'.notify.windows.com',
]

export function isPushEndpoint(endpoint: string): boolean {
	let url: URL
	try {
		url = new URL(endpoint)
	} catch {
		return false
	}
	if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '') {
		return false
	}
	const host = url.hostname.toLowerCase()
	return PUSH_HOSTS.some((allowed) =>
		allowed.startsWith('.')
			? host.endsWith(allowed) && host.length > allowed.length
			: host === allowed,
	)
}

const b64u = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url')
const fromB64u = (text: string): Buffer => Buffer.from(text, 'base64url')

export function generateVapidKeys(): VapidKeys {
	const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
	const jwk = privateKey.export({ format: 'jwk' })
	if (jwk.x === undefined || jwk.y === undefined || jwk.d === undefined) {
		throw new Error('P-256 key export lacks its coordinates')
	}
	return {
		publicKey: b64u(Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)])),
		privateKey: jwk.d,
	}
}

/** HKDF-SHA-256 for outputs of at most one block (RFC 5869). */
function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Buffer {
	const prk = createHmac('sha256', salt).update(ikm).digest()
	return createHmac('sha256', prk)
		.update(Buffer.concat([info, Buffer.from([1])]))
		.digest()
		.subarray(0, length)
}

/**
 * The encrypted body of one push message. `salt` and `serverPrivateKey` are fixed only by tests;
 * each message otherwise gets a fresh salt and a fresh ephemeral key.
 */
export function encryptPayload(
	payload: Uint8Array,
	target: Pick<PushTarget, 'p256dh' | 'auth'>,
	fixed: Readonly<{ salt?: Uint8Array; serverPrivateKey?: Uint8Array }> = {},
): Buffer {
	const ecdh = createECDH('prime256v1')
	if (fixed.serverPrivateKey === undefined) ecdh.generateKeys()
	else ecdh.setPrivateKey(fixed.serverPrivateKey)
	const serverPublic = ecdh.getPublicKey()
	const clientPublic = fromB64u(target.p256dh)
	const secret = ecdh.computeSecret(clientPublic)
	const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), clientPublic, serverPublic])
	const ikm = hkdf(fromB64u(target.auth), secret, keyInfo, 32)
	const salt = fixed.salt ?? randomBytes(16)
	const key = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
	const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12)
	const cipher = createCipheriv('aes-128-gcm', key, nonce)
	// 0x02 closes the last (and only) record.
	const sealed = Buffer.concat([
		cipher.update(Buffer.concat([payload, Buffer.from([2])])),
		cipher.final(),
		cipher.getAuthTag(),
	])
	if (sealed.length + 21 + serverPublic.length > RECORD_SIZE) {
		throw new Error('Push payload does not fit one record')
	}
	const header = Buffer.alloc(21)
	Buffer.from(salt).copy(header, 0)
	header.writeUInt32BE(RECORD_SIZE, 16)
	header[20] = serverPublic.length
	return Buffer.concat([header, serverPublic, sealed])
}

/** The `Authorization` header that identifies this server to the push service (RFC 8292). */
export function vapidAuthorization(
	endpoint: string,
	keys: VapidKeys,
	subject: string,
	now = Date.now(),
): string {
	const header = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
	const claims = b64u(
		Buffer.from(
			JSON.stringify({
				aud: new URL(endpoint).origin,
				// At most 24 hours ahead; 12 leaves room for clock skew.
				exp: Math.floor(now / 1000) + 12 * 3600,
				sub: subject,
			}),
		),
	)
	const point = fromB64u(keys.publicKey)
	const key = createPrivateKey({
		key: {
			kty: 'EC',
			crv: 'P-256',
			d: keys.privateKey,
			x: b64u(point.subarray(1, 33)),
			y: b64u(point.subarray(33, 65)),
		},
		format: 'jwk',
	})
	const signature = sign('sha256', Buffer.from(`${header}.${claims}`), {
		key,
		dsaEncoding: 'ieee-p1363',
	})
	return `vapid t=${header}.${claims}.${b64u(signature)}, k=${keys.publicKey}`
}

/** The part of `fetch` push needs; tests pass a stand-in. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>

/** What the push service said: `gone` means the subscription no longer exists. */
export type PushOutcome = 'sent' | 'gone' | 'failed'

/** Sends one message; never throws. */
export async function sendPush(
	target: PushTarget,
	payload: Uint8Array,
	keys: VapidKeys,
	subject: string,
	ttlSeconds: number,
	send: Fetch = (url, init) => fetch(url, init),
): Promise<Readonly<{ outcome: PushOutcome; status: number }>> {
	try {
		const response = await send(target.endpoint, {
			method: 'POST',
			headers: {
				authorization: vapidAuthorization(target.endpoint, keys, subject),
				'content-encoding': 'aes128gcm',
				'content-type': 'application/octet-stream',
				ttl: String(ttlSeconds),
				urgency: 'normal',
			},
			body: new Uint8Array(encryptPayload(payload, target)),
			signal: AbortSignal.timeout(10_000),
		})
		await response.body?.cancel()
		if (response.ok) return { outcome: 'sent', status: response.status }
		return {
			outcome: response.status === 404 || response.status === 410 ? 'gone' : 'failed',
			status: response.status,
		}
	} catch {
		return { outcome: 'failed', status: 0 }
	}
}
