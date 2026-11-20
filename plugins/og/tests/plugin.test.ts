import { existsSync } from 'node:fs'
import type { MetaDto } from '@pluxum/domain'
import { ForumApiPlugin } from '@pluxum/api'
import { ForumAuth, type Authentication } from '@pluxum/auth'
import { ForumCorePlugin } from '@pluxum/core'
import { Plugin } from '@pluxel/core'
import { FontsPlugin } from '@pluxel/plugin-fonts'
import { TakumiPlugin } from '@pluxel/plugin-takumi'
import { database } from '@pluxel/services/database'
import { pglite } from '@pluxel/services/database/pglite'
import { elysia } from '@pluxel/services/elysia'
import { nodeModules } from '@pluxel/services/node'
import { workers } from '@pluxel/services/workers'
import { createTestHost } from '@pluxel/test'
import { describe, expect, it } from 'vitest'
import { clip, ForumOgPlugin, OG_EXT_ID, plainText, threadCardPath } from '../src'

/** Every request is a guest's, or the user named by `x-test-user`. */
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

const FONT = [
	'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
	'/usr/share/fonts/dejavu/DejaVuSans.ttf',
].find((path) => existsSync(path))

/** Width and height from a PNG's IHDR chunk. */
function pngSize(bytes: Uint8Array): [number, number] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	return [view.getUint32(16), view.getUint32(20)]
}

describe('plainText and clip', () => {
	it('reads the words of sanitized HTML', () => {
		expect(
			plainText('<p>Hello <strong>you</strong> &amp; me&nbsp;&#x4F60;&#22909;</p>\n<p>x</p>'),
		).toBe('Hello you & me 你好 x')
	})
	it('cuts by code point with an ellipsis', () => {
		expect(clip('😀😀😀', 2)).toBe('😀😀…')
		expect(clip('ab', 2)).toBe('ab')
	})
})

describe('forum og plugin', () => {
	it('serves a thread card PNG as a guest sees it, with an ETag', async () => {
		await using host = await createTestHost({
			services: [
				elysia(),
				nodeModules(),
				workers({ maxThreads: 1 }),
				database({ backend: pglite({ dataDir: 'memory://' }) }),
			],
		})
		await host.commit((change) => {
			change.start(ForumCorePlugin)
			change.start(FakeAuth)
			change.start(ForumApiPlugin)
			change.start(FontsPlugin, { initialConfig: { files: FONT ? [FONT] : [] } })
			change.start(TakumiPlugin)
			change.start(ForumOgPlugin)
		})
		const core = host.require(ForumCorePlugin)
		const adminUser = (
			await core.ensureUser({ subject: 'test:admin', displayName: 'Admin' })
		).unwrap()
		;(await core.grantRole(adminUser.id, 'admin')).unwrap()
		const admin = await core.principalOf(adminUser.id)
		const category = (await core.createCategory(admin, { name: 'Help', slug: 'help' })).unwrap()
		const thread = (
			await core.createThread(admin, { categoryId: category.id, title: 'How?', body: 'question' })
		).unwrap()

		const fetchPath = (path: string, headers: Record<string, string> = {}) =>
			host.http.fetch(new Request(new URL(path, host.http.origin), { headers }))

		const meta: MetaDto = await (await fetchPath('/api/forum/meta')).json()
		expect(meta.uiSlots).toContainEqual({ slot: 'thread.social', extId: OG_EXT_ID })

		const response = await fetchPath(threadCardPath(thread.ref))
		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toBe('image/png')
		const png = new Uint8Array(await response.arrayBuffer())
		expect([...png.subarray(1, 4)].map((byte) => String.fromCharCode(byte)).join('')).toBe('PNG')
		expect(pngSize(png)).toEqual([1200, 630])

		const etag = response.headers.get('etag')
		expect(etag).toBeTruthy()
		expect(
			(await fetchPath(threadCardPath(thread.ref), { 'if-none-match': etag ?? '' })).status,
		).toBe(304)

		// What the card shows changed, so its ETag does too.
		;(await core.updateThread(admin, thread.id, { title: 'How, exactly?' })).unwrap()
		const renamed = await core.getThread(admin, thread.id)
		const again = await fetchPath(threadCardPath(renamed.unwrap().thread.ref))
		expect(again.status).toBe(200)
		expect(again.headers.get('etag')).not.toBe(etag)

		expect((await fetchPath(threadCardPath('99999'))).status).toBe(404)
		expect((await fetchPath(`/api/forum/ext/${OG_EXT_ID}/files/${thread.ref}`)).status).toBe(404)

		// Stopped, the card and the slot are gone.
		await host.commit((change) => change.stop(ForumOgPlugin))
		expect((await fetchPath(threadCardPath(thread.ref))).status).toBe(404)
		const after: MetaDto = await (await fetchPath('/api/forum/meta')).json()
		expect(after.uiSlots.some((slot) => slot.extId === OG_EXT_ID)).toBe(false)
	})
})
