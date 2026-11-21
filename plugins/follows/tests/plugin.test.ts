import type { ForumNotification, MetaDto, RecentThreadsDto, UserProfileDto } from '@pluxum/domain'
import { ForumApiPlugin } from '@pluxum/api'
import { ForumAuth, type Authentication } from '@pluxum/auth'
import { ForumCorePlugin } from '@pluxum/core'
import { BasePlugin, Plugin } from '@pluxel/core'
import { database } from '@pluxel/services/database'
import { pglite } from '@pluxel/services/database/pglite'
import { elysia } from '@pluxel/services/elysia'
import { createTestHost } from '@pluxel/test'
import { describe, expect, it } from 'vitest'
import { FOLLOW_GRAPH_ID, FOLLOWS_EXT_ID, followNoticeId, ForumFollowsPlugin } from '../src'

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

const EXT = `/ext/${FOLLOWS_EXT_ID}`

/**
 * Three members and two categories: Alice writes in General, Bob in Off-topic, Carol in both,
 * and Bob posts a note.
 */
async function setUp(host: Host) {
	delivered.length = 0
	await host.commit((change) => {
		change.start(ForumCorePlugin)
		change.start(FakeAuth)
		change.start(ForumApiPlugin)
		change.start(CollectingChannelPlugin)
		change.start(ForumFollowsPlugin)
	})
	const core = host.require(ForumCorePlugin)
	const adminUser = (
		await core.ensureUser({ subject: 'test:admin', displayName: 'Admin' })
	).unwrap()
	;(await core.grantRole(adminUser.id, 'admin')).unwrap()
	const admin = await core.principalOf(adminUser.id)
	const alice = (await core.ensureUser({ subject: 'test:alice', displayName: 'Alice' })).unwrap()
	const bob = (await core.ensureUser({ subject: 'test:bob', displayName: 'Bob' })).unwrap()
	const carol = (await core.ensureUser({ subject: 'test:carol', displayName: 'Carol' })).unwrap()
	const general = (await core.createCategory(admin, { name: 'General', slug: 'general' })).unwrap()
	const offTopic = (await core.createCategory(admin, { name: 'Off', slug: 'off' })).unwrap()
	const post = async (userId: string, categoryId: string, title: string) =>
		(
			await core.createThread(await core.principalOf(userId), {
				categoryId,
				title,
				body: `${title} body`,
			})
		).unwrap()
	const byAlice = await post(alice.id, general.id, 'Alice in General')
	const byBob = await post(bob.id, offTopic.id, 'Bob in Off')
	const byCarol = await post(carol.id, offTopic.id, 'Carol in Off')
	const stream = await core.streamFor(await core.principalOf(bob.id))
	const note = await post(bob.id, stream?.category.id ?? '', '')
	/** Titles (notes: `note`) of the 「关注」 feed as `userId` sees it. */
	const feed = async (userId?: string) => {
		const { status, body } = await client(host, userId).get('/threads?scope=following')
		expect(status).toBe(200)
		const page: RecentThreadsDto = body
		return page.items.map((item) => (item.kind === 'note' ? 'note' : item.title)).toSorted()
	}
	return { core, admin, alice, bob, carol, general, offTopic, byAlice, byBob, byCarol, note, feed }
}

