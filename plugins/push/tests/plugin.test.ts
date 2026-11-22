import { ForumApiPlugin } from '@pluxum/api'
import { ForumAuth, type Authentication } from '@pluxum/auth'
import { ForumCorePlugin } from '@pluxum/core'
import { Plugin } from '@pluxel/core'
import { database } from '@pluxel/services/database'
import { pglite } from '@pluxel/services/database/pglite'
import { elysia } from '@pluxel/services/elysia'
import { createTestHost } from '@pluxel/test'
import { describe, expect, it } from 'vitest'
import { createDecipheriv, createECDH, createHmac } from 'node:crypto'
import { vault } from '@pluxel/services/vault'
import { ForumPushPlugin, PUSH_EXT_ID, pushMessage } from '../src'

/** Stand-in identity provider: the `x-test-user` header names the account a request acts as. */
@Plugin(ForumAuth)
class FakeAuth extends ForumAuth {
	override loginAvailable(): boolean {
		return true
	}
	override authenticate(request: Request): Promise<Authentication> {
		const user = request.headers.get('x-test-user')
		return Promise.resolve(
			user === null ? { status: 'guest' } : { status: 'authenticated', userId: user },
		)
	}
	override allowsOrigin(): boolean {
		return true
	}
	override beginLogin(): never {
		throw new Error('not used')
	}
	override completeLogin(): never {
		throw new Error('not used')
	}
	override logout(): never {
		throw new Error('not used')
	}
	override logoutEverywhere(): never {
		throw new Error('not used')
	}
	override revokeUserSessions(): Promise<number> {
		return Promise.resolve(0)
	}
	override backchannelLogout(): never {
		throw new Error('not used')
	}
	override publicOrigin(): string | null {
		return 'https://forum.example'
	}
	override openSession(): never {
		throw new Error('not used')
	}
	override testLoginAvailable(): boolean {
		return false
	}
	override testLogin(): never {
		throw new Error('not used')
	}
}

const createHost = () =>
	createTestHost({
		services: [elysia(), database({ backend: pglite({ dataDir: 'memory://' }) }), vault()],
	})

type Host = Awaited<ReturnType<typeof createHost>>

function client(host: Host, userId?: string) {
	const identity: Record<string, string> = userId === undefined ? {} : { 'x-test-user': userId }
	const send = async (request: Request) => {
		const response = await host.http.fetch(request)
		const text = await response.text()
		// Parsed JSON stays untyped here; each test states the shape it expects.
		const body = text ? JSON.parse(text) : undefined
		return { status: response.status, body }
	}
	const url = (path: string) => new URL(`/api/forum${path}`, host.http.origin)
	return {
		get: (path: string) => send(new Request(url(path), { headers: identity })),
		post: (path: string, payload: unknown) =>
			send(
				new Request(url(path), {
					method: 'POST',
					headers: { ...identity, 'content-type': 'application/json' },
					body: JSON.stringify(payload),
				}),
			),
	}
}

const EXT = `/ext/${PUSH_EXT_ID}`

function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
	const prk = createHmac('sha256', salt).update(ikm).digest()
	return createHmac('sha256', prk)
		.update(Buffer.concat([info, Buffer.from([1])]))
		.digest()
		.subarray(0, length)
}

/** A browser's side of push: its keys, and reading a message sent to it. */
function browser(endpoint: string) {
	const ecdh = createECDH('prime256v1')
	ecdh.generateKeys()
	const auth = Buffer.alloc(16, 9)
	const read = (message: Buffer): unknown => {
		const salt = message.subarray(0, 16)
		const serverPublic = message.subarray(21, 21 + (message[20] ?? 0))
		const sealed = message.subarray(21 + serverPublic.length)
		const ikm = hkdf(
			auth,
			ecdh.computeSecret(serverPublic),
			Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), serverPublic]),
			32,
		)
		const key = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
		const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12)
		const decipher = createDecipheriv('aes-128-gcm', key, nonce)
		decipher.setAuthTag(sealed.subarray(-16))
		const plain = Buffer.concat([decipher.update(sealed.subarray(0, -16)), decipher.final()])
		return JSON.parse(plain.subarray(0, -1).toString())
	}
	return {
		subscription: {
			endpoint,
			p256dh: ecdh.getPublicKey().toString('base64url'),
			auth: auth.toString('base64url'),
		},
		read,
	}
}

type Sent = Readonly<{ url: string; headers: Headers; body: Buffer }>

async function setUp(host: Host) {
	await host.commit((change) => {
		change.start(ForumCorePlugin)
		change.start(FakeAuth)
		change.start(ForumApiPlugin)
		change.start(ForumPushPlugin)
	})
	const core = host.require(ForumCorePlugin)
	const push = host.require(ForumPushPlugin)
	const sent: Sent[] = []
	let status = 201
	push.useTransport((url, init) => {
		sent.push({
			url,
			headers: new Headers(init.headers),
			body: Buffer.from(init.body instanceof Uint8Array ? init.body : new Uint8Array()),
		})
		return Promise.resolve(new Response(null, { status }))
	})
	const alice = (await core.ensureUser({ subject: 'test:alice', displayName: 'Alice' })).unwrap()
	const bob = (await core.ensureUser({ subject: 'test:bob', displayName: 'Bob' })).unwrap()
	return { core, push, sent, alice, bob, answer: (next: number) => (status = next) }
}

