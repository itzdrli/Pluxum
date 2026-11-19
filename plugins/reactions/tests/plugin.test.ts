import type { MetaDto, PostDto, ThreadDetailDto } from '@pluxum/domain'
import { ForumApiPlugin } from '@pluxum/api'
import { ForumAuth, type Authentication } from '@pluxum/auth'
import { ForumCorePlugin } from '@pluxum/core'
import { ForumReactionsPlugin, REACTIONS_EXT_ID } from '@pluxum/reactions'
import { Plugin } from '@pluxel/core'
import { database } from '@pluxel/services/database'
import { pglite } from '@pluxel/services/database/pglite'
import { elysia } from '@pluxel/services/elysia'
import { createTestHost } from '@pluxel/test'
import { describe, expect, it, onTestFinished, vi } from 'vitest'

const MISSING_ID = '00000000-0000-4000-8000-000000000000'

const createHost = () =>
	createTestHost({
		services: [elysia(), database({ backend: pglite({ dataDir: 'memory://' }) })],
	})

type Host = Awaited<ReturnType<typeof createHost>>

/**
 * Stand-in identity provider: the `x-test-user` header names the account a request acts as. Only
 * what the API needs to resolve a caller is implemented; the real flows are tested in forum-auth.
 */
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

	override testLoginAvailable(): boolean {
		return false
	}

	override testLogin(): never {
		throw new Error('not used')
	}
}

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

/** The forum with reactions running, two members, and a thread with one reply by Bob. */
async function setUp(host: Host) {
	await host.commit((change) => {
		change.start(ForumCorePlugin)
		change.start(FakeAuth)
		change.start(ForumApiPlugin)
		change.start(ForumReactionsPlugin)
	})
	const core = host.require(ForumCorePlugin)
	const adminUser = (
		await core.ensureUser({ subject: 'test:admin', displayName: 'Admin' })
	).unwrap()
	;(await core.grantRole(adminUser.id, 'admin')).unwrap()
	const admin = await core.principalOf(adminUser.id)
	const alice = (await core.ensureUser({ subject: 'test:alice', displayName: 'Alice' })).unwrap()
	const bob = (await core.ensureUser({ subject: 'test:bob', displayName: 'Bob' })).unwrap()
	const category = (await core.createCategory(admin, { name: 'General' })).unwrap()
	const thread = (
		await core.createThread(await core.principalOf(alice.id), {
			categoryId: category.id,
			title: 'Likes',
			body: 'opening',
		})
	).unwrap()
	const reply = (
		await core.createPost(await core.principalOf(bob.id), { threadId: thread.id, body: 'reply' })
	).unwrap()
	/** The reactions data of every post of the thread, in order, as the given caller sees it. */
	const summaries = async (userId?: string) => {
		const { status, body } = await client(host, userId).get(`/threads/${thread.id}`)
		expect(status).toBe(200)
		const detail: ThreadDetailDto = body
		return detail.posts.items.map((post: PostDto) => post.ext[REACTIONS_EXT_ID])
	}
	return { core, admin, alice, bob, thread, reply, summaries }
}

const REACT = `/ext/${REACTIONS_EXT_ID}/react`

/** A post's summary with `count` likes (the viewer's among them when `reacted`) and no 「有用」. */
const like = (count: number, reacted: boolean) => ({
	count,
	reacted,
	useful: { count: 0, reacted: false },
})

