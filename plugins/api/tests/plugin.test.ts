import type {
	CategoryDto,
	CategoryThreadsDto,
	MetaDto,
	PostDto,
	PreviewDto,
	RecentThreadsDto,
	SearchPageDto,
	ThreadDetailDto,
	ThreadDto,
	UserDto,
	UserProfileDto,
} from '@pluxum/domain'
import { ForumApiPlugin } from '@pluxum/api'
import { ForumAuth, type Authentication, type Logout } from '@pluxum/auth'
import { ForumCorePlugin } from '@pluxum/core'
import { BasePlugin, Plugin } from '@pluxel/core'
import { Result } from '@pluxel/core/better-result'
import { database } from '@pluxel/services/database'
import { pglite } from '@pluxel/services/database/pglite'
import { elysia } from '@pluxel/services/elysia'
import { createTestHost } from '@pluxel/test'
import { Type } from 'typebox'
import { describe, expect, it } from 'vitest'

const MISSING_ID = '00000000-0000-4000-8000-000000000000'

const createHost = () =>
	createTestHost({
		services: [elysia(), database({ backend: pglite({ dataDir: 'memory://' }) })],
	})

type Host = Awaited<ReturnType<typeof createHost>>

const error = (code: string) => ({ error: { code, message: expect.any(String) } })

const ORIGIN = 'https://forum.test'
const CLEARED: Logout = { setCookie: 'session=; Max-Age=0', providerUrl: null }

/**
 * Stand-in identity provider: the `x-test-user` header names the account a request acts as
 * (`down` plays a session store that cannot be reached). The real flows are tested in forum-auth.
 */
@Plugin(ForumAuth)
class FakeAuth extends ForumAuth {
	override loginAvailable(): boolean {
		return true
	}

	override authenticate(request: Request): Promise<Authentication> {
		const user = request.headers.get('x-test-user')
		if (user === null) return Promise.resolve({ status: 'guest' })
		if (user === 'down') return Promise.resolve({ status: 'unavailable' })
		return Promise.resolve({ status: 'authenticated', userId: user })
	}

	override allowsOrigin(request: Request): boolean {
		const origin = request.headers.get('origin')
		return origin === null || origin === ORIGIN
	}

	override beginLogin(returnTo: string | null) {
		return Promise.resolve(Result.ok(`https://idp.test/authorize?returnTo=${returnTo}`))
	}

	override completeLogin(request: Request) {
		return Promise.resolve(
			new URL(request.url).searchParams.has('code')
				? Result.ok({ returnTo: '/t/42', setCookie: 'session=abc; HttpOnly' })
				: Result.err({ code: 'rejected' as const, message: '登录已取消' }),
		)
	}

	override logout(): Promise<Logout> {
		return Promise.resolve(CLEARED)
	}

	override async logoutEverywhere(request: Request) {
		const authentication = await this.authenticate(request)
		return authentication.status === 'authenticated'
			? Result.ok(CLEARED)
			: Result.err({ code: 'unauthenticated' as const, message: '请先登录' })
	}

	override revokeUserSessions(): Promise<number> {
		return Promise.resolve(0)
	}

	override backchannelLogout(logoutToken: string) {
		return Promise.resolve(
			logoutToken === 'valid'
				? Result.ok(1)
				: Result.err({ code: 'rejected' as const, message: 'Invalid logout token' }),
		)
	}

	/** Toggled by a test to play a configured token hash. */
	static testLoginOn = false

	override testLoginAvailable(): boolean {
		return FakeAuth.testLoginOn
	}

	override testLogin(token: string | null, input: { name: string; admin?: boolean }) {
		return Promise.resolve(
			token === 'good'
				? Result.ok({ userId: `test-${input.name}`, setCookie: 'forum_session=abc; Path=/' })
				: Result.err({ code: 'rejected' as const, message: 'bad token' }),
		)
	}
}

/** An extension with three actions behind the ext ingress, to observe its contract. */
@Plugin()
class EchoExtPlugin extends BasePlugin {
	constructor(private readonly api: ForumApiPlugin) {
		super()
	}