const notice = (recipientId: string, id = '0b8e5d8e-4f3e-4a3c-9a0f-000000000001') => ({
	id,
	recipientId,
	kind: 'user.followed',
	title: 'Bob 关注了你',
	titleKey: 'notice.follow' as const,
	titleParams: { actor: 'Bob' },
	path: '/u/bob',
	createdAt: new Date().toISOString(),
})

describe('ForumPushPlugin', () => {
	it('hands out its key, and keeps a browser subscribed for its member', async () => {
		await using host = await createHost()
		const { alice } = await setUp(host)
		const guest = await client(host).get(`${EXT}/state`)
		expect(guest.status).toBe(200)
		expect(guest.body.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/)
		expect(guest.body.subscribed).toBe(false)

		const asAlice = client(host, alice.id)
		const phone = browser('https://fcm.googleapis.com/fcm/send/phone')
		const subscribed = await asAlice.post(`${EXT}/subscribe`, {
			...phone.subscription,
			locale: 'zh-CN',
		})
		expect(subscribed.body).toEqual({ publicKey: guest.body.publicKey, subscribed: true })
		const endpoint = encodeURIComponent(phone.subscription.endpoint)
		expect((await asAlice.get(`${EXT}/state?endpoint=${endpoint}`)).body.subscribed).toBe(true)

		// A push service of the member's choosing is refused, so the server posts nowhere else.
		const elsewhere = { ...phone.subscription, endpoint: 'https://127.0.0.1/hook', locale: 'zh-CN' }
		expect((await asAlice.post(`${EXT}/subscribe`, elsewhere)).status).not.toBe(200)
		expect(
			(await client(host).post(`${EXT}/subscribe`, { ...phone.subscription, locale: 'en' })).status,
		).toBe(401)

		await asAlice.post(`${EXT}/unsubscribe`, { endpoint: phone.subscription.endpoint })
		expect((await asAlice.get(`${EXT}/state?endpoint=${endpoint}`)).body.subscribed).toBe(false)
	})

	it("pushes each notification, encrypted, in the browser's language", async () => {
		await using host = await createHost()
		const { core, push, sent, alice, bob } = await setUp(host)
		const asAlice = client(host, alice.id)
		const phone = browser('https://fcm.googleapis.com/fcm/send/phone')
		const laptop = browser('https://updates.push.services.mozilla.com/wpush/v2/laptop')
		await asAlice.post(`${EXT}/subscribe`, { ...phone.subscription, locale: 'zh-CN' })
		await asAlice.post(`${EXT}/subscribe`, { ...laptop.subscription, locale: 'en' })

		await core.deliverNotification(notice(alice.id))
		await core.deliverNotification(notice(bob.id))
		await push.idle()
		expect(sent.map((item) => item.url).toSorted()).toEqual(
			[phone.subscription.endpoint, laptop.subscription.endpoint].toSorted(),
		)
		const toPhone = sent.find((item) => item.url === phone.subscription.endpoint)
		const toLaptop = sent.find((item) => item.url === laptop.subscription.endpoint)
		expect(phone.read(toPhone?.body ?? Buffer.alloc(0))).toEqual({
			title: 'Bob 关注了你',
			body: '',
			url: '/u/bob',
			tag: '0b8e5d8e-4f3e-4a3c-9a0f-000000000001',
		})
		expect(laptop.read(toLaptop?.body ?? Buffer.alloc(0))).toMatchObject({
			title: 'Bob followed you',
		})
		expect(toPhone?.headers.get('authorization')).toMatch(/^vapid t=.+, k=.+$/)
		expect(toPhone?.headers.get('content-encoding')).toBe('aes128gcm')
	})

	it('forgets a browser the push service no longer knows', async () => {
		await using host = await createHost()
		const { core, push, alice, answer } = await setUp(host)
		const asAlice = client(host, alice.id)
		const phone = browser('https://fcm.googleapis.com/fcm/send/phone')
		await asAlice.post(`${EXT}/subscribe`, { ...phone.subscription, locale: 'zh-CN' })
		expect(
			(await asAlice.post(`${EXT}/test`, { endpoint: phone.subscription.endpoint })).body,
		).toEqual({
			sent: true,
		})
		answer(410)
		await core.deliverNotification(notice(alice.id))
		await push.idle()
		const endpoint = encodeURIComponent(phone.subscription.endpoint)
		expect((await asAlice.get(`${EXT}/state?endpoint=${endpoint}`)).body.subscribed).toBe(false)
	})

	it('words a message for the browser and keeps links inside the forum', () => {
		const base = {
			id: 'n',
			title: '标题',
			titleKey: 'notice.accepted' as const,
			titleParams: { actor: 'A' },
		}
		expect(pushMessage({ ...base, path: '/t/1001/3' }, 'en')).toEqual({
			title: 'A accepted your answer',
			body: '',
			url: '/t/1001/3',
			tag: 'n',
		})
		expect(pushMessage({ ...base, path: 'https://evil.example' }, 'zh-CN').url).toBe(
			'/notifications',
		)
		expect(pushMessage({ id: 'n', title: 'x'.repeat(500) }, 'en').title).toHaveLength(160)
	})
})
