import type {
	MetaDto,
	ModerationLogPageDto,
	ModerationQueuePageDto,
	ModerationReportDto,
	UserProfileDto,
} from '@pluxum/domain'
import { ForumApiPlugin } from '@pluxum/api'
import { ForumAuth, type Authentication } from '@pluxum/auth'
import { ForumCorePlugin } from '@pluxum/core'
import {
	ForumModerationPlugin,
	MODERATION_EXT_ID,
	MODERATION_POLICY_ID,
	MODERATION_POST_HOOK_ID,
} from '@pluxum/moderation'
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

@Plugin(ForumAuth)
class FakeAuth extends ForumAuth {
	readonly revokedUsers: string[] = []

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

	override revokeUserSessions(userId: string): Promise<number> {
		this.revokedUsers.push(userId)
		return Promise.resolve(2)
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
		patch: (path: string, payload: unknown) =>
			send(
				new Request(url(path), {
					method: 'PATCH',
					headers: { ...identity, 'content-type': 'application/json' },
					body: JSON.stringify(payload),
				}),
			),
	}
}

async function setUp(host: Host, blockedWords: string[] = []) {
	await host.commit((change) => {
		change.start(ForumCorePlugin)
		change.start(FakeAuth)
		change.start(ForumApiPlugin)
		change.start(
			ForumModerationPlugin,
			blockedWords.length > 0 ? { initialConfig: { blockedWords } } : undefined,
		)
	})
	const core = host.require(ForumCorePlugin)
	const auth = host.require(FakeAuth)
	const adminUser = (
		await core.ensureUser({ subject: 'test:admin', displayName: 'Admin' })
	).unwrap()
	;(await core.grantRole(adminUser.id, 'admin')).unwrap()
	const modUser = (
		await core.ensureUser({ subject: 'test:mod', displayName: 'Moderator' })
	).unwrap()
	;(await core.grantRole(modUser.id, 'moderator')).unwrap()
	const aliceUser = (
		await core.ensureUser({ subject: 'test:alice', displayName: 'Alice' })
	).unwrap()
	const bobUser = (await core.ensureUser({ subject: 'test:bob', displayName: 'Bob' })).unwrap()

	const admin = await core.principalOf(adminUser.id)
	const mod = await core.principalOf(modUser.id)
	const alice = await core.principalOf(aliceUser.id)
	const bob = await core.principalOf(bobUser.id)

	const category = (
		await core.createCategory(admin, { name: '综合讨论', slug: 'general' })
	).unwrap()
	const thread = (
		await core.createThread(alice, {
			categoryId: category.id,
			title: '论坛讨论帖',
			body: '欢迎交流',
		})
	).unwrap()
	const reply = (
		await core.createPost(bob, { threadId: thread.id, body: '这是一条待审核的回复' })
	).unwrap()

	return {
		core,
		auth,
		adminUser,
		modUser,
		aliceUser,
		bobUser,
		admin,
		mod,
		alice,
		bob,
		category,
		thread,
		reply,
	}
}

