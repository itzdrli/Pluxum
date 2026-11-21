import type { ForumNotification, MetaDto, NotificationPageDto } from '@pluxum/domain'
import { ForumApiPlugin } from '@pluxum/api'
import { ForumAuth, type Authentication } from '@pluxum/auth'
import { ForumCorePlugin } from '@pluxum/core'
import {
	ForumNotificationsPlugin,
	INBOX_CHANNEL_ID,
	NOTIFICATIONS_EXT_ID,
	NOTIFICATIONS_POST_HOOK_ID,
} from '@pluxum/notifications'
import { BasePlugin, Plugin } from '@pluxel/core'
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

const bridgedNotifications: ForumNotification[] = []

@Plugin()
class MailBridgePlugin extends BasePlugin {
	constructor(private readonly core: ForumCorePlugin) {
		super()
	}

	protected override init(): void {
		this.ctx.effects.defer(
			this.core.registerNotificationChannel({
				id: 'test-mail.bridge',
				deliver: (notification) => {
					bridgedNotifications.push(notification)
				},
			}),
		)
	}
}

function client(host: Host, userId?: string) {
	const identity: Record<string, string> = userId === undefined ? {} : { 'x-test-user': userId }
	const send = async (request: Request) => {
		const response = await host.http.fetch(request)
		const text = await response.text()
		const body = text ? JSON.parse(text) : undefined
		return { status: response.status, body }
	}
	const url = (path: string) => new URL(`/api/forum${path}`, host.http.origin)
	return {
		get: (path: string) => send(new Request(url(path), { headers: identity })),
		post: (path: string, payload: unknown = {}) =>
			send(
				new Request(url(path), {
					method: 'POST',
					headers: { ...identity, 'content-type': 'application/json' },
					body: JSON.stringify(payload),
				}),
			),
	}
}

async function setUp(host: Host) {
	bridgedNotifications.length = 0
	await host.commit((change) => {
		change.start(ForumCorePlugin)
		change.start(FakeAuth)
		change.start(ForumApiPlugin)
		change.start(ForumNotificationsPlugin)
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
			title: 'Notifications Thread',
			body: 'Opening body',
		})
	).unwrap()
	return { core, admin, alice, bob, category, thread }
}

const LIST = `/ext/${NOTIFICATIONS_EXT_ID}/list`
const UNREAD_COUNT = `/ext/${NOTIFICATIONS_EXT_ID}/unread-count`
const MARK_READ = `/ext/${NOTIFICATIONS_EXT_ID}/mark-read`
const MARK_ALL_READ = `/ext/${NOTIFICATIONS_EXT_ID}/mark-all-read`

