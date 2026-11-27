import { ForumApiPlugin } from '@pluxum/api'
import { ForumAuth, type Authentication } from '@pluxum/auth'
import { ForumCorePlugin } from '@pluxum/core'
import { Plugin } from '@pluxel/core'
import { pglite } from '@pluxel/services/pg/pglite'
import { elysia } from '@pluxel/services/elysia'
import { createTestHost } from '@pluxel/test'
import { describe, expect, it } from 'vitest'
import { DRAFTS_EXT_ID, DRAFTS_PER_USER, ForumDraftsPlugin } from '../src'

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
		services: [elysia(), pglite({ dataDir: 'memory://' })],
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

const EXT = `/ext/${DRAFTS_EXT_ID}`

async function setUp(host: Host) {
	await host.commit((change) => {
		change.start(ForumCorePlugin.nodeAddress())
		change.start(FakeAuth.nodeAddress())
		change.start(ForumApiPlugin.nodeAddress())
		change.start(ForumDraftsPlugin.nodeAddress())
	})
	const core = host.require(ForumCorePlugin.nodeAddress())
	const adminUser = (
		await core.ensureUser({ subject: 'test:admin', displayName: 'Admin' })
	).unwrap()
	;(await core.grantRole(adminUser.id, 'admin')).unwrap()
	const admin = await core.principalOf(adminUser.id)
	const alice = (await core.ensureUser({ subject: 'test:alice', displayName: 'Alice' })).unwrap()
	const bob = (await core.ensureUser({ subject: 'test:bob', displayName: 'Bob' })).unwrap()
	const general = (await core.createCategory(admin, { name: 'General', slug: 'general' })).unwrap()
	return { core, alice, bob, general }
}

describe('ForumDraftsPlugin', () => {
	it('keeps a draft per member and place, and removes a blank one', async () => {
		await using host = await createHost()
		const { alice, bob, general } = await setUp(host)
		const asAlice = client(host, alice.id)
		const key = `thread:${general.id}`

		expect((await asAlice.get(`${EXT}/get?key=${key}`)).body).toEqual({
			key,
			body: '',
			updatedAt: null,
		})
		const saved = await asAlice.post(`${EXT}/save`, { key, body: 'half a thought' })
		expect(saved.status).toBe(200)
		expect(saved.body).toMatchObject({ key, body: 'half a thought' })
		expect(typeof saved.body.updatedAt).toBe('string')
		expect((await asAlice.get(`${EXT}/get?key=${key}`)).body.body).toBe('half a thought')
		// Another member's drafts are their own.
		expect((await client(host, bob.id).get(`${EXT}/get?key=${key}`)).body.body).toBe('')

		await asAlice.post(`${EXT}/save`, { key, body: '  ' })
		expect((await asAlice.get(`${EXT}/get?key=${key}`)).body).toEqual({
			key,
			body: '',
			updatedAt: null,
		})
	})

	it('refuses guests and malformed keys', async () => {
		await using host = await createHost()
		const { alice } = await setUp(host)
		expect((await client(host).get(`${EXT}/get?key=note`)).status).toBe(401)
		expect(
			(await client(host, alice.id).post(`${EXT}/save`, { key: 'Bad Key', body: 'x' })).status,
		).toBe(422)
	})

	it('clears the drafts a thread or a reply used up', async () => {
		await using host = await createHost()
		const { core, alice, general } = await setUp(host)
		const asAlice = client(host, alice.id)
		const principal = await core.principalOf(alice.id)
		await asAlice.post(`${EXT}/save`, { key: 'topic', body: 'body' })
		await asAlice.post(`${EXT}/save`, { key: 'topic:title', body: 'title' })
		await asAlice.post(`${EXT}/save`, { key: 'note', body: 'a note' })
		const thread = (
			await core.createThread(principal, { categoryId: general.id, title: 'Out', body: 'Out body' })
		).unwrap()
		expect((await asAlice.get(`${EXT}/get?key=topic`)).body.body).toBe('')
		expect((await asAlice.get(`${EXT}/get?key=topic:title`)).body.body).toBe('')
		// A topic going out leaves the note being written.
		expect((await asAlice.get(`${EXT}/get?key=note`)).body.body).toBe('a note')

		await asAlice.post(`${EXT}/save`, { key: `reply:${thread.id}`, body: 'reply' })
		const reply = (
			await core.createPost(principal, { threadId: thread.id, body: 'reply' })
		).unwrap()
		expect((await asAlice.get(`${EXT}/get?key=reply:${thread.id}`)).body.body).toBe('')

		// Answering inside a floor uses up that floor's draft only.
		await asAlice.post(`${EXT}/save`, { key: `reply:${thread.id}`, body: 'next reply' })
		await asAlice.post(`${EXT}/save`, { key: `reply:${thread.id}:${reply.id}`, body: 'inner' })
		;(
			await core.createPost(principal, { threadId: thread.id, body: 'inner', parentId: reply.id })
		).unwrap()
		expect((await asAlice.get(`${EXT}/get?key=reply:${thread.id}:${reply.id}`)).body.body).toBe('')
		expect((await asAlice.get(`${EXT}/get?key=reply:${thread.id}`)).body.body).toBe('next reply')
	})

	it('keeps only the newest drafts of a member', async () => {
		await using host = await createHost()
		const { alice } = await setUp(host)
		const asAlice = client(host, alice.id)
		for (let index = 0; index <= DRAFTS_PER_USER; index++) {
			// oxlint-disable-next-line no-await-in-loop -- each save must be newer than the last.
			await asAlice.post(`${EXT}/save`, { key: `reply:k${index}`, body: `draft ${index}` })
		}
		expect((await asAlice.get(`${EXT}/get?key=reply:k0`)).body.body).toBe('')
		expect((await asAlice.get(`${EXT}/get?key=reply:k1`)).body.body).toBe('draft 1')
		expect((await asAlice.get(`${EXT}/get?key=reply:k${DRAFTS_PER_USER}`)).body.body).toBe(
			`draft ${DRAFTS_PER_USER}`,
		)
	})
})
