import { ForumApiPlugin } from '@pluxum/api'
import { ForumAuth, type Authentication } from '@pluxum/auth'
import { ForumCorePlugin } from '@pluxum/core'
import { BasePlugin, Plugin } from '@pluxel/core'
import { database } from '@pluxel/services/database'
import { pglite } from '@pluxel/services/database/pglite'
import { elysia } from '@pluxel/services/elysia'
import { createTestHost } from '@pluxel/test'
import { describe, expect, it } from 'vitest'
import type { ForumNotification } from '@pluxum/domain'
import { ForumMessagesPlugin, GROUP_MEMBERS_MAX, MESSAGES_EXT_ID } from '../src'

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
		return null
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
		services: [elysia(), database({ backend: pglite({ dataDir: 'memory://' }) })],
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

const EXT = `/ext/${MESSAGES_EXT_ID}`

const delivered: ForumNotification[] = []

/** Collects what the core delivers, standing in for the inbox. */
@Plugin()
class CollectingChannelPlugin extends BasePlugin {
	constructor(private readonly core: ForumCorePlugin) {
		super()
	}

	protected override init(): void {
		this.ctx.effects.defer(
			this.core.registerNotificationChannel({
				id: 'test.collect',
				deliver: (notification) => {
					delivered.push(notification)
				},
			}),
		)
	}
}

async function setUp(host: Host) {
	delivered.length = 0
	await host.commit((change) => {
		change.start(ForumCorePlugin)
		change.start(FakeAuth)
		change.start(ForumApiPlugin)
		change.start(CollectingChannelPlugin)
		change.start(ForumMessagesPlugin)
	})
	const core = host.require(ForumCorePlugin)
	const make = async (name: string) =>
		(await core.ensureUser({ subject: `test:${name}`, displayName: name })).unwrap()
	const admin = await make('Admin')
	;(await core.grantRole(admin.id, 'admin')).unwrap()
	const alice = await make('Alice')
	const bob = await make('Bob')
	const carol = await make('Carol')
	return { core, admin, alice, bob, carol }
}