describe('ForumNotificationsPlugin', () => {
	it('delivers reply notifications to thread authors, skips self-replies, and fans out to bridge channels', async () => {
		await using host = await createHost()
		const { core, alice, bob, thread } = await setUp(host)
		await host.start(MailBridgePlugin)

		// Alice replying to her own thread must NOT notify her.
		;(
			await core.createPost(await core.principalOf(alice.id), {
				threadId: thread.id,
				body: 'Self follow-up note',
			})
		).unwrap()
		expect((await client(host, alice.id).get(UNREAD_COUNT)).body).toEqual({ count: 0 })
		expect(bridgedNotifications).toEqual([])

		// Bob replying to Alice's thread notifies Alice across both inbox and mail bridge channels.
		const reply = (
			await core.createPost(await core.principalOf(bob.id), {
				threadId: thread.id,
				body: 'Here is a helpful reply!',
			})
		).unwrap()

		expect((await client(host, alice.id).get(UNREAD_COUNT)).body).toEqual({ count: 1 })
		expect((await client(host, bob.id).get(UNREAD_COUNT)).body).toEqual({ count: 0 })

		const listResponse = await client(host, alice.id).get(LIST)
		expect(listResponse.status).toBe(200)
		const page: NotificationPageDto = listResponse.body
		expect(page.total).toBe(1)
		expect(page.unreadCount).toBe(1)
		expect(page.items[0]).toMatchObject({
			id: reply.id,
			recipientId: alice.id,
			kind: 'thread.reply',
			title: 'Bob 回复了你的主题《Notifications Thread》',
			body: 'Here is a helpful reply!',
			path: `/t/${thread.ref}/${reply.number}`,
			threadId: thread.id,
			postId: reply.id,
			actor: { id: bob.id, handle: bob.handle, displayName: 'Bob' },
			read: false,
			readAt: null,
		})

		expect(bridgedNotifications).toHaveLength(1)
		expect(bridgedNotifications[0]).toMatchObject({
			id: reply.id,
			recipientId: alice.id,
			kind: 'thread.reply',
			path: `/t/${thread.ref}/${reply.number}`,
			actor: { id: bob.id, handle: bob.handle, displayName: 'Bob' },
		})

		// Alice answering inside Bob's floor tells Bob, not herself as the thread's author.
		const inner = (
			await core.createPost(await core.principalOf(alice.id), {
				threadId: thread.id,
				body: 'Thanks!',
				parentId: reply.id,
			})
		).unwrap()
		const bobPage: NotificationPageDto = (await client(host, bob.id).get(LIST)).body
		expect(bobPage.items[0]).toMatchObject({
			id: inner.id,
			recipientId: bob.id,
			kind: 'post.reply',
			title: 'Alice 在《Notifications Thread》中回复了你',
			path: `/t/${thread.ref}/${inner.number}`,
		})
		expect((await client(host, alice.id).get(UNREAD_COUNT)).body).toEqual({ count: 1 })
	})

	it('persists direct core.deliverNotification calls idempotently and supports pagination & unread filtering', async () => {
		await using host = await createHost()
		const { core, alice, bob } = await setUp(host)

		const custom: ForumNotification = {
			id: '00000000-0000-4000-8000-000000000101',
			recipientId: alice.id,
			kind: 'system.welcome',
			title: '欢迎来到 Pluxel 论坛',
			body: '祝你交流愉快',
			path: '/',
			actor: { id: bob.id, handle: bob.handle, displayName: 'Bob' },
			createdAt: '2026-11-15T10:00:00.000Z',
		}
		const second: ForumNotification = {
			id: '00000000-0000-4000-8000-000000000102',
			recipientId: alice.id,
			kind: 'system.notice',
			title: '第二条系统通知',
			createdAt: '2026-11-15T10:05:00.000Z',
		}
		const third: ForumNotification = {
			id: '00000000-0000-4000-8000-000000000103',
			recipientId: alice.id,
			kind: 'system.notice',
			title: '第三条系统通知',
			createdAt: '2026-11-15T10:10:00.000Z',
		}

		expect(await core.deliverNotification(custom)).toEqual([INBOX_CHANNEL_ID])
		// Delivering the exact same notification ID again is a no-op.
		expect(await core.deliverNotification(custom)).toEqual([INBOX_CHANNEL_ID])
		await core.deliverNotification(second)
		await core.deliverNotification(third)

		const asAlice = client(host, alice.id)
		const firstPage: NotificationPageDto = (await asAlice.get(`${LIST}?page=1&pageSize=2`)).body
		expect(firstPage).toMatchObject({
			page: 1,
			pageSize: 2,
			total: 3,
			unreadCount: 3,
		})
		expect(firstPage.items.map((item) => item.id)).toEqual([third.id, second.id])

		const secondPage: NotificationPageDto = (await asAlice.get(`${LIST}?page=2&pageSize=2`)).body
		expect(secondPage).toMatchObject({
			page: 2,
			pageSize: 2,
			total: 3,
			unreadCount: 3,
		})
		expect(secondPage.items.map((item) => item.id)).toEqual([custom.id])
		expect(secondPage.items[0]?.actor).toEqual({
			id: bob.id,
			handle: bob.handle,
			displayName: 'Bob',
		})

		// Mark `second` read and check `unreadOnly=true` filtering.
		expect((await asAlice.post(MARK_READ, { id: second.id })).status).toBe(200)
		const unreadOnlyPage: NotificationPageDto = (await asAlice.get(`${LIST}?unreadOnly=true`)).body
		expect(unreadOnlyPage.total).toBe(2)
		expect(unreadOnlyPage.unreadCount).toBe(2)
		expect(unreadOnlyPage.items.map((item) => item.id)).toEqual([third.id, custom.id])
	})

	it('enforces authentication and recipient ownership on mark-read and mark-all-read', async () => {
		await using host = await createHost()
		const { core, alice, bob, thread } = await setUp(host)

		const bobReply = (
			await core.createPost(await core.principalOf(bob.id), {
				threadId: thread.id,
				body: 'Reply for Alice',
			})
		).unwrap()
		const bobNotification: ForumNotification = {
			id: '00000000-0000-4000-8000-000000000201',
			recipientId: bob.id,
			kind: 'system.info',
			title: 'Notification for Bob',
			createdAt: new Date().toISOString(),
		}
		await core.deliverNotification(bobNotification)

		// Guests are rejected on all 4 endpoints.
		const guest = client(host)
		expect((await guest.get(LIST)).status).toBe(401)
		expect((await guest.get(UNREAD_COUNT)).status).toBe(401)
		expect((await guest.post(MARK_READ, { id: bobReply.id })).status).toBe(401)
		expect((await guest.post(MARK_ALL_READ)).status).toBe(401)

		const asAlice = client(host, alice.id)
		const asBob = client(host, bob.id)

		// Bob cannot mark Alice's notification read; returns 404 and leaves Alice's unread.
		expect((await asBob.post(MARK_READ, { id: bobReply.id })).status).toBe(404)
		expect((await asAlice.get(UNREAD_COUNT)).body).toEqual({ count: 1 })
		expect((await asAlice.post(MARK_READ, { id: MISSING_ID })).status).toBe(404)
		expect((await asAlice.post(MARK_READ, { id: 'not-a-uuid' })).status).toBe(404)

		// Alice marks her own notification read; repeating the call is idempotent.
		const firstMark = await asAlice.post(MARK_READ, { id: bobReply.id })
		expect(firstMark).toEqual({
			status: 200,
			body: {
				id: bobReply.id,
				read: true,
				readAt: expect.any(String),
				unreadCount: 0,
			},
		})
		const secondMark = await asAlice.post(MARK_READ, { id: bobReply.id })
		expect(secondMark.status).toBe(200)
		expect(secondMark.body.readAt).toBe(firstMark.body.readAt)

		// Deliver two more unread notifications to Alice; mark-all-read clears Alice's without touching Bob's.
		await core.deliverNotification({
			id: '00000000-0000-4000-8000-000000000202',
			recipientId: alice.id,
			kind: 'system.a',
			title: 'Alice 1',
			createdAt: new Date().toISOString(),
		})
		await core.deliverNotification({
			id: '00000000-0000-4000-8000-000000000203',
			recipientId: alice.id,
			kind: 'system.b',
			title: 'Alice 2',
			createdAt: new Date().toISOString(),
		})
		expect((await asAlice.get(UNREAD_COUNT)).body).toEqual({ count: 2 })
		expect((await asBob.get(UNREAD_COUNT)).body).toEqual({ count: 1 })

		expect(await asAlice.post(MARK_ALL_READ)).toEqual({
			status: 200,
			body: { marked: 2, unreadCount: 0 },
		})
		expect((await asAlice.get(UNREAD_COUNT)).body).toEqual({ count: 0 })
		expect((await asBob.get(UNREAD_COUNT)).body).toEqual({ count: 1 })
	})

	it('withdraws its channel, hook, UI slot and ext actions when stopped and restores them on start', async () => {
		await using host = await createHost()
		const { core, alice, bob, thread } = await setUp(host)
		const asAlice = client(host, alice.id)

		const slots = async () => {
			const meta: MetaDto = (await asAlice.get('/meta')).body
			return meta.uiSlots
		}

		expect(await slots()).toEqual([{ slot: 'shell.actions', extId: NOTIFICATIONS_EXT_ID }])
		expect(core.notificationChannelIds()).toContain(INBOX_CHANNEL_ID)
		expect(core.postHookIds()).toContain(NOTIFICATIONS_POST_HOOK_ID)

		;(
			await core.createPost(await core.principalOf(bob.id), {
				threadId: thread.id,
				body: 'Before stop',
			})
		).unwrap()
		expect((await asAlice.get(UNREAD_COUNT)).body).toEqual({ count: 1 })

		await host.stop(ForumNotificationsPlugin)
		expect(await slots()).toEqual([])
		expect(core.notificationChannelIds()).not.toContain(INBOX_CHANNEL_ID)
		expect(core.postHookIds()).not.toContain(NOTIFICATIONS_POST_HOOK_ID)
		expect((await asAlice.get(LIST)).status).toBe(404)
		expect((await asAlice.get(UNREAD_COUNT)).status).toBe(404)
		expect((await asAlice.post(MARK_ALL_READ)).status).toBe(404)

		await host.start(ForumNotificationsPlugin)
		expect(await slots()).toEqual([{ slot: 'shell.actions', extId: NOTIFICATIONS_EXT_ID }])
		expect((await asAlice.get(UNREAD_COUNT)).body).toEqual({ count: 1 })

		// Re-registers cleanly across ForumApiPlugin and ForumCorePlugin restarts.
		await host.restart(ForumApiPlugin)
		expect(host.isRunning(ForumNotificationsPlugin)).toBe(true)
		expect((await asAlice.get(UNREAD_COUNT)).status).toBe(200)

		const restartedCore = await host.restart(ForumCorePlugin)
		expect(host.isRunning(ForumNotificationsPlugin)).toBe(true)
		expect(restartedCore.notificationChannelIds()).toContain(INBOX_CHANNEL_ID)
		expect(restartedCore.postHookIds()).toContain(NOTIFICATIONS_POST_HOOK_ID)
		expect(restartedCore.uiSlots()).toEqual([
			{ slot: 'shell.actions', extId: NOTIFICATIONS_EXT_ID },
		])
	})
})