describe('ForumReactionsPlugin', () => {
	it('counts likes per post and tells each viewer which are theirs', async () => {
		await using host = await createHost()
		const { alice, bob, reply, summaries } = await setUp(host)
		const none = like(0, false)
		expect(await summaries()).toEqual([none, none])

		expect(await client(host, alice.id).post(REACT, { postId: reply.id, on: true })).toEqual({
			status: 200,
			body: like(1, true),
		})
		// Repeating the call changes nothing: it sets a state, it does not toggle.
		expect((await client(host, alice.id).post(REACT, { postId: reply.id, on: true })).body).toEqual(
			like(1, true),
		)
		expect((await client(host, bob.id).post(REACT, { postId: reply.id, on: true })).body).toEqual(
			like(2, true),
		)

		expect(await summaries(alice.id)).toEqual([none, like(2, true)])
		expect(await summaries()).toEqual([none, like(2, false)])

		expect(
			(await client(host, alice.id).post(REACT, { postId: reply.id, on: false })).body,
		).toEqual(like(1, false))
		expect(
			(await client(host, alice.id).post(REACT, { postId: reply.id, on: false })).body,
		).toEqual(like(1, false))
		expect(await summaries(alice.id)).toEqual([none, like(1, false)])
		expect(await summaries(bob.id)).toEqual([none, like(1, true)])
	})

	it("counts 「有用」 apart from likes and weighs both into the thread's heat", async () => {
		// What the plugin hands the core's heat counter, summed per thread. On the prototype and
		// before the host starts: the plugin reaches the core through a view of its methods.
		const adjust = vi.spyOn(ForumCorePlugin.prototype, 'adjustEngagement')
		onTestFinished(() => adjust.mockRestore())
		await using host = await createHost()
		const { alice, bob, thread, reply, summaries } = await setUp(host)
		const heat = () =>
			adjust.mock.calls
				.filter(([threadId]) => threadId === thread.id)
				.reduce((sum, [, delta]) => sum + delta, 0)
		const asAlice = client(host, alice.id)

		expect(
			(await asAlice.post(REACT, { postId: reply.id, kind: 'useful', on: true })).body,
		).toEqual({
			count: 0,
			reacted: false,
			useful: { count: 1, reacted: true },
		})
		await asAlice.post(REACT, { postId: reply.id, on: true })
		await client(host, bob.id).post(REACT, { postId: reply.id, kind: 'useful', on: true })
		expect((await summaries(alice.id))[1]).toEqual({
			count: 1,
			reacted: true,
			useful: { count: 2, reacted: true },
		})
		expect((await summaries())[1]).toEqual({
			count: 1,
			reacted: false,
			useful: { count: 2, reacted: false },
		})
		// 1 like (weight 1) and 2 「有用」 (weight 3 each).
		expect(heat()).toBe(7)

		await asAlice.post(REACT, { postId: reply.id, kind: 'useful', on: false })
		await asAlice.post(REACT, { postId: reply.id, kind: 'useful', on: false })
		// Withdrawing twice takes the points back once.
		expect(heat()).toBe(4)
		expect((await asAlice.post(REACT, { postId: reply.id, kind: 'love', on: true })).status).toBe(
			422,
		)
	})

	it('refuses guests, bad input and posts that cannot be seen', async () => {
		await using host = await createHost()
		const { core, alice, bob, reply } = await setUp(host)
		const asAlice = client(host, alice.id)

		expect((await client(host).post(REACT, { postId: reply.id, on: true })).status).toBe(401)
		expect((await asAlice.post(REACT, { postId: reply.id })).status).toBe(422)
		expect((await asAlice.post(REACT, { postId: MISSING_ID, on: true })).status).toBe(404)
		expect((await asAlice.post(REACT, { postId: 'not-an-id', on: true })).status).toBe(404)
		;(await core.deletePost(await core.principalOf(bob.id), reply.id)).unwrap()
		expect((await asAlice.post(REACT, { postId: reply.id, on: true })).status).toBe(404)
	})

	it('follows the permission chain of the forum core', async () => {
		await using host = await createHost()
		const { core, alice, reply } = await setUp(host)
		const dispose = core.registerPermissionPolicy({
			id: 'test.no-reactions',
			evaluate: ({ action }) => (action === 'post.react' ? 'deny' : 'abstain'),
		})

		expect((await client(host, alice.id).post(REACT, { postId: reply.id, on: true })).status).toBe(
			403,
		)
		dispose()
		expect((await client(host, alice.id).post(REACT, { postId: reply.id, on: true })).status).toBe(
			200,
		)
	})

	it('withdraws its data, slot and action when stopped and brings the likes back', async () => {
		await using host = await createHost()
		const { core, alice, reply, summaries } = await setUp(host)
		const asAlice = client(host, alice.id)
		const slots = async () => {
			const meta: MetaDto = (await asAlice.get('/meta')).body
			return meta.uiSlots
		}
		await asAlice.post(REACT, { postId: reply.id, on: true })
		expect(await slots()).toEqual([{ slot: 'post.footer', extId: REACTIONS_EXT_ID }])

		await host.stop(ForumReactionsPlugin)
		expect(await slots()).toEqual([])
		expect(core.entityExtensionIds('post')).toEqual([])
		expect(await summaries(alice.id)).toEqual([undefined, undefined])
		expect((await asAlice.post(REACT, { postId: reply.id, on: false })).status).toBe(404)

		await host.start(ForumReactionsPlugin)
		expect(await slots()).toHaveLength(1)
		expect(await summaries(alice.id)).toEqual([like(0, false), like(1, true)])
	})

	it('registers again after the core or the API restarts', async () => {
		await using host = await createHost()
		const { alice, reply, summaries } = await setUp(host)
		await client(host, alice.id).post(REACT, { postId: reply.id, on: true })

		await host.restart(ForumApiPlugin)
		expect(host.isRunning(ForumReactionsPlugin)).toBe(true)
		expect((await client(host, alice.id).post(REACT, { postId: reply.id, on: true })).status).toBe(
			200,
		)

		const core = await host.restart(ForumCorePlugin)
		expect(host.isRunning(ForumReactionsPlugin)).toBe(true)
		expect(core.entityExtensionIds('post')).toEqual([REACTIONS_EXT_ID])
		expect(core.uiSlots()).toEqual([{ slot: 'post.footer', extId: REACTIONS_EXT_ID }])
		expect((await summaries(alice.id))[1]).toEqual(like(1, true))
	})
})