describe('ForumFollowsPlugin', () => {
	it('builds the following feed from people and categories', async () => {
		await using host = await createHost()
		const { alice, bob, offTopic, feed } = await setUp(host)
		const asAlice = client(host, alice.id)

		// Following nothing yet: only one's own threads.
		expect(await feed(alice.id)).toEqual(['Alice in General'])
		expect(await feed()).toEqual([])

		expect(await asAlice.post(`${EXT}/follow`, { kind: 'user', id: bob.id, on: true })).toEqual({
			status: 200,
			body: { kind: 'user', id: bob.id, followed: true, followers: 1 },
		})
		expect(await feed(alice.id)).toEqual(['Alice in General', 'Bob in Off', 'note'])

		// A category by its slug works as well as by its ID.
		expect(
			(await asAlice.post(`${EXT}/follow`, { kind: 'category', id: 'off', on: true })).body,
		).toEqual({ kind: 'category', id: offTopic.id, followed: true, followers: 1 })
		expect(await feed(alice.id)).toEqual(['Alice in General', 'Bob in Off', 'Carol in Off', 'note'])

		await asAlice.post(`${EXT}/follow`, { kind: 'user', id: bob.id, on: false })
		// Bob's thread stays through the category; his note goes.
		expect(await feed(alice.id)).toEqual(['Alice in General', 'Bob in Off', 'Carol in Off'])
	})

	it('tells /meta whether the feed exists and whether the viewer follows anything', async () => {
		await using host = await createHost()
		const { alice, bob } = await setUp(host)
		const following = async (userId?: string) => {
			const meta: MetaDto = (await client(host, userId).get('/meta')).body
			return meta.viewer.following
		}
		expect(await following()).toEqual({ available: false, any: false })
		expect(await following(alice.id)).toEqual({ available: true, any: false })
		await client(host, alice.id).post(`${EXT}/follow`, { kind: 'user', id: bob.id, on: true })
		expect(await following(alice.id)).toEqual({ available: true, any: true })

		await host.stop(ForumFollowsPlugin)
		expect(await following(alice.id)).toEqual({ available: false, any: false })
	})

	it('puts counts on users and answers the state of a target', async () => {
		await using host = await createHost()
		const { alice, bob, carol } = await setUp(host)
		await client(host, alice.id).post(`${EXT}/follow`, { kind: 'user', id: bob.id, on: true })
		await client(host, carol.id).post(`${EXT}/follow`, { kind: 'user', id: bob.id, on: true })
		await client(host, bob.id).post(`${EXT}/follow`, { kind: 'user', id: alice.id, on: true })

		const profile = async (userId?: string) => {
			const found: UserProfileDto = (await client(host, userId).get(`/users/${bob.handle}`)).body
			return found.user.ext?.[FOLLOWS_EXT_ID]
		}
		expect(await profile(alice.id)).toEqual({ followers: 2, following: 1, followed: true })
		expect(await profile(bob.id)).toEqual({ followers: 2, following: 1, followed: false })
		expect(await profile()).toEqual({ followers: 2, following: 1, followed: false })

		expect((await client(host).get(`${EXT}/state?kind=user&id=${bob.id}`)).body).toEqual({
			kind: 'user',
			id: bob.id,
			followed: false,
			followers: 2,
		})
		expect(
			(await client(host, carol.id).get(`${EXT}/state?kind=user&id=${bob.handle}`)).body,
		).toMatchObject({ followed: true })
	})

	it('refuses guests, oneself, unknown targets and hidden categories', async () => {
		await using host = await createHost()
		const { core, alice, general } = await setUp(host)
		const asAlice = client(host, alice.id)

		expect(
			(await client(host).post(`${EXT}/follow`, { kind: 'user', id: alice.id, on: true })).status,
		).toBe(401)
		expect(
			(await asAlice.post(`${EXT}/follow`, { kind: 'user', id: alice.id, on: true })).status,
		).toBe(422)
		expect(
			(await asAlice.post(`${EXT}/follow`, { kind: 'group', id: alice.id, on: true })).status,
		).toBe(422)
		expect(
			(await asAlice.post(`${EXT}/follow`, { kind: 'user', id: 'nobody', on: true })).status,
		).toBe(404)

		const dispose = core.registerPermissionPolicy({
			id: 'test.hide-general',
			evaluate: ({ action, resource }) =>
				action === 'category.view' && resource.categoryId === general.id ? 'deny' : 'abstain',
		})
		expect(
			(await asAlice.post(`${EXT}/follow`, { kind: 'category', id: general.id, on: true })).status,
		).toBe(404)
		dispose()
	})

	it('notifies the person followed once per follower, unless they switched it off', async () => {
		await using host = await createHost()
		const { alice, bob, carol } = await setUp(host)
		const follow = (from: string, to: string, on: boolean) =>
			client(host, from).post(`${EXT}/follow`, { kind: 'user', id: to, on })

		await follow(alice.id, bob.id, true)
		await follow(alice.id, bob.id, true)
		expect(delivered).toEqual([
			expect.objectContaining({
				id: followNoticeId(alice.id, bob.id),
				recipientId: bob.id,
				kind: 'user.followed',
				title: 'Alice 关注了你',
				path: `/u/${alice.handle}`,
			}),
		])
		// Following again after unfollowing sends a notice with the same ID, which the inbox keeps once.
		await follow(alice.id, bob.id, false)
		await follow(alice.id, bob.id, true)
		expect(new Set(delivered.map((notice) => notice.id)).size).toBe(1)

		const asBob = client(host, bob.id)
		expect((await asBob.get(`${EXT}/settings`)).body).toEqual({ notify: true })
		expect((await asBob.post(`${EXT}/preference`, { notify: false })).body).toEqual({
			notify: false,
		})
		expect((await asBob.get(`${EXT}/settings`)).body).toEqual({ notify: false })
		delivered.length = 0
		await follow(carol.id, bob.id, true)
		expect(delivered).toEqual([])
	})

	it('withdraws the graph, data and slots when stopped and brings the follows back', async () => {
		await using host = await createHost()
		const { core, alice, bob, feed } = await setUp(host)
		await client(host, alice.id).post(`${EXT}/follow`, { kind: 'user', id: bob.id, on: true })
		expect(core.followGraphId()).toBe(FOLLOW_GRAPH_ID)

		await host.stop(ForumFollowsPlugin)
		expect(core.followGraphId()).toBeNull()
		expect(core.entityExtensionIds('user')).toEqual([])
		expect(core.uiSlots()).toEqual([])
		expect(await feed(alice.id)).toEqual([])

		await host.start(ForumFollowsPlugin)
		expect(await feed(alice.id)).toEqual(['Alice in General', 'Bob in Off', 'note'])
	})

	it('registers again after the core restarts', async () => {
		await using host = await createHost()
		const { alice, bob } = await setUp(host)
		await client(host, alice.id).post(`${EXT}/follow`, { kind: 'user', id: bob.id, on: true })
		const core = await host.restart(ForumCorePlugin)
		expect(host.isRunning(ForumFollowsPlugin)).toBe(true)
		expect(core.followGraphId()).toBe(FOLLOW_GRAPH_ID)
		expect(core.uiSlots().map((entry) => entry.slot)).toEqual([
			'category.header',
			'user.header',
			'user.profile.tabs',
		])
	})
})
