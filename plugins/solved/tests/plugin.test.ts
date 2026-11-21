import type { ForumNotification, MetaDto, RecentThreadsDto, ThreadDetailDto } from '@pluxum/domain'
import { ForumApiPlugin } from '@pluxum/api'
import { ForumAuth, type Authentication } from '@pluxum/auth'
import { ForumCorePlugin } from '@pluxum/core'
import { BasePlugin, Plugin } from '@pluxel/core'
import { database } from '@pluxel/services/database'
import { pglite } from '@pluxel/services/database/pglite'
import { elysia } from '@pluxel/services/elysia'
import { createTestHost } from '@pluxel/test'
import { describe, expect, it } from 'vitest'
import { acceptNoticeId, excerptOf, ForumSolvedPlugin, SOLVED_EXT_ID } from '../src'

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

const ACCEPT = `/ext/${SOLVED_EXT_ID}/accept`

/** Alice asks in a topic; Bob and Carol answer. Bob also writes a note. A moderator is around. */
async function setUp(host: Host) {
	delivered.length = 0
	await host.commit((change) => {
		change.start(ForumCorePlugin)
		change.start(FakeAuth)
		change.start(ForumApiPlugin)
		change.start(CollectingChannelPlugin)
		change.start(ForumSolvedPlugin)
	})
	const core = host.require(ForumCorePlugin)
	const adminUser = (
		await core.ensureUser({ subject: 'test:admin', displayName: 'Admin' })
	).unwrap()
	;(await core.grantRole(adminUser.id, 'admin')).unwrap()
	const admin = await core.principalOf(adminUser.id)
	const mod = (await core.ensureUser({ subject: 'test:mod', displayName: 'Mod' })).unwrap()
	;(await core.grantRole(mod.id, 'moderator')).unwrap()
	const alice = (await core.ensureUser({ subject: 'test:alice', displayName: 'Alice' })).unwrap()
	const bob = (await core.ensureUser({ subject: 'test:bob', displayName: 'Bob' })).unwrap()
	const carol = (await core.ensureUser({ subject: 'test:carol', displayName: 'Carol' })).unwrap()
	const category = (await core.createCategory(admin, { name: 'Help', slug: 'help' })).unwrap()
	const asAliceCore = await core.principalOf(alice.id)
	const thread = (
		await core.createThread(asAliceCore, {
			categoryId: category.id,
			title: 'How?',
			body: 'question',
		})
	).unwrap()
	const reply = async (userId: string, body: string) =>
		(await core.createPost(await core.principalOf(userId), { threadId: thread.id, body })).unwrap()
	const bobAnswer = await reply(bob.id, '**Use** the [docs](https://example.com).')
	const carolAnswer = await reply(carol.id, 'Try again.')
	const stream = await core.streamFor(await core.principalOf(bob.id))
	const note = (
		await core.createThread(await core.principalOf(bob.id), {
			categoryId: stream?.category.id ?? '',
			title: '',
			body: 'a note',
		})
	).unwrap()
	const noteReply = (
		await core.createPost(asAliceCore, { threadId: note.id, body: 'nice' })
	).unwrap()
	/** The thread page as `userId` sees it: the thread's answer and which posts are accepted. */
	const page = async (userId?: string) => {
		const { status, body } = await client(host, userId).get(`/threads/${thread.id}`)
		expect(status).toBe(200)
		const detail: ThreadDetailDto = body
		return {
			solution: detail.thread.ext[SOLVED_EXT_ID],
			accepted: detail.posts.items
				.filter((post) => post.ext[SOLVED_EXT_ID] !== undefined)
				.map((post) => post.number),
		}
	}
	return { core, mod, alice, bob, carol, thread, bobAnswer, carolAnswer, note, noteReply, page }
}

describe('excerptOf', () => {
	it('keeps the words and drops the markup', () => {
		expect(excerptOf('# Title\n\n**Use** the [docs](https://x.y) and `npm`.\n\n![](a.png)')).toBe(
			'Title Use the docs and npm.',
		)
		expect(excerptOf('字'.repeat(130))).toBe(`${'字'.repeat(120)}…`)
	})
})

