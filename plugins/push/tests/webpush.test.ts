import { createDecipheriv, createECDH, createHmac, createPublicKey, verify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
	encryptPayload,
	generateVapidKeys,
	isPushEndpoint,
	sendPush,
	vapidAuthorization,
	type Fetch,
} from '../src/webpush'

const b64u = (text: string) => Buffer.from(text, 'base64url')

// RFC 8291, Appendix A.
const VECTOR = {
	plaintext: 'When I grow up, I want to be a watermelon',
	serverPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
	clientPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
	clientPublic:
		'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
	salt: 'DGv6ra1nlYgDCS1FRnbzlw',
	auth: 'BTBZMqHH6r4Tts7J_aSIgg',
	message:
		'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
}

function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
	const prk = createHmac('sha256', salt).update(ikm).digest()
	return createHmac('sha256', prk)
		.update(Buffer.concat([info, Buffer.from([1])]))
		.digest()
		.subarray(0, length)
}

/** What the browser does with a message: the receiving side of RFC 8291. */
function decrypt(message: Buffer, clientPrivate: Buffer, auth: Buffer): string {
	const salt = message.subarray(0, 16)
	const idLength = message[20] ?? 0
	const serverPublic = message.subarray(21, 21 + idLength)
	const sealed = message.subarray(21 + idLength)
	const ecdh = createECDH('prime256v1')
	ecdh.setPrivateKey(clientPrivate)
	const clientPublic = ecdh.getPublicKey()
	const secret = ecdh.computeSecret(serverPublic)
	const ikm = hkdf(
		auth,
		secret,
		Buffer.concat([Buffer.from('WebPush: info\0'), clientPublic, serverPublic]),
		32,
	)
	const key = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
	const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12)
	const decipher = createDecipheriv('aes-128-gcm', key, nonce)
	decipher.setAuthTag(sealed.subarray(-16))
	const plain = Buffer.concat([decipher.update(sealed.subarray(0, -16)), decipher.final()])
	expect(plain.at(-1)).toBe(2)
	return plain.subarray(0, -1).toString()
}

describe('encryptPayload', () => {
	it('matches the example of RFC 8291', () => {
		const message = encryptPayload(
			Buffer.from(VECTOR.plaintext),
			{ p256dh: VECTOR.clientPublic, auth: VECTOR.auth },
			{ salt: b64u(VECTOR.salt), serverPrivateKey: b64u(VECTOR.serverPrivate) },
		)
		expect(message.toString('base64url')).toBe(VECTOR.message)
	})

	it('encrypts each message afresh, and the browser can read it', () => {
		const browser = createECDH('prime256v1')
		browser.generateKeys()
		const auth = Buffer.alloc(16, 7)
		const target = {
			p256dh: browser.getPublicKey().toString('base64url'),
			auth: auth.toString('base64url'),
		}
		const first = encryptPayload(Buffer.from('{"title":"你好"}'), target)
		const second = encryptPayload(Buffer.from('{"title":"你好"}'), target)
		expect(first.equals(second)).toBe(false)
		expect(decrypt(first, browser.getPrivateKey(), auth)).toBe('{"title":"你好"}')
	})
})

describe('vapidAuthorization', () => {
	it('signs a token for the push service origin with the server key', () => {
		const keys = generateVapidKeys()
		const header = vapidAuthorization(
			'https://fcm.googleapis.com/fcm/send/abc',
			keys,
			'https://forum.example',
			1_700_000_000_000,
		)
		const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)
		expect(match).not.toBeNull()
		const [, head = '', claims = '', signature = '', k] = match ?? []
		expect(k).toBe(keys.publicKey)
		expect(JSON.parse(b64u(claims).toString())).toEqual({
			aud: 'https://fcm.googleapis.com',
			exp: 1_700_000_000 + 12 * 3600,
			sub: 'https://forum.example',
		})
		const point = b64u(keys.publicKey)
		const publicKey = createPublicKey({
			key: {
				kty: 'EC',
				crv: 'P-256',
				x: point.subarray(1, 33).toString('base64url'),
				y: point.subarray(33).toString('base64url'),
			},
			format: 'jwk',
		})
		expect(
			verify(
				'sha256',
				Buffer.from(`${head}.${claims}`),
				{ key: publicKey, dsaEncoding: 'ieee-p1363' },
				b64u(signature),
			),
		).toBe(true)
	})
})

describe('isPushEndpoint', () => {
	it('accepts the browsers’ push services only', () => {
		expect(isPushEndpoint('https://fcm.googleapis.com/fcm/send/x')).toBe(true)
		expect(isPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true)
		expect(isPushEndpoint('https://web.push.apple.com/QG1')).toBe(true)
		expect(isPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=x')).toBe(true)
		expect(isPushEndpoint('http://fcm.googleapis.com/fcm/send/x')).toBe(false)
		expect(isPushEndpoint('https://fcm.googleapis.com:8443/x')).toBe(false)
		expect(isPushEndpoint('https://evil.example/fcm.googleapis.com')).toBe(false)
		expect(isPushEndpoint('https://push.apple.com.evil.example/x')).toBe(false)
		expect(isPushEndpoint('https://127.0.0.1/x')).toBe(false)
		expect(isPushEndpoint('not a url')).toBe(false)
	})
})

describe('sendPush', () => {
	it('reports a subscription the service no longer has', async () => {
		const keys = generateVapidKeys()
		const browser = createECDH('prime256v1')
		browser.generateKeys()
		const target = {
			endpoint: 'https://fcm.googleapis.com/fcm/send/x',
			p256dh: browser.getPublicKey().toString('base64url'),
			auth: Buffer.alloc(16, 1).toString('base64url'),
		}
		const seen: RequestInit[] = []
		const answer =
			(status: number): Fetch =>
			(_url, init) => {
				if (init) seen.push(init)
				return Promise.resolve(new Response(null, { status }))
			}
		expect(await sendPush(target, Buffer.from('{}'), keys, 's', 60, answer(201))).toEqual({
			outcome: 'sent',
			status: 201,
		})
		expect(await sendPush(target, Buffer.from('{}'), keys, 's', 60, answer(410))).toEqual({
			outcome: 'gone',
			status: 410,
		})
		expect(await sendPush(target, Buffer.from('{}'), keys, 's', 60, answer(500))).toEqual({
			outcome: 'failed',
			status: 500,
		})
		expect(new Headers(seen[0]?.headers).get('content-encoding')).toBe('aes128gcm')
		expect(new Headers(seen[0]?.headers).get('ttl')).toBe('60')
	})
})