	protected override init(): void {
		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: 'test-echo',
				action: 'shout',
				method: 'POST',
				login: true,
				input: Type.Object({ text: Type.String({ maxLength: 10 }) }),
				output: Type.Object({ text: Type.String(), by: Type.String() }),
				handle: ({ principal, input }) => {
					if (input.text === 'taken') {
						return Promise.resolve(Result.err({ code: 'conflict' as const, message: '已存在' }))
					}
					// `internal` is not part of the output schema and must not reach the caller.
					const answer = {
						text: input.text.toUpperCase(),
						by: principal.userId ?? '',
						internal: 'server only',
					}
					return Promise.resolve(Result.ok(answer))
				},
			}),
		)
		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: 'test-echo',
				action: 'whoami',
				method: 'GET',
				login: false,
				input: Type.Object({ tag: Type.Optional(Type.String()) }),
				output: Type.Object({ roles: Type.Array(Type.String()), tag: Type.String() }),
				handle: ({ principal, input }) =>
					Promise.resolve(Result.ok({ roles: [...principal.roles], tag: input.tag ?? '' })),
			}),
		)
		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: 'test-echo',
				action: 'broken',
				method: 'GET',
				login: false,
				input: Type.Object({}),
				output: Type.Object({ count: Type.Number() }),
				// @ts-expect-error -- deliberately answers outside its own output schema
				handle: () => Promise.resolve(Result.ok({ count: 'many' })),
			}),
		)
	}
}

/** Takes a path that the echo extension already serves, which must fail its own start only. */
@Plugin()
class DuplicateExtPlugin extends BasePlugin {
	constructor(private readonly api: ForumApiPlugin) {
		super()
	}

	protected override init(): void {
		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: 'test-echo',
				action: 'whoami',
				method: 'GET',
				login: false,
				input: Type.Object({}),
				output: Type.Object({}),
				handle: () => Promise.resolve(Result.ok({})),
			}),
		)
	}
}

@Plugin()
class SimpleSearchPlugin extends BasePlugin {
	constructor(private readonly core: ForumCorePlugin) {
		super()
	}

	protected override init(): void {
		this.ctx.effects.defer(
			this.core.registerSearchProvider({
				id: 'test.search',
				search: async (query) => {
					const posts = await this.core.listIndexablePosts()
					const items = posts
						.filter(
							(post) =>
								query.categoryIds.includes(post.categoryId) &&
								(!query.threadsOnly || post.opening) &&
								`${post.threadTitle} ${post.body}`.includes(query.query),
						)
						.map((post) => ({
							postId: post.postId,
							threadId: post.threadId,
							categoryId: post.categoryId,
							authorId: post.authorId,
							opening: post.opening,
							title: post.threadTitle,
							snippetHtml: `<mark>${query.query}</mark>`,
							createdAt: post.createdAt,
						}))
					return { items, total: items.length }
				},
			}),
		)
	}
}

async function start(host: Host) {
	await host.commit((change) => {
		change.start(ForumCorePlugin)
		change.start(FakeAuth)
		change.start(ForumApiPlugin)
	})
}

/** Starts the API and returns a client acting as a new account with the given elevated roles. */
async function startAs(host: Host, roles: ('moderator' | 'admin')[]) {
	await start(host)
	const core = host.require(ForumCorePlugin)
	const user = (await core.ensureUser({ subject: 'test:user', displayName: 'Dev' })).unwrap()
	await Promise.all(roles.map((role) => core.grantRole(user.id, role)))
	return client(host, { 'x-test-user': user.id })
}