describe('ForumSolvedPlugin', () => {
	it('lets the asker accept one answer, replace it and withdraw it', async () => {
		await using host = await createHost()
		const { alice, bob, bobAnswer, carolAnswer, page } = await setUp(host)
		const asAlice = client(host, alice.id)
		expect(await page()).toEqual({ solution: undefined, accepted: [] })

		expect(await asAlice.post(ACCEPT, { postId: bobAnswer.id, on: true })).toEqual({
			status: 200,
			body: { threadId: bobAnswer.threadId, postId: bobAnswer.id },
		})
		expect(await page()).toEqual({
			solution: {
				postId: bobAnswer.id,
				floor: 2,
				excerpt: 'Use the docs.',
				author: { id: bob.id, handle: bob.handle, displayName: 'Bob' },
				acceptedAt: expect.any(String),
			},
			accepted: [2],
		})

		// Accepting another answer replaces the first; there is one answer per thread.
		await asAlice.post(ACCEPT, { postId: carolAnswer.id, on: true })
		expect((await page()).accepted).toEqual([3])
		// Withdrawing a post that is not the answer leaves the answer alone.
		expect((await asAlice.post(ACCEPT, { postId: bobAnswer.id, on: false })).body).toEqual({
			threadId: bobAnswer.threadId,
			postId: carolAnswer.id,
		})
		expect((await asAlice.post(ACCEPT, { postId: carolAnswer.id, on: false })).body).toEqual({
			threadId: bobAnswer.threadId,
			postId: null,
		})
		expect(await page()).toEqual({ solution: undefined, accepted: [] })
	})

	it('shows the badge in thread lists', async () => {
		await using host = await createHost()
		const { alice, thread, bobAnswer } = await setUp(host)
		await client(host, alice.id).post(ACCEPT, { postId: bobAnswer.id, on: true })
		const recent: RecentThreadsDto = (await client(host).get('/threads')).body
		const listed = recent.items.find((item) => item.id === thread.id)
		expect(listed?.ext[SOLVED_EXT_ID]).toMatchObject({ postId: bobAnswer.id, floor: 2 })
	})

	it('allows moderators and refuses everyone else, the opening post and notes', async () => {
		await using host = await createHost()
		const { core, mod, alice, bob, thread, bobAnswer, noteReply } = await setUp(host)

		expect((await client(host).post(ACCEPT, { postId: bobAnswer.id, on: true })).status).toBe(401)
		expect(
			(await client(host, bob.id).post(ACCEPT, { postId: bobAnswer.id, on: true })).status,
		).toBe(403)
		expect(
			(await client(host, mod.id).post(ACCEPT, { postId: bobAnswer.id, on: true })).status,
		).toBe(200)

		const detail = (await core.getThread(await core.principalOf(alice.id), thread.id)).unwrap()
		const opening = detail.posts.items[0]?.id ?? ''
		expect((await client(host, alice.id).post(ACCEPT, { postId: opening, on: true })).status).toBe(
			422,
		)
		// Bob wrote the note, so he may accept in it, but notes have no answers.
		expect(
			(await client(host, bob.id).post(ACCEPT, { postId: noteReply.id, on: true })).status,
		).toBe(422)
		expect(
			(await client(host, alice.id).post(ACCEPT, { postId: 'not-an-id', on: true })).status,
		).toBe(404)
	})

	it('notifies the answer author once, and not when people accept their own reply', async () => {
		await using host = await createHost()
		const { core, alice, bob, thread, bobAnswer } = await setUp(host)
		const asAlice = client(host, alice.id)
		await asAlice.post(ACCEPT, { postId: bobAnswer.id, on: true })
		await asAlice.post(ACCEPT, { postId: bobAnswer.id, on: true })
		expect(delivered).toEqual([
			expect.objectContaining({
				id: acceptNoticeId(bobAnswer.id),
				recipientId: bob.id,
				kind: 'post.accepted',
				title: 'Alice 采纳了你的回答',
				body: 'Use the docs.',
				path: `/t/${thread.ref}/2`,
			}),
		])

		delivered.length = 0
		const own = (
			await core.createPost(await core.principalOf(alice.id), {
				threadId: thread.id,
				body: 'Solved it myself',
			})
		).unwrap()
		await asAlice.post(ACCEPT, { postId: own.id, on: true })
		expect(delivered).toEqual([])
	})

	it('follows edits and forgets answers whose post is deleted', async () => {
		await using host = await createHost()
		const { core, alice, bob, bobAnswer, page } = await setUp(host)
		await client(host, alice.id).post(ACCEPT, { postId: bobAnswer.id, on: true })
		const asBob = await core.principalOf(bob.id)

		;(await core.updatePost(asBob, bobAnswer.id, { body: 'Read the *manual*.' })).unwrap()
		expect((await page()).solution).toMatchObject({ excerpt: 'Read the manual.' })

		;(await core.deletePost(asBob, bobAnswer.id)).unwrap()
		expect(await page()).toEqual({ solution: undefined, accepted: [] })
	})

	it('withdraws its data, slots and action when stopped and brings the answers back', async () => {
		await using host = await createHost()
		const { core, alice, bobAnswer, page } = await setUp(host)
		await client(host, alice.id).post(ACCEPT, { postId: bobAnswer.id, on: true })
		const slots = async () => {
			const meta: MetaDto = (await client(host).get('/meta')).body
			return meta.uiSlots.map((entry) => entry.slot)
		}
		expect(await slots()).toEqual(['post.footer', 'post.actions', 'post.after', 'thread.badges'])

		await host.stop(ForumSolvedPlugin)
		expect(await slots()).toEqual([])
		expect(core.entityExtensionIds('thread')).toEqual([])
		expect(core.postHookIds()).toEqual([])
		expect(await page()).toEqual({ solution: undefined, accepted: [] })
		expect(
			(await client(host, alice.id).post(ACCEPT, { postId: bobAnswer.id, on: false })).status,
		).toBe(404)

		await host.start(ForumSolvedPlugin)
		expect((await page()).accepted).toEqual([2])
	})
})
