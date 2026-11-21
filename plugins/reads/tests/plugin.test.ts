import type { RecentThreadsDto, ThreadDto } from '@pluxum/domain'
import { ForumApiPlugin } from '@pluxum/api'
import { ForumAuth, type Authentication } from '@pluxum/auth'
import { ForumCorePlugin } from '@pluxum/core'
import { ForumReadsPlugin, READS_EXT_ID } from '@pluxum/reads'
import { Plugin } from '@pluxel/core'
import { database } from '@pluxel/services/database'
import { pglite } from '@pluxel/services/database/pglite'
import { elysia } from '@pluxel/services/elysia'
import { createTestHost } from '@pluxel/test'
import { describe, expect, it } from 'vitest'

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

/** A thread's `forum-reads` data, or undefined when the thread carries none. */
function readStateOf(value: unknown): { readThrough: string } | undefined {
	if (typeof value !== 'object' || value === null || !('readThrough' in value)) return undefined
	return typeof value.readThrough === 'string' ? { readThrough: value.readThrough } : undefined
}

/** The forum with reads running, a member who has looked at the list, and a thread by Alice. */
async function setUp(host: Host) {
	await host.commit((change) => {
		change.start(ForumCorePlugin)
		change.start(FakeAuth)
		change.start(ForumApiPlugin)
		change.start(ForumReadsPlugin)
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
			title: 'Reads',
			body: 'opening',
		})
	).unwrap()
	/** The thread as the given caller sees it in the list: its read state and whether it is unread. */
	const listed = async (userId?: string) => {
		const { status, body } = await client(host, userId).get('/threads')
		expect(status).toBe(200)
		const page: RecentThreadsDto = body
		const found = page.items.find((item: ThreadDto) => item.id === thread.id)
		const state = readStateOf(found?.ext[READS_EXT_ID])
		return {
			state,
			unread: state !== undefined && found !== undefined && found.lastPostAt > state.readThrough,
		}
	}
	return { core, alice, bob, thread, listed }
}

const MARK = `/ext/${READS_EXT_ID}/mark`

describe('ForumReadsPlugin', () => {
	it('gives guests nothing and treats what happened before a member first looked as read', async () => {
		await using host = await createHost()
		const { bob, listed } = await setUp(host)
		expect((await listed()).state).toBeUndefined()
		// Bob never read this thread, but it is older than his first look at a list.
		const first = await listed(bob.id)
		expect(first.state?.readThrough).toBeDefined()
		expect(first.unread).toBe(false)
	})

	it('flags a thread that moves on after the member has seen it, until they read it', async () => {
		await using host = await createHost()
		const { core, alice, bob, thread, listed } = await setUp(host)
		expect((await listed(bob.id)).unread).toBe(false)

		;(
			await core.createPost(await core.principalOf(alice.id), { threadId: thread.id, body: 'news' })
		).unwrap()
		expect((await listed(bob.id)).unread).toBe(true)

		const marked = await client(host, bob.id).post(MARK, { threadId: thread.id })
		expect(marked.status).toBe(200)
		expect(marked.body.readThrough).toEqual(expect.any(String))
		expect((await listed(bob.id)).unread).toBe(false)
		// Marking again only moves the position forward and answers the same way.
		expect((await client(host, bob.id).post(MARK, { threadId: thread.id })).status).toBe(200)
		expect((await listed(bob.id)).unread).toBe(false)

		// Alice's own view is not Bob's: her position is separate.
		;(
			await core.createPost(await core.principalOf(bob.id), { threadId: thread.id, body: 'hi' })
		).unwrap()
		expect((await listed(bob.id)).unread).toBe(true)
	})

	it('refuses guests, bad input and threads that cannot be seen', async () => {
		await using host = await createHost()
		const { core, alice, bob, thread } = await setUp(host)
		const asBob = client(host, bob.id)
		expect((await client(host).post(MARK, { threadId: thread.id })).status).toBe(401)
		expect((await asBob.post(MARK, {})).status).toBe(422)
		expect((await asBob.post(MARK, { threadId: MISSING_ID })).status).toBe(404)
		expect((await asBob.post(MARK, { threadId: 'not-an-id' })).status).toBe(404)
		;(await core.deleteThread(await core.principalOf(alice.id), thread.id)).unwrap()
		expect((await asBob.post(MARK, { threadId: thread.id })).status).toBe(404)
	})

	it('stops marking and answering when the plugin stops', async () => {
		await using host = await createHost()
		const { bob, thread, listed } = await setUp(host)
		await host.stop(ForumReadsPlugin)
		expect((await listed(bob.id)).state).toBeUndefined()
		expect((await client(host, bob.id).post(MARK, { threadId: thread.id })).status).toBe(404)
	})
})