function client(host: Host, identity: Record<string, string> = {}) {
	const send = (
		method: string,
		path: string,
		payload?: unknown,
		headers: Record<string, string> = {},
	) =>
		host.http.fetch(
			new Request(new URL(`/api/forum${path}`, host.http.origin), {
				method,
				headers: {
					...identity,
					...(payload === undefined ? {} : { 'content-type': 'application/json' }),
					...headers,
				},
				body: payload === undefined ? undefined : JSON.stringify(payload),
				redirect: 'manual',
			}),
		)
	const call = async (
		method: string,
		path: string,
		payload?: unknown,
		headers?: Record<string, string>,
	) => {
		const response = await send(method, path, payload, headers)
		const text = await response.text()
		// Parsed JSON stays untyped here; each test states the DTO it expects.
		const body = text ? JSON.parse(text) : undefined
		return { status: response.status, body }
	}
	return {
		send,
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

/** Where a response redirects to and which cookie it sets. */
async function redirected(response: Promise<Response>) {
	const { status, headers } = await response
	return { status, location: headers.get('location'), cookie: headers.get('set-cookie') }
}

describe('ForumApiPlugin', () => {
	it('serves the read API to guests and refuses their writes', async () => {
		await using host = await createHost()
		await start(host)
		const api = client(host)

		expect(await api.ok('GET', '/ping')).toMatchObject({ status: 'ok', service: 'forum-api' })
		const meta = await api.ok<MetaDto>('GET', '/meta')
		expect(meta.viewer).toEqual({
			user: null,
			roles: ['guest'],
			can: { manageCategories: false },
		})
		expect(meta.auth).toEqual({ loginAvailable: true })
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

	it('runs the forum end to end as a logged-in admin', async () => {
		await using host = await createHost()
		const api = await startAs(host, ['admin'])

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
		expect(thread).toMatchObject({
			number: 1001,
			slug: 'hello',
			ref: '1001-hello',
		})
		const reply = await api.ok<PostDto>('POST', `/threads/${thread.ref}/posts`, { body: 'Second' })
		expect(reply).toMatchObject({ threadId: thread.id, number: 2, body: 'Second' })

		const listing = await api.ok<CategoryThreadsDto>('GET', '/categories/general/threads')
		expect(listing.category).toMatchObject({ threadCount: 1, postCount: 2 })
		expect(listing.threads.items).toHaveLength(1)
		expect(listing.can.createThread).toBe(true)

		const firstPage = await api.ok<ThreadDetailDto>('GET', `/threads/${thread.ref}?pageSize=1`)
		expect(firstPage.posts).toMatchObject({ page: 1, pageSize: 1, total: 2 })
		expect(firstPage.posts.items.map((post) => post.body)).toEqual(['First'])
		const secondPage = await api.ok<ThreadDetailDto>(
			'GET',
			`/threads/${thread.number}?page=2&pageSize=1`,
		)
		expect(secondPage.posts.items.map((post) => post.body)).toEqual(['Second'])
		expect(await api.ok('GET', `/posts/${reply.id}/location`)).toEqual({
			threadRef: thread.ref,
			postNumber: 2,
		})

		expect(await api.ok<PostDto>('PATCH', `/posts/${reply.id}`, { body: 'Edited' })).toMatchObject({
			body: 'Edited',
		})
		expect(
			await api.ok<ThreadDto>('PATCH', `/threads/${thread.ref}`, {
				title: 'Renamed',
				locked: true,
			}),
		).toMatchObject({ title: 'Renamed', slug: 'renamed', ref: '1001-renamed', locked: true })
		expect(
			await api.ok<CategoryDto>('PATCH', `/categories/${category.id}`, { name: 'Lounge' }),
		).toMatchObject({ name: 'Lounge', slug: 'general' })

		const userId = meta.viewer.user!.id
		expect(await api.ok<UserProfileDto>('GET', `/users/dev`)).toMatchObject({
			user: { id: userId, handle: 'dev', displayName: 'Dev' },
			roles: ['member', 'admin'],
			threadCount: 1,
			postCount: 2,
			can: { edit: true },
		})
		expect(
			await api.ok<UserDto>('PATCH', `/users/${userId}`, {
				displayName: 'Developer',
				handle: 'developer',
			}),
		).toEqual({
			id: userId,
			handle: 'developer',
			displayName: 'Developer',
		})

		expect(await api.call('DELETE', `/posts/${reply.id}`)).toEqual({ status: 204, body: undefined })
		expect((await api.call('DELETE', `/categories/${category.id}`)).status).toBe(409)
		expect((await api.call('DELETE', `/threads/${thread.id}`)).status).toBe(204)
		expect((await api.call('GET', `/threads/${thread.id}`)).status).toBe(404)
	})

	it('lists recent active threads across categories with paging', async () => {
		await using host = await createHost()
		const api = await startAs(host, ['admin'])
		const guest = client(host)

		const general = await api.ok<CategoryDto>('POST', '/categories', {
			name: 'General',
			slug: 'general',
			position: 1,
		})
		const news = await api.ok<CategoryDto>('POST', '/categories', {
			name: 'Announcements',
			slug: 'news',
			position: 2,
		})

		const first = await api.ok<ThreadDto>('POST', '/threads', {
			categoryId: general.id,
			title: 'First Thread',
			body: 'One',
		})
		const second = await api.ok<ThreadDto>('POST', '/threads', {
			categoryId: news.id,
			title: 'Second Thread',
			body: 'Two',
		})
		await api.ok<PostDto>('POST', `/threads/${first.id}/posts`, { body: 'Bump first' })

		const recentDefault = await guest.ok<RecentThreadsDto>('GET', '/threads')
		expect(recentDefault).toMatchObject({ page: 1, total: 2 })
		expect(recentDefault.items.map((item) => item.id)).toEqual([first.id, second.id])
		expect(recentDefault.items[0]).toMatchObject({
			id: first.id,
			title: 'First Thread',
			replyCount: 1,
			category: { id: general.id, slug: 'general', name: 'General' },
		})
		expect(recentDefault.items[1]).toMatchObject({
			id: second.id,
			title: 'Second Thread',
			category: { id: news.id, slug: 'news', name: 'Announcements' },
		})

		const recentPage2 = await guest.ok<RecentThreadsDto>('GET', '/threads?page=2&pageSize=1')
		expect(recentPage2).toMatchObject({ page: 2, pageSize: 1, total: 2 })
		expect(recentPage2.items).toHaveLength(1)
		expect(recentPage2.items[0]).toMatchObject({
			id: second.id,
			category: { id: news.id, slug: 'news', name: 'Announcements' },
		})
	})

	it('reports every failure in one error shape', async () => {
		await using host = await createHost()
		const api = await startAs(host, [])

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
		await start(host)
		const api = client(host)
		expect((await api.call('GET', '/ping')).status).toBe(200)

		await host.stop(ForumApiPlugin)
		const response = await host.http.fetch(new URL('/api/forum/ping', host.http.origin))
		expect(response.status).toBe(404)
	})

	it('refuses cross-site writes and writes it cannot attribute', async () => {
		await using host = await createHost()
		const api = await startAs(host, ['admin'])
		const create = (headers: Record<string, string>) =>
			api.call('POST', '/categories', { name: `C${crypto.randomUUID()}`, slug: 'c' }, headers)

		// A browser on another site rides on the cookie; its Origin header gives it away.
		expect(await create({ origin: 'https://evil.test' })).toEqual({
			status: 403,
			body: error('forbidden'),
		})
		expect((await create({ origin: ORIGIN })).status).toBe(201)

		// With the session store down, reads continue as a guest and writes ask to retry later.
		const down = client(host, { 'x-test-user': 'down' })
		expect((await down.ok<MetaDto>('GET', '/meta')).viewer.roles).toEqual(['guest'])
		expect(await down.call('POST', '/categories', { name: 'Later' })).toEqual({
			status: 503,
			body: error('unavailable'),
		})
	})

	it('drives login and logout through redirects', async () => {
		await using host = await createHost()
		const api = await startAs(host, [])
		const guest = client(host)
		expect(await redirected(guest.send('GET', '/auth/login?returnTo=/t/42'))).toEqual({
			status: 303,
			location: 'https://idp.test/authorize?returnTo=/t/42',
			cookie: null,
		})
		expect(await redirected(guest.send('GET', '/auth/callback?code=c&state=s'))).toEqual({
			status: 303,
			location: '/t/42',
			cookie: 'session=abc; HttpOnly',
		})
		// A failed login lands on a page that can explain it.
		expect(await redirected(guest.send('GET', '/auth/callback?error=access_denied'))).toEqual({
			status: 303,
			location: '/?login=rejected',
			cookie: null,
		})

		const loggedOut = { status: 303, location: '/', cookie: CLEARED.setCookie }
		expect(await redirected(api.send('POST', '/auth/logout'))).toEqual(loggedOut)
		expect(await redirected(api.send('POST', '/auth/logout-all'))).toEqual(loggedOut)
		expect(await guest.call('POST', '/auth/logout-all')).toEqual({
			status: 401,
			body: error('unauthenticated'),
		})
		expect(
			(await api.call('POST', '/auth/logout', undefined, { origin: 'https://evil.test' })).status,
		).toBe(403)

		// The provider posts the logout token as a form.
		const backchannel = (token: string) =>
			host.http.fetch(
				new Request(new URL('/api/forum/auth/backchannel-logout', host.http.origin), {
					method: 'POST',
					body: new URLSearchParams({ logout_token: token }),
				}),
			)
		expect((await backchannel('valid')).status).toBe(200)
		expect((await backchannel('forged')).status).toBe(400)
	})

	it('serves test login only while it is configured, and only for the right token', async () => {
		await using host = await createHost()
		await startAs(host, [])
		const testLogin = (token: string | null, body: unknown = { name: 'ada' }) => {
			const headers = new Headers({ 'content-type': 'application/json' })
			if (token !== null) headers.set('x-test-login-token', token)
			return host.http.fetch(
				new Request(new URL('/api/forum/auth/test-login', host.http.origin), {
					method: 'POST',
					headers,
					body: JSON.stringify(body),
				}),
			)
		}
		try {
			FakeAuth.testLoginOn = false
			expect((await testLogin('good')).status).toBe(404)

			FakeAuth.testLoginOn = true
			const ok = await testLogin('good')
			expect(ok.status).toBe(200)
			expect(ok.headers.get('set-cookie')).toContain('forum_session=abc')
			expect(await ok.json()).toEqual({ userId: 'test-ada' })
			expect((await testLogin('wrong')).status).toBe(400)
			expect((await testLogin(null)).status).toBe(400)
			expect((await testLogin('good', {})).status).toBe(400)
		} finally {
			FakeAuth.testLoginOn = false
		}
	})

	it('reports how posts are rendered and previews a body for members', async () => {
		await using host = await createHost()
		const api = await startAs(host, [])

		const meta = await api.ok<MetaDto>('GET', '/meta')
		expect(meta.content).toEqual({ format: 'plain' })
		expect(meta.search).toEqual({ available: false })
		expect(meta.uiSlots).toEqual([])
		expect(meta.site.name).toBe('Pluxum')
		// The footer is empty until a plugin (Forum Footer) fills it.
		expect(meta.footer).toEqual({ groups: [], icons: [], notes: [] })

		expect(await api.ok<PreviewDto>('POST', '/preview', { body: 'a < b' })).toEqual({
			bodyHtml: 'a &lt; b',
			bodyFormat: 'plain',
		})
		expect(await api.call('POST', '/preview', { body: '  ' })).toEqual({
			status: 422,
			body: error('invalid'),
		})
		expect((await client(host).call('POST', '/preview', { body: 'x' })).status).toBe(401)
	})

	it('serves search only while a search provider plugin runs', async () => {
		await using host = await createHost()
		const api = await startAs(host, ['admin'])
		const category = await api.ok<CategoryDto>('POST', '/categories', {
			name: 'General',
			slug: 'general',
		})
		const thread = await api.ok<ThreadDto>('POST', '/threads', {
			categoryId: category.id,
			title: '乒乓球拍',
			body: '底板评测',
		})

		expect(await api.call('GET', '/search?q=乒乓')).toEqual({
			status: 503,
			body: error('unavailable'),
		})

		await host.start(SimpleSearchPlugin)
		expect((await api.ok<MetaDto>('GET', '/meta')).search).toEqual({ available: true })
		expect(await api.call('GET', '/search?q=')).toEqual({
			status: 422,
			body: error('invalid'),
		})

		const page = await api.ok<SearchPageDto>('GET', '/search?q=乒乓&threadsOnly=1')
		expect(page).toMatchObject({
			total: 1,
			page: 1,
			items: [
				{
					threadId: thread.id,
					categoryId: category.id,
					opening: true,
					title: '乒乓球拍',
					snippetHtml: '<mark>乒乓</mark>',
					author: { displayName: 'Dev' },
				},
			],
		})

		await host.stop(SimpleSearchPlugin)
		expect((await api.ok<MetaDto>('GET', '/meta')).search).toEqual({ available: false })
		expect((await api.call('GET', '/search?q=乒乓')).status).toBe(503)
	})
})

describe('ext ingress', () => {
	it('serves contributed actions under their contract', async () => {
		await using host = await createHost()
		const api = await startAs(host, [])
		const guest = client(host)
		expect((await api.call('GET', '/ext/test-echo/whoami')).status).toBe(404)

		await host.start(EchoExtPlugin)
		expect(host.require(ForumApiPlugin).extActionKeys()).toEqual([
			'test-echo/shout',
			'test-echo/whoami',
			'test-echo/broken',
		])

		// A read works for guests; the query is the input.
		expect(await guest.call('GET', '/ext/test-echo/whoami?tag=a&other=dropped')).toEqual({
			status: 200,
			body: { roles: ['guest'], tag: 'a' },
		})
		// A write needs a login, valid input and the right method, and comes from this site.
		expect(await guest.call('POST', '/ext/test-echo/shout', { text: 'hi' })).toEqual({
			status: 401,
			body: error('unauthenticated'),
		})
		const shouted = await api.call('POST', '/ext/test-echo/shout', { text: 'hi' })
		expect(shouted).toEqual({ status: 200, body: { text: 'HI', by: expect.any(String) } })
		for (const bad of [{ text: 'much too long' }, { text: 1 }, {}, undefined]) {
			// oxlint-disable-next-line no-await-in-loop -- four small sequential requests keep the failure readable
			expect(await api.call('POST', '/ext/test-echo/shout', bad)).toEqual({
				status: 422,
				body: error('invalid'),
			})
		}
		expect((await api.call('GET', '/ext/test-echo/shout')).status).toBe(405)
		expect(
			(
				await api.call(
					'POST',
					'/ext/test-echo/shout',
					{ text: 'hi' },
					{ origin: 'https://evil.test' },
				)
			).status,
		).toBe(403)
		// The handler's own failures use the forum's error shape; a broken output is a server fault.
		expect(await api.call('POST', '/ext/test-echo/shout', { text: 'taken' })).toEqual({
			status: 409,
			body: error('conflict'),
		})
		expect(await api.call('GET', '/ext/test-echo/broken')).toEqual({
			status: 500,
			body: error('internal'),
		})
		expect((await api.call('GET', '/ext/test-echo/nope')).status).toBe(404)
		expect((await api.call('GET', '/ext/other/whoami')).status).toBe(404)
	})

	it('withdraws actions with their contributor and takes them back after a restart', async () => {
		await using host = await createHost()
		await start(host)
		const guest = client(host)
		await host.start(EchoExtPlugin)

		await host.stop(EchoExtPlugin)
		expect(host.require(ForumApiPlugin).extActionKeys()).toEqual([])
		expect(await guest.call('GET', '/ext/test-echo/whoami')).toEqual({
			status: 404,
			body: error('not_found'),
		})

		await host.start(EchoExtPlugin)
		const before = host.require(ForumApiPlugin)
		const restarted = await host.restart(ForumApiPlugin)
		expect(restarted).not.toBe(before)
		expect(host.isRunning(EchoExtPlugin)).toBe(true)
		expect(restarted.extActionKeys()).toHaveLength(3)
		expect((await guest.call('GET', '/ext/test-echo/whoami')).status).toBe(200)

		// A second contributor cannot take a path that is in use; the first keeps serving it. (The
		// host would start the refused plugin once the path is free, so this comes last.)
		const failure = await host.commitExpectFail((change) => change.start(DuplicateExtPlugin))
		expect(failure.lifecycleReport.issues).toContainEqual(
			expect.objectContaining({ kind: 'start-failed' }),
		)
		expect(await guest.call('GET', '/ext/test-echo/whoami')).toEqual({
			status: 200,
			body: { roles: ['guest'], tag: '' },
		})
	})
})