describe('ForumModerationPlugin', () => {
	it('submits reports, prevents duplicate open reports on the same target, and lists queue', async () => {
		await using host = await createHost()
		const { aliceUser, bobUser, modUser, thread, reply } = await setUp(host)

		// Guests cannot submit reports
		expect(
			(
				await client(host).post(`/ext/${MODERATION_EXT_ID}/report`, {
					postId: reply.id,
					reason: '垃圾信息',
				})
			).status,
		).toBe(401)

		// Missing post returns 404; blank reason returns 422
		expect(
			(
				await client(host, aliceUser.id).post(`/ext/${MODERATION_EXT_ID}/report`, {
					postId: MISSING_ID,
					reason: '不存在的帖子',
				})
			).status,
		).toBe(404)
		expect(
			(
				await client(host, aliceUser.id).post(`/ext/${MODERATION_EXT_ID}/report`, {
					postId: reply.id,
					reason: '   ',
				})
			).status,
		).toBe(422)

		// Alice submits a valid report
		const created = await client(host, aliceUser.id).post(`/ext/${MODERATION_EXT_ID}/report`, {
			postId: reply.id,
			reason: '疑似垃圾广告',
		})
		expect(created.status).toBe(200)
		expect(created.body).toMatchObject({
			targetType: 'post',
			targetId: reply.id,
			threadId: thread.id,
			postId: reply.id,
			status: 'open',
		})

		// Duplicate open report from the same reporter on the same target is rejected (409)
		const duplicate = await client(host, aliceUser.id).post(`/ext/${MODERATION_EXT_ID}/report`, {
			postId: reply.id,
			reason: '再次重复举报',
		})
		expect(duplicate.status).toBe(409)

		// Moderator views the open queue
		const queueRes = await client(host, modUser.id).get(
			`/ext/${MODERATION_EXT_ID}/queue?status=open`,
		)
		expect(queueRes.status).toBe(200)
		const queue: ModerationQueuePageDto = queueRes.body
		expect(queue.openCount).toBe(1)
		expect(queue.total).toBe(1)
		expect(queue.items[0]).toMatchObject({
			id: created.body.id,
			targetType: 'post',
			targetId: reply.id,
			reason: '疑似垃圾广告',
			status: 'open',
			reporter: { id: aliceUser.id, displayName: 'Alice' },
			targetAuthor: { id: bobUser.id, displayName: 'Bob' },
		})
	})

	it('resolves or dismisses reports, deletes reported posts or threads when requested, and writes logs', async () => {
		await using host = await createHost()
		const { core, aliceUser, bob, modUser, category, thread, reply } = await setUp(host)

		// First report: dismissed without deleting
		const firstReport = await client(host, aliceUser.id).post(`/ext/${MODERATION_EXT_ID}/report`, {
			postId: reply.id,
			reason: '误报测试',
		})
		expect(firstReport.status).toBe(200)

		const dismissed = await client(host, modUser.id).post(`/ext/${MODERATION_EXT_ID}/resolve`, {
			reportId: firstReport.body.id,
			decision: 'dismissed',
			note: '内容正常，无需处理',
		})
		expect(dismissed.status).toBe(200)
		const dismissedDto: ModerationReportDto = dismissed.body
		expect(dismissedDto.status).toBe('dismissed')
		expect(dismissedDto.resolutionNote).toBe('内容正常，无需处理')
		expect(dismissedDto.resolvedBy?.id).toBe(modUser.id)

		// Once dismissed, Alice can report the post again, and moderator resolves + deletes target
		const secondReport = await client(host, aliceUser.id).post(`/ext/${MODERATION_EXT_ID}/report`, {
			postId: reply.id,
			reason: '修改后包含违规内容',
		})
		expect(secondReport.status).toBe(200)

		const resolved = await client(host, modUser.id).post(`/ext/${MODERATION_EXT_ID}/resolve`, {
			reportId: secondReport.body.id,
			decision: 'resolved',
			deleteTarget: true,
			note: '已删除违规回复',
		})
		expect(resolved.status).toBe(200)
		expect(resolved.body.status).toBe('resolved')

		// Reply is now soft-deleted
		expect((await core.locatePost(bob, reply.id)).isErr()).toBe(true)

		// Thread-level report resolved with deleteTarget deletes the whole thread
		const spamThread = (
			await core.createThread(bob, {
				categoryId: category.id,
				title: '违规主题',
				body: '主楼内容',
			})
		).unwrap()
		const spamDetail = (await core.getThread(bob, spamThread.id)).unwrap()
		const openingPost = spamDetail.posts.items[0]
		if (!openingPost) throw new Error('Expected opening post')

		const threadReport = await client(host, aliceUser.id).post(`/ext/${MODERATION_EXT_ID}/report`, {
			postId: openingPost.id,
			targetType: 'thread',
			reason: '整帖违规',
		})
		expect(threadReport.status).toBe(200)
		expect(threadReport.body.targetType).toBe('thread')
		expect(threadReport.body.targetId).toBe(spamThread.id)

		const resolvedThread = await client(host, modUser.id).post(
			`/ext/${MODERATION_EXT_ID}/resolve`,
			{
				reportId: threadReport.body.id,
				decision: 'resolved',
				deleteTarget: true,
			},
		)
		expect(resolvedThread.status).toBe(200)
		expect((await client(host).get(`/threads/${spamThread.id}`)).status).toBe(404)
		expect((await client(host).get(`/threads/${thread.id}`)).status).toBe(200)

		// Audit logs capture report creation, dismissal and deletion resolutions
		const logsRes = await client(host, modUser.id).get(`/ext/${MODERATION_EXT_ID}/logs`)
		expect(logsRes.status).toBe(200)
		const logs: ModerationLogPageDto = logsRes.body
		expect(logs.total).toBe(6)
		expect(logs.items.map((item) => item.action)).toEqual(
			expect.arrayContaining(['report.created', 'report.dismissed', 'report.resolved_deleted']),
		)
	})

	it('bans users (denying writes, revoking sessions, attaching user.ext, preloading on restart) and restores writes on unban', async () => {
		await using host = await createHost()
		const { core, auth, adminUser, modUser, bobUser, bob, category, thread } = await setUp(host)

		// Staff cannot ban themselves or admins
		expect(
			(
				await client(host, modUser.id).post(`/ext/${MODERATION_EXT_ID}/ban`, {
					userId: modUser.id,
					reason: '自封测试',
				})
			).status,
		).toBe(403)
		expect(
			(
				await client(host, modUser.id).post(`/ext/${MODERATION_EXT_ID}/ban`, {
					userId: adminUser.id,
					reason: '封禁管理员测试',
				})
			).status,
		).toBe(403)

		// Moderator bans Bob
		const banRes = await client(host, modUser.id).post(`/ext/${MODERATION_EXT_ID}/ban`, {
			userId: bobUser.id,
			reason: '恶意刷屏',
		})
		expect(banRes.status).toBe(200)
		expect(banRes.body).toEqual({
			userId: bobUser.id,
			banned: true,
			reason: '恶意刷屏',
			expiresAt: null,
			revokedSessions: 2,
		})
		expect(auth.revokedUsers).toEqual([bobUser.id])

		// User profile exposes `ext['forum-moderation']` while banned
		const bannedProfileRes = await client(host, modUser.id).get(`/users/${bobUser.id}`)
		expect(bannedProfileRes.status).toBe(200)
		const bannedProfile: UserProfileDto = bannedProfileRes.body
		expect(bannedProfile.ext[MODERATION_EXT_ID]).toEqual({
			banned: true,
			reason: '恶意刷屏',
			expiresAt: null,
		})

		// Write permissions and API writes are denied while reads remain allowed
		expect(core.can(bob, 'thread.view', { categoryId: category.id, threadId: thread.id })).toBe(
			true,
		)
		expect(core.can(bob, 'thread.create', { categoryId: category.id })).toBe(false)
		expect(core.can(bob, 'post.create', { categoryId: category.id, threadId: thread.id })).toBe(
			false,
		)
		expect(core.can(bob, 'post.react', { categoryId: category.id, threadId: thread.id })).toBe(
			false,
		)
		expect(core.can(bob, 'user.edit', { userId: bobUser.id })).toBe(false)

		expect(
			(await client(host, bobUser.id).post(`/threads/${thread.id}/posts`, { body: '被封禁后回复' }))
				.status,
		).toBe(403)
		expect(
			(await client(host, bobUser.id).patch(`/users/${bobUser.id}`, { displayName: 'NewBob' }))
				.status,
		).toBe(403)
		expect((await client(host, bobUser.id).get(`/threads/${thread.id}`)).status).toBe(200)

		// Stopping withdraws slots, policy, hooks and ext actions; restarting preloads active bans
		await host.commit((change) => {
			change.stop(ForumModerationPlugin)
		})
		const stoppedMeta: MetaDto = (await client(host).get('/meta')).body
		expect(stoppedMeta.uiSlots.some((slot) => slot.extId === MODERATION_EXT_ID)).toBe(false)
		expect(core.permissionPolicyIds()).not.toContain(MODERATION_POLICY_ID)
		expect(core.postHookIds()).not.toContain(MODERATION_POST_HOOK_ID)
		expect((await client(host, modUser.id).get(`/ext/${MODERATION_EXT_ID}/queue`)).status).toBe(404)

		await host.commit((change) => {
			change.start(ForumModerationPlugin)
		})
		const restartedMeta: MetaDto = (await client(host).get('/meta')).body
		expect(restartedMeta.uiSlots).toEqual(
			expect.arrayContaining([
				{ slot: 'post.actions', extId: MODERATION_EXT_ID },
				{ slot: 'user.profile.tabs', extId: MODERATION_EXT_ID },
			]),
		)
		// Active ban was preloaded from the database at init()
		expect(
			(await client(host, bobUser.id).post(`/threads/${thread.id}/posts`, { body: '重启后仍被封' }))
				.status,
		).toBe(403)

		// Unbanning Bob restores write permissions and clears `user.ext`
		const unbanRes = await client(host, modUser.id).post(`/ext/${MODERATION_EXT_ID}/unban`, {
			userId: bobUser.id,
			reason: '申诉通过',
		})
		expect(unbanRes.status).toBe(200)
		expect(unbanRes.body).toEqual({ userId: bobUser.id, banned: false })

		const restoredPost = await client(host, bobUser.id).post(`/threads/${thread.id}/posts`, {
			body: '解封后正常发言',
		})
		expect(restoredPost.status).toBe(201)

		const unbannedProfile: UserProfileDto = (await client(host).get(`/users/${bobUser.id}`)).body
		expect(unbannedProfile.ext[MODERATION_EXT_ID]).toBeUndefined()
	})

	it('automatically lifts temporary bans once expiresAt has passed', async () => {
		await using host = await createHost()
		const { core, modUser, bobUser, bob, category, thread } = await setUp(host)

		// ~40ms temporary ban (0.000011 hours)
		const banRes = await client(host, modUser.id).post(`/ext/${MODERATION_EXT_ID}/ban`, {
			userId: bobUser.id,
			reason: '短暂冷却',
			durationHours: 0.000_011,
		})
		expect(banRes.status).toBe(200)
		expect(banRes.body.expiresAt).toEqual(expect.any(String))
		expect(core.can(bob, 'post.create', { categoryId: category.id, threadId: thread.id })).toBe(
			false,
		)

		await new Promise((resolve) => setTimeout(resolve, 70))

		expect(core.can(bob, 'post.create', { categoryId: category.id, threadId: thread.id })).toBe(
			true,
		)
		const replyRes = await client(host, bobUser.id).post(`/threads/${thread.id}/posts`, {
			body: '冷却期结束后恢复发言',
		})
		expect(replyRes.status).toBe(201)

		const profile: UserProfileDto = (await client(host).get(`/users/${bobUser.id}`)).body
		expect(profile.ext[MODERATION_EXT_ID]).toBeUndefined()
	})

	it('rejects blocked words in thread titles and post bodies via beforeWrite hook', async () => {
		await using host = await createHost()
		const { aliceUser, category, thread, reply, bobUser } = await setUp(host, [
			'违禁外链',
			'SpamCasino',
		])

		// Blocked word in thread title
		const badTitle = await client(host, aliceUser.id).post('/threads', {
			categoryId: category.id,
			title: '推荐一个违禁外链网站',
			body: '正文没有问题',
		})
		expect(badTitle.status).toBe(422)
		expect(badTitle.body.error.code).toBe('invalid')

		// Blocked word in reply body (case-insensitive + NFKC)
		const badReply = await client(host, aliceUser.id).post(`/threads/${thread.id}/posts`, {
			body: 'Visit ｓｐａｍｃａｓｉｎｏ now!',
		})
		expect(badReply.status).toBe(422)
		expect(badReply.body.error.code).toBe('invalid')

		// Blocked word when editing an existing post
		const badEdit = await client(host, bobUser.id).patch(`/posts/${reply.id}`, {
			body: '编辑加入违禁外链内容',
		})
		expect(badEdit.status).toBe(422)

		// Clean post succeeds
		const cleanReply = await client(host, aliceUser.id).post(`/threads/${thread.id}/posts`, {
			body: '完全合规的技术讨论内容',
		})
		expect(cleanReply.status).toBe(201)
	})

	it('rejects non-staff members with 403 and guests with 401 on staff moderation endpoints', async () => {
		await using host = await createHost()
		const { aliceUser, bobUser } = await setUp(host)
		const asAlice = client(host, aliceUser.id)
		const asGuest = client(host)

		expect((await asGuest.get(`/ext/${MODERATION_EXT_ID}/queue`)).status).toBe(401)
		expect((await asAlice.get(`/ext/${MODERATION_EXT_ID}/queue`)).status).toBe(403)
		expect(
			(
				await asAlice.post(`/ext/${MODERATION_EXT_ID}/resolve`, {
					reportId: MISSING_ID,
					decision: 'dismissed',
				})
			).status,
		).toBe(403)
		expect(
			(
				await asAlice.post(`/ext/${MODERATION_EXT_ID}/ban`, {
					userId: bobUser.id,
					reason: '越权封禁',
				})
			).status,
		).toBe(403)
		expect(
			(await asAlice.post(`/ext/${MODERATION_EXT_ID}/unban`, { userId: bobUser.id })).status,
		).toBe(403)
		expect((await asAlice.get(`/ext/${MODERATION_EXT_ID}/logs`)).status).toBe(403)
	})
})
