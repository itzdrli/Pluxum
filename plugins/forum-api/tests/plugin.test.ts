import type {
	CategoryDto,
	CategoryThreadsDto,
	MetaDto,
	PostDto,
	ThreadDetailDto,
	ThreadDto,
} from '@forum/domain'
import { ForumApiPlugin } from '@forum/forum-api'
import { ForumCorePlugin } from '@forum/forum-core'
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

const error = (code: string) => ({ error: { code, message: expect.any(String) } })

/** Starts the API acting as one development account with the given elevated roles. */
async function startAs(host: Host, roles: ('moderator' | 'admin')[]) {
	await host.start(ForumApiPlugin, {
		catalog: [ForumCorePlugin],
		initialConfig: {
			devIdentity: { enabled: true, subject: 'dev:test', displayName: 'Dev', roles },
		},
	})
}

function client(host: Host) {
	const call = async (method: string, path: string, payload?: unknown) => {
		const response = await host.http.fetch(
			new Request(new URL(`/api/forum${path}`, host.http.origin), {
				method,
				headers: payload === undefined ? undefined : { 'content-type': 'application/json' },
				body: payload === undefined ? undefined : JSON.stringify(payload),
			}),
		)
		const text = await response.text()
		// Parsed JSON stays untyped here; each test states the DTO it expects.
		const body = text ? JSON.parse(text) : undefined
		return { status: response.status, body }
	}
	return {
		call,
		/** Calls an endpoint that must succeed and returns its body. */
		async ok<T>(method: string, path: string, body?: unknown): Promise<T> {
			const response = await call(method, path, body)
			expect(response.status).toBeLessThan(300)
			const value: T = response.body
			return value
		},
	}
}

describe('ForumApiPlugin', () => {
	it('serves the read API to guests and refuses their writes', async () => {
		await using host = await createHost()
		await host.start(ForumApiPlugin, { catalog: [ForumCorePlugin] })
		const api = client(host)

		expect(await api.ok('GET', '/ping')).toMatchObject({ status: 'ok', service: 'forum-api' })
		const meta = await api.ok<MetaDto>('GET', '/meta')
		expect(meta.viewer).toEqual({
			user: null,
			roles: ['guest'],
			can: { manageCategories: false },
		})
		expect(meta.limits.threadTitleMax).toBeGreaterThan(0)
		expect(await api.ok('GET', '/categories')).toEqual({ items: [] })

		expect(await api.call('POST', '/categories', { name: 'General' })).toEqual({
			status: 401,
			body: { error: { code: 'unauthenticated', message: expect.any(String) } },
		})
		expect(
			await api.call('POST', '/threads', { categoryId: MISSING_ID, title: 't', body: 'b' }),
		).toMatchObject({ status: 401 })
	})

	it('runs the forum end to end as the development identity', async () => {
		await using host = await createHost()
		await startAs(host, ['admin'])
		const api = client(host)

		const meta = await api.ok<MetaDto>('GET', '/meta')
		expect(meta.viewer).toMatchObject({
			user: { displayName: 'Dev' },
			roles: ['member', 'admin'],
			can: { manageCategories: true },
		})

		const created = await api.call('POST', '/categories', { name: 'General', position: 1 })
		expect(created.status).toBe(201)
		const category: CategoryDto = created.body
		expect(category).toMatchObject({ slug: 'general', threadCount: 0 })

		const thread = await api.ok<ThreadDto>('POST', '/threads', {
			categoryId: category.id,
			title: 'Hello',
			body: 'First',
		})
		const reply = await api.ok<PostDto>('POST', `/threads/${thread.id}/posts`, { body: 'Second' })
		expect(reply).toMatchObject({ threadId: thread.id, body: 'Second' })

		const listing = await api.ok<CategoryThreadsDto>('GET', '/categories/general/threads')
		expect(listing.category).toMatchObject({ threadCount: 1, postCount: 2 })
		expect(listing.threads.items).toHaveLength(1)
		expect(listing.can.createThread).toBe(true)

		const firstPage = await api.ok<ThreadDetailDto>('GET', `/threads/${thread.id}?pageSize=1`)
		expect(firstPage.posts).toMatchObject({ page: 1, pageSize: 1, total: 2 })
		expect(firstPage.posts.items.map((post) => post.body)).toEqual(['First'])
		const secondPage = await api.ok<ThreadDetailDto>(
			'GET',
			`/threads/${thread.id}?page=2&pageSize=1`,
		)
		expect(secondPage.posts.items.map((post) => post.body)).toEqual(['Second'])

		expect(await api.ok<PostDto>('PATCH', `/posts/${reply.id}`, { body: 'Edited' })).toMatchObject({
			body: 'Edited',
		})
		expect(
			await api.ok<ThreadDto>('PATCH', `/threads/${thread.id}`, { title: 'Renamed', locked: true }),
		).toMatchObject({ title: 'Renamed', locked: true })
		expect(
			await api.ok<CategoryDto>('PATCH', `/categories/${category.id}`, { name: 'Lounge' }),
		).toMatchObject({ name: 'Lounge', slug: 'general' })

		expect(await api.call('DELETE', `/posts/${reply.id}`)).toEqual({ status: 204, body: undefined })
		expect((await api.call('DELETE', `/categories/${category.id}`)).status).toBe(409)
		expect((await api.call('DELETE', `/threads/${thread.id}`)).status).toBe(204)
		expect((await api.call('GET', `/threads/${thread.id}`)).status).toBe(404)
	})

	it('reports every failure in one error shape', async () => {
		await using host = await createHost()
		await startAs(host, [])
		const api = client(host)

		// A member without elevated roles cannot manage categories.
		expect(await api.call('POST', '/categories', { name: 'General' })).toEqual({
			status: 403,
			body: error('forbidden'),
		})
		expect(await api.call('GET', `/threads/${MISSING_ID}`)).toEqual({
			status: 404,
			body: error('not_found'),
		})
		expect(await api.call('GET', '/threads/not-an-id')).toMatchObject({ status: 404 })
		expect(await api.call('GET', '/categories/nope/threads')).toMatchObject({ status: 404 })
		// Schema violations and rule violations both come back as `invalid`.
		expect(await api.call('POST', '/threads', { title: 'no category' })).toEqual({
			status: 422,
			body: error('invalid'),
		})
		expect(await api.call('PATCH', `/posts/${MISSING_ID}`, { body: '   ' })).toEqual({
			status: 422,
			body: error('invalid'),
		})
	})

	it('withdraws its routes when stopped', async () => {
		await using host = await createHost()
		await host.start(ForumApiPlugin, { catalog: [ForumCorePlugin] })
		const api = client(host)
		expect((await api.call('GET', '/ping')).status).toBe(200)

		await host.stop(ForumApiPlugin)
		const response = await host.http.fetch(new URL('/api/forum/ping', host.http.origin))
		expect(response.status).toBe(404)
	})

	it('refuses to start with a development identity in production', async () => {
		const previous = process.env.NODE_ENV
		process.env.NODE_ENV = 'production'
		try {
			await using host = await createHost()
			const failure = await host.commitExpectFail((change) =>
				change.start(ForumApiPlugin, {
					catalog: [ForumCorePlugin],
					initialConfig: { devIdentity: { enabled: true } },
				}),
			)
			expect(failure.lifecycleReport.issues).toContainEqual(
				expect.objectContaining({ kind: 'start-failed' }),
			)
		} finally {
			process.env.NODE_ENV = previous
		}
	})
})
