import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MetaDto, PostDto, ThreadDetailDto, ThreadDto, UserProfileDto } from '@pluxum/domain'
import { ForumApiPlugin } from '@pluxum/api'
import {
	ATTACHMENTS_EXT_ID,
	ForumAttachmentsPlugin,
	ForumStoragePlugin,
	type AttachmentItem,
	type AvatarActionResult,
} from '@pluxum/attachments'
import { ForumAuth, type Authentication } from '@pluxum/auth'
import { ForumCorePlugin } from '@pluxum/core'
import { Plugin } from '@pluxel/core'
import { database } from '@pluxel/services/database'
import { pglite } from '@pluxel/services/database/pglite'
import { elysia } from '@pluxel/services/elysia'
import { Vault, vault } from '@pluxel/services/vault'
import { createTestHost } from '@pluxel/test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// 1x1 transparent PNG
const TINY_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
	'base64',
)

// 1x1 GIF89a
const TINY_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

let s3Root = ''

beforeEach(async () => {
	s3Root = await mkdtemp(join(tmpdir(), 'forum-s3-test-'))
})

afterEach(async () => {
	if (s3Root) await rm(s3Root, { recursive: true, force: true })
})

const createHost = () =>
	createTestHost({
		services: [elysia(), database({ backend: pglite({ dataDir: 'memory://' }) }), vault()],
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
}

function client(host: Host, userId?: string) {
	const identity: Record<string, string> = userId === undefined ? {} : { 'x-test-user': userId }
	const send = async (request: Request) => {
		const response = await host.http.fetch(request)
		const text = await response.text()
		const body = text ? JSON.parse(text) : undefined
		return { status: response.status, body, headers: response.headers }
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
		rawGet: (fullPath: string, extraHeaders: Record<string, string> = {}) =>
			host.http.fetch(
				new Request(new URL(fullPath, host.http.origin), {
					headers: { ...identity, ...extraHeaders },
				}),
			),
	}
}

async function setUp(host: Host) {
	await host.commit((change) => {
		change.start(ForumStoragePlugin, {
			initialConfig: {
				buckets: [
					{
						id: 'default',
						backend: {
							type: 'local',
							rootDir: s3Root,
							bucketName: 'forum-test',
							syncWrites: false,
						},
					},
				],
			},
		})
		change.start(ForumCorePlugin)
		change.start(FakeAuth)
		change.start(ForumApiPlugin)
		change.start(ForumAttachmentsPlugin)
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
	return { core, adminUser, admin, alice, bob, category }
}

describe('ForumAttachmentsPlugin', () => {
	it('uploads, serves, replaces and removes user avatars and enriches UserDto across the forum', async () => {
		await using host = await createHost()
		const { alice, bob, category } = await setUp(host)
		const asAlice = client(host, alice.id)
		const asBob = client(host, bob.id)

		const threadRes = await asAlice.post('/threads', {
			categoryId: category.id,
			title: 'Hello',
			body: 'World',
		})
		expect(threadRes.status).toBe(201)
		const thread: ThreadDto = threadRes.body
		expect(thread.author.ext).toBeUndefined()

		// Upload PNG avatar for Alice
		const uploaded = await asAlice.post(`/ext/${ATTACHMENTS_EXT_ID}/upload-avatar`, {
			filename: 'alice.png',
			contentType: 'image/png',
			dataBase64: TINY_PNG.toString('base64'),
		})
		expect(uploaded.status).toBe(200)
		const firstAvatar: AvatarActionResult = uploaded.body
		expect(firstAvatar.avatarUrl).toMatch(
			/^\/api\/forum\/ext\/forum-attachments\/files\/[0-9a-f-]{36}$/,
		)

		// Fetch binary avatar and verify headers + ETag 304
		const fileRes = await asAlice.rawGet(firstAvatar.avatarUrl!)
		expect(fileRes.status).toBe(200)
		expect(fileRes.headers.get('content-type')).toBe('image/png')
		expect(fileRes.headers.get('content-disposition')).toContain('inline')
		expect(fileRes.headers.get('x-content-type-options')).toBe('nosniff')
		expect(Buffer.from(await fileRes.arrayBuffer()).equals(TINY_PNG)).toBe(true)

		const etag = fileRes.headers.get('etag')!
		expect(etag).toBeTruthy()
		const cachedRes = await asAlice.rawGet(firstAvatar.avatarUrl!, { 'if-none-match': etag })
		expect(cachedRes.status).toBe(304)

		// Alice's UserDto is now enriched in /meta, /users/:id and /threads/:id
		const meta: MetaDto = (await asAlice.get('/meta')).body
		expect(meta.viewer.user?.ext?.[ATTACHMENTS_EXT_ID]).toEqual({
			avatarUrl: firstAvatar.avatarUrl,
		})

		const profile: UserProfileDto = (await asAlice.get(`/users/${alice.id}`)).body
		expect(profile.user.ext?.[ATTACHMENTS_EXT_ID]).toEqual({
			avatarUrl: firstAvatar.avatarUrl,
		})

		const detail: ThreadDetailDto = (await asAlice.get(`/threads/${thread.id}`)).body
		expect(detail.thread.author.ext?.[ATTACHMENTS_EXT_ID]).toEqual({
			avatarUrl: firstAvatar.avatarUrl,
		})
		expect(detail.posts.items[0].author.ext?.[ATTACHMENTS_EXT_ID]).toEqual({
			avatarUrl: firstAvatar.avatarUrl,
		})

		// Bob cannot change Alice's avatar
		expect(
			(
				await asBob.post(`/ext/${ATTACHMENTS_EXT_ID}/upload-avatar`, {
					userId: alice.id,
					dataBase64: TINY_GIF.toString('base64'),
				})
			).status,
		).toBe(403)

		// Replacing Alice's avatar removes the previous file
		const replaced = await asAlice.post(`/ext/${ATTACHMENTS_EXT_ID}/upload-avatar`, {
			filename: 'alice.gif',
			dataBase64: TINY_GIF.toString('base64'),
		})
		expect(replaced.status).toBe(200)
		const secondAvatar: AvatarActionResult = replaced.body
		expect(secondAvatar.avatarUrl).not.toBe(firstAvatar.avatarUrl)
		expect((await asAlice.rawGet(firstAvatar.avatarUrl!)).status).toBe(404)
		expect((await asAlice.rawGet(secondAvatar.avatarUrl!)).headers.get('content-type')).toBe(
			'image/gif',
		)

		// Deleting Alice's avatar removes the file and clears UserDto.ext
		const deleted = await asAlice.post(`/ext/${ATTACHMENTS_EXT_ID}/delete-avatar`, {})
		expect(deleted).toMatchObject({ status: 200, body: { avatarUrl: null } })
		expect((await asAlice.rawGet(secondAvatar.avatarUrl!)).status).toBe(404)
		const metaAfterDelete: MetaDto = (await asAlice.get('/meta')).body
		expect(metaAfterDelete.viewer.user?.ext).toBeUndefined()
	})

	it('validates file types by magic bytes, serves non-images as attachments and syncs post attachments', async () => {
		await using host = await createHost()
		const { alice, category } = await setUp(host)
		const asAlice = client(host, alice.id)

		// Disguised HTML claiming to be image/png is rejected
		const disguised = await asAlice.post(`/ext/${ATTACHMENTS_EXT_ID}/upload`, {
			filename: 'evil.png',
			contentType: 'image/png',
			dataBase64: Buffer.from('<script>alert(1)</script>').toString('base64'),
		})
		expect(disguised.status).toBe(422)

		// SVG and HTML are rejected
		const svg = await asAlice.post(`/ext/${ATTACHMENTS_EXT_ID}/upload`, {
			filename: 'icon.svg',
			contentType: 'image/svg+xml',
			dataBase64: Buffer.from('<svg></svg>').toString('base64'),
		})
		expect(svg.status).toBe(422)

		// Upload a valid image and a valid text document
		const imgUpload = await asAlice.post(`/ext/${ATTACHMENTS_EXT_ID}/upload`, {
			filename: 'screenshot.png',
			contentType: 'image/png',
			dataBase64: TINY_PNG.toString('base64'),
		})
		expect(imgUpload.status).toBe(200)
		const imgItem: AttachmentItem = imgUpload.body
		expect(imgItem).toMatchObject({
			filename: 'screenshot.png',
			contentType: 'image/png',
			size: TINY_PNG.byteLength,
			isImage: true,
		})

		const docBytes = Buffer.from('# 附件说明\n内容', 'utf8')
		const docUpload = await asAlice.post(`/ext/${ATTACHMENTS_EXT_ID}/upload`, {
			filename: 'readme.md',
			contentType: 'text/markdown',
			dataBase64: docBytes.toString('base64'),
		})
		expect(docUpload.status).toBe(200)
		const docItem: AttachmentItem = docUpload.body
		expect(docItem).toMatchObject({
			filename: 'readme.md',
			contentType: 'text/markdown',
			size: docBytes.byteLength,
			isImage: false,
		})

		// Non-image files are served with Content-Disposition: attachment
		const docRes = await asAlice.rawGet(docItem.url)
		expect(docRes.status).toBe(200)
		expect(docRes.headers.get('content-disposition')).toContain('attachment;')
		expect(docRes.headers.get('x-content-type-options')).toBe('nosniff')
		expect(await docRes.text()).toBe('# 附件说明\n内容')

		// Creating a thread referencing both attachments links them to the opening post
		const created = await asAlice.post('/threads', {
			categoryId: category.id,
			title: '带附件的主题',
			body: `请看截图 ![截图](${imgItem.url}) 和文档 [说明](${docItem.url})`,
		})
		expect(created.status).toBe(201)
		const thread: ThreadDto = created.body

		const detail: ThreadDetailDto = (await asAlice.get(`/threads/${thread.id}`)).body
		const opening: PostDto = detail.posts.items[0]
		expect(opening.ext[ATTACHMENTS_EXT_ID]).toEqual({
			items: [imgItem, docItem],
		})

		// Editing the post to keep only the document updates the linked attachments
		const edited = await asAlice.patch(`/posts/${opening.id}`, {
			body: `只保留文档 [说明](${docItem.url})`,
		})
		expect(edited.status).toBe(200)
		const editedPost: PostDto = edited.body
		expect(editedPost.ext[ATTACHMENTS_EXT_ID]).toEqual({
			items: [docItem],
		})
	})

	it('withdraws slots, extensions and file routes when stopped and restores them when restarted', async () => {
		await using host = await createHost()
		const { alice, category } = await setUp(host)
		const asAlice = client(host, alice.id)

		const avatar: AvatarActionResult = (
			await asAlice.post(`/ext/${ATTACHMENTS_EXT_ID}/upload-avatar`, {
				dataBase64: TINY_PNG.toString('base64'),
			})
		).body
		const uploaded: AttachmentItem = (
			await asAlice.post(`/ext/${ATTACHMENTS_EXT_ID}/upload`, {
				filename: 'note.txt',
				contentType: 'text/plain',
				dataBase64: Buffer.from('note').toString('base64'),
			})
		).body
		const thread: ThreadDto = (
			await asAlice.post('/threads', {
				categoryId: category.id,
				title: 'Lifecycle',
				body: `Link: [note.txt](${uploaded.url})`,
			})
		).body

		const metaRunning: MetaDto = (await asAlice.get('/meta')).body
		expect(metaRunning.uiSlots).toEqual([
			{ slot: 'post.footer', extId: ATTACHMENTS_EXT_ID },
			{ slot: 'user.profile.tabs', extId: ATTACHMENTS_EXT_ID },
			{ slot: 'composer.toolbar', extId: ATTACHMENTS_EXT_ID },
		])

		await host.stop(ForumAttachmentsPlugin)
		const metaStopped: MetaDto = (await asAlice.get('/meta')).body
		expect(metaStopped.uiSlots).toEqual([])
		expect(metaStopped.viewer.user?.ext).toBeUndefined()
		expect((await asAlice.rawGet(avatar.avatarUrl!)).status).toBe(404)
		expect((await asAlice.rawGet(uploaded.url)).status).toBe(404)
		expect(
			(
				await asAlice.post(`/ext/${ATTACHMENTS_EXT_ID}/upload`, {
					filename: 'a.txt',
					contentType: 'text/plain',
					dataBase64: Buffer.from('a').toString('base64'),
				})
			).status,
		).toBe(404)
		const whileStopped: ThreadDetailDto = (await asAlice.get(`/threads/${thread.id}`)).body
		expect(whileStopped.posts.items[0].ext).toEqual({})
		expect(whileStopped.posts.items[0].author.ext).toBeUndefined()

		// Starting it again brings everything back
		await host.start(ForumAttachmentsPlugin)
		expect((await asAlice.rawGet(avatar.avatarUrl!)).status).toBe(200)
		const restored: ThreadDetailDto = (await asAlice.get(`/threads/${thread.id}`)).body
		expect(restored.posts.items[0].ext[ATTACHMENTS_EXT_ID]).toEqual({ items: [uploaded] })
		expect(restored.posts.items[0].author.ext?.[ATTACHMENTS_EXT_ID]).toEqual({
			avatarUrl: avatar.avatarUrl,
		})
	})

	const liveEndpoint = process.env.FORUM_TEST_S3_ENDPOINT
	const liveAccessKey = process.env.FORUM_TEST_S3_ACCESS_KEY
	const liveSecretKey = process.env.FORUM_TEST_S3_SECRET_KEY
	it.skipIf(!liveEndpoint || !liveAccessKey || !liveSecretKey)(
		'stores and reads objects against live rustfs S3 with Vault credentials',
		async () => {
			await using host = await createHost()
			const core = await host.start(ForumCorePlugin)
			// Vault namespaces belong to their owner: the record must be written by the storage
			// plugin itself, while it still runs on a backend that needs no credentials.
			await host.start(ForumStoragePlugin, { initialConfig: {} })
			await host
				.require(ForumStoragePlugin)
				.ctx.require(Vault)
				.kv({ namespace: 'forum-storage' })
				.set('s3.credentials', { accessKeyId: liveAccessKey!, secretAccessKey: liveSecretKey! })
			await host.stop(ForumStoragePlugin)
			await host.config.patch(ForumStoragePlugin, {
				buckets: [
					{
						id: 'default',
						backend: {
							type: 'remote',
							endpoint: liveEndpoint!,
							region: 'us-east-1',
							credentials: { type: 'vault', namespace: 'forum-storage' },
							requestSizeInBytes: 8 * 1024 * 1024,
							requestAbortTimeout: 10_000,
							minPartSize: 5 * 1024 * 1024,
						},
					},
				],
			})
			await host.commit((change) => {
				change.start(ForumStoragePlugin)
				change.start(FakeAuth)
				change.start(ForumApiPlugin)
				change.start(ForumAttachmentsPlugin)
			})
			const alice = (
				await core.ensureUser({ subject: 'test:alice', displayName: 'Alice' })
			).unwrap()
			const asAlice = client(host, alice.id)

			const uploaded = await asAlice.post(`/ext/${ATTACHMENTS_EXT_ID}/upload-avatar`, {
				dataBase64: TINY_PNG.toString('base64'),
			})
			expect(uploaded.status).toBe(200)
			const result: AvatarActionResult = uploaded.body
			const fetched = await asAlice.rawGet(result.avatarUrl!)
			expect(fetched.status).toBe(200)
			expect(Buffer.from(await fetched.arrayBuffer()).equals(TINY_PNG)).toBe(true)

			expect((await asAlice.post(`/ext/${ATTACHMENTS_EXT_ID}/delete-avatar`, {})).status).toBe(200)
		},
	)
})