describe('ForumMessagesPlugin', () => {
	it('keeps one conversation per pair, with unread counts and reading', async () => {
		await using host = await createHost()
		const { alice, bob, carol } = await setUp(host)
		const asAlice = client(host, alice.id)
		const asBob = client(host, bob.id)

		const started = await asAlice.post(`${EXT}/start`, { userId: bob.handle })
		expect(started.status).toBe(200)
		const id: string = started.body.id
		expect((await asBob.post(`${EXT}/start`, { userId: alice.id })).body.id).toBe(id)
		expect((await asAlice.post(`${EXT}/start`, { userId: alice.id })).status).not.toBe(200)

		const sent = await asAlice.post(`${EXT}/send`, { conversationId: id, body: '  你好，Bob  ' })
		expect(sent.body).toMatchObject({
			conversationId: id,
			body: '你好，Bob',
			author: { id: alice.id },
		})
		await asAlice.post(`${EXT}/send`, { conversationId: id, body: '在吗？' })
		expect(
			(await asAlice.post(`${EXT}/send`, { conversationId: id, body: '   ' })).status,
		).not.toBe(200)

		const list = await asBob.get(`${EXT}/list`)
		expect(list.body.unread).toBe(2)
		expect(list.body.items).toHaveLength(1)
		expect(list.body.items[0]).toMatchObject({
			id,
			kind: 'direct',
			unread: 2,
			lastMessage: { body: '在吗？' },
		})
		expect(
			list.body.items[0].members.map((member: { id: string }) => member.id).toSorted(),
		).toEqual([alice.id, bob.id].toSorted())
		// The writer has nothing unread in their own conversation.
		expect((await asAlice.get(`${EXT}/list`)).body.unread).toBe(0)

		const detail = await asBob.get(`${EXT}/get?id=${id}`)
		expect(detail.body.messages.map((message: { body: string }) => message.body)).toEqual([
			'你好，Bob',
			'在吗？',
		])
		expect(detail.body.hasMore).toBe(false)
		const last = detail.body.messages[1].seq
		expect((await asBob.post(`${EXT}/read`, { conversationId: id, seq: last })).body).toEqual({
			unread: 0,
		})

		// Others cannot read it.
		expect((await client(host, carol.id).get(`${EXT}/get?id=${id}`)).status).toBe(404)
		expect((await client(host).get(`${EXT}/list`)).status).toBe(401)
	})

	it('sends one notice per unread streak, and none to someone reading', async () => {
		await using host = await createHost()
		const { alice, bob } = await setUp(host)
		const asAlice = client(host, alice.id)
		const asBob = client(host, bob.id)
		const id: string = (await asAlice.post(`${EXT}/start`, { userId: bob.id })).body.id

		await asAlice.post(`${EXT}/send`, { conversationId: id, body: 'one' })
		await asAlice.post(`${EXT}/send`, { conversationId: id, body: 'two' })
		expect(
			delivered.map((notice) => [notice.recipientId, notice.kind, notice.titleKey, notice.path]),
		).toEqual([[bob.id, 'message.received', 'notice.message', `/messages/${id}`]])
		const seq = (await asBob.get(`${EXT}/list`)).body.items[0].lastMessage.seq
		await asBob.post(`${EXT}/read`, { conversationId: id, seq })
		await asAlice.post(`${EXT}/send`, { conversationId: id, body: 'three' })
		expect(delivered).toHaveLength(2)
		expect(delivered[1]?.id).not.toBe(delivered[0]?.id)

		// Bob has the conversation open (his poll says so): reading as it comes, no notice.
		const seen = (await asBob.get(`${EXT}/list`)).body.items[0].lastMessage.seq
		await asBob.post(`${EXT}/read`, { conversationId: id, seq: seen })
		await asBob.get(`${EXT}/poll?since=${seen}&conversation=${id}`)
		await asAlice.post(`${EXT}/send`, { conversationId: id, body: 'four' })
		expect(delivered).toHaveLength(2)
	})

	it('wakes a waiting poll with the new message', async () => {
		await using host = await createHost()
		const { alice, bob } = await setUp(host)
		const asAlice = client(host, alice.id)
		const asBob = client(host, bob.id)
		const id: string = (await asAlice.post(`${EXT}/start`, { userId: bob.id })).body.id
		const first = await asBob.get(`${EXT}/poll?since=0&conversation=${id}`)
		expect(first.body).toMatchObject({ changed: false, messages: [], unread: 0 })

		const startedAt = Date.now()
		const waiting = asBob.get(`${EXT}/poll?since=${first.body.seq}&conversation=${id}&wait=10`)
		await new Promise((resolve) => setTimeout(resolve, 200))
		await asAlice.post(`${EXT}/send`, { conversationId: id, body: 'ping' })
		const woken = await waiting
		expect(Date.now() - startedAt).toBeLessThan(5000)
		expect(woken.body).toMatchObject({ changed: true, unread: 1 })
		expect(woken.body.messages.map((message: { body: string }) => message.body)).toEqual(['ping'])
	})

	it('respects who may write to a member, except moderators', async () => {
		await using host = await createHost()
		const { alice, bob, admin } = await setUp(host)
		const asAlice = client(host, alice.id)
		const asBob = client(host, bob.id)
		const id: string = (await asAlice.post(`${EXT}/start`, { userId: bob.id })).body.id

		expect((await asBob.get(`${EXT}/settings`)).body).toEqual({ allow: 'everyone' })
		await asBob.post(`${EXT}/preference`, { allow: 'nobody' })
		const refused = await asAlice.post(`${EXT}/send`, { conversationId: id, body: 'hi' })
		expect(refused.status).toBe(403)
		expect(refused.body.error.key).toBe('messages.closed')
		expect((await client(host, admin.id).post(`${EXT}/start`, { userId: bob.id })).status).toBe(200)

		// 「People I follow」 without a follow plugin cannot be met, so it lets everyone through.
		await asBob.post(`${EXT}/preference`, { allow: 'following' })
		expect((await asAlice.post(`${EXT}/send`, { conversationId: id, body: 'hi' })).status).toBe(200)
	})

	it('runs groups: owner, members, leaving and the size limit', async () => {
		await using host = await createHost()
		const { core, alice, bob, carol } = await setUp(host)
		const asAlice = client(host, alice.id)
		const asBob = client(host, bob.id)
		const asCarol = client(host, carol.id)

		const made = await asAlice.post(`${EXT}/group`, {
			title: ' 周末爬山 ',
			memberIds: [bob.id, carol.handle],
		})
		expect(made.status).toBe(200)
		const id: string = made.body.id
		await asBob.post(`${EXT}/send`, { conversationId: id, body: '我来！' })
		expect((await asCarol.get(`${EXT}/list`)).body.items[0]).toMatchObject({
			kind: 'group',
			title: '周末爬山',
			ownerId: alice.id,
			unread: 1,
		})
		// Only the owner renames or changes members.
		expect((await asBob.post(`${EXT}/rename`, { conversationId: id, title: 'x' })).status).toBe(403)
		expect(
			(await asAlice.post(`${EXT}/rename`, { conversationId: id, title: '周日爬山' })).body.title,
		).toBe('周日爬山')
		const removed = await asAlice.post(`${EXT}/members`, { conversationId: id, remove: [carol.id] })
		expect(removed.body.members).toHaveLength(2)
		expect((await asCarol.get(`${EXT}/get?id=${id}`)).status).toBe(404)

		// The owner leaving hands the group on.
		expect((await asAlice.post(`${EXT}/leave`, { conversationId: id })).body).toEqual({
			left: true,
		})
		expect((await asBob.get(`${EXT}/get?id=${id}`)).body.conversation.ownerId).toBe(bob.id)
		await asBob.post(`${EXT}/leave`, { conversationId: id })
		expect((await asBob.get(`${EXT}/list`)).body.items).toEqual([])

		const crowd = await Promise.all(
			Array.from({ length: GROUP_MEMBERS_MAX }, async (_, index) =>
				(await core.ensureUser({ subject: `test:m${index}`, displayName: `M${index}` })).unwrap(),
			),
		)
		const tooMany = await asAlice.post(`${EXT}/group`, {
			title: '',
			memberIds: crowd.map((user) => user.id),
		})
		expect(tooMany.body.error.key).toBe('messages.members_max')
	})

	it("hands a removed account's messages to Ghost", async () => {
		await using host = await createHost()
		const { core, alice, bob } = await setUp(host)
		const asAlice = client(host, alice.id)
		const id: string = (await asAlice.post(`${EXT}/start`, { userId: bob.id })).body.id
		await client(host, bob.id).post(`${EXT}/send`, { conversationId: id, body: 'bye' })
		;(await core.removeUser(bob.id)).unwrap()
		const detail = await asAlice.get(`${EXT}/get?id=${id}`)
		expect(detail.body.messages[0]).toMatchObject({
			body: 'bye',
			author: { id: await core.findGhostId() },
		})
		expect(detail.body.conversation.members.map((member: { id: string }) => member.id)).toEqual([
			alice.id,
		])
	})
})
