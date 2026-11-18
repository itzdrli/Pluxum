import type { ForumNotification, Principal } from '@pluxum/domain'
import { ForumApiPlugin } from '@pluxum/api'
import { ForumAuth, type Authentication } from '@pluxum/auth'
import { ForumCorePlugin } from '@pluxum/core'
import { BasePlugin, Plugin } from '@pluxel/core'
import { database } from '@pluxel/services/database'
import { pglite } from '@pluxel/services/database/pglite'
import { elysia } from '@pluxel/services/elysia'
import { createTestHost } from '@pluxel/test'
import { describe, expect, it } from 'vitest'
import { ForumMentionsPlugin, mentionedRefs, mentionNoticeId, MENTION_LIMIT } from '../src'

@Plugin(ForumAuth)
class FakeAuth extends ForumAuth {
	override loginAvailable(): boolean {
		return true
	}
	override authenticate(): Promise<Authentication> {
		return Promise.resolve({ status: 'guest' })
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

async function boot() {
	const host = await createTestHost({
		services: [elysia(), database({ backend: pglite({ dataDir: 'memory://' }) })],
	})
	await host.commit((change) => {
		change.start(ForumCorePlugin)
		change.start(FakeAuth)
		change.start(ForumApiPlugin)
		change.start(CollectingChannelPlugin)
		change.start(ForumMentionsPlugin)
	})
	const core = host.require(ForumCorePlugin)
	const signUp = async (name: string): Promise<Principal & { handle: string }> => {
		const user = (
			await core.ensureUser({
				subject: `test:${name}`,
				displayName: name,
				handleHint: name.toLowerCase(),
			})
		).unwrap()
		return { ...(await core.principalOf(user.id)), handle: user.handle }
	}
	const adminUser = (
		await core.ensureUser({ subject: 'test:admin', displayName: 'Admin' })
	).unwrap()
	;(await core.grantRole(adminUser.id, 'admin')).unwrap()
	const admin = await core.principalOf(adminUser.id)
	const category = (await core.createCategory(admin, { name: 'General', description: '' })).unwrap()
	return { host, core, signUp, category }
}

describe('forum mentions plugin', () => {
	it('notifies the people a new thread or reply mentions, once each', async () => {
		delivered.length = 0
		const { host, core, signUp, category } = await boot()
		const alice = await signUp('Alice')
		const bob = await signUp('Bob')
		const carol = await signUp('Carol')

		const thread = (
			await core.createThread(alice, {
				categoryId: category.id,
				title: '提到别人',
				body: `你好 [@Bob](/u/${bob.handle}) 和 [@Bob](/u/${bob.handle})，还有 [@自己](/u/${alice.handle})`,
			})
		).unwrap()
		expect(delivered.map((item) => [item.kind, item.recipientId])).toEqual([
			['post.mention', bob.userId],
		])
		expect(delivered[0]).toMatchObject({
			title: 'Alice 在《提到别人》中提到了你',
			path: `/t/${thread.ref}/1`,
		})

		// In a reply the thread's author is told by the reply notice instead; code is not a mention.
		delivered.length = 0
		;(
			await core.createPost(bob, {
				threadId: thread.id,
				body: `[@Alice](/u/${alice.handle}) [@Carol](/u/${carol.userId}) \`[@Bob](/u/${bob.handle})\``,
			})
		).unwrap()
		expect(delivered.map((item) => item.recipientId)).toEqual([carol.userId])
		expect(delivered[0]?.path).toBe(`/t/${thread.ref}/2`)

		// Suggestions match handle or name.
		const mentions = host.require(ForumMentionsPlugin)
		expect((await mentions.suggest('car')).items.map((item) => item.handle)).toEqual([carol.handle])

		// Stopped: no more notices.
		delivered.length = 0
		await host.stop(ForumMentionsPlugin)
		;(
			await core.createPost(alice, { threadId: thread.id, body: `[@Carol](/u/${carol.handle})` })
		).unwrap()
		expect(delivered).toEqual([])
	})

	it('reads mentions out of Markdown', () => {
		expect(mentionedRefs('[@A](/u/alice) [x](/u/bob) [@C](/u/carol?x=1) [@D](/u/Dave)')).toEqual([
			'alice',
			'dave',
		])
		expect(mentionedRefs('```\n[@A](/u/alice)\n```')).toEqual([])
		const many = Array.from({ length: 20 }, (_, i) => `[@u](/u/user${i})`).join(' ')
		expect(mentionedRefs(many)).toHaveLength(MENTION_LIMIT)
		const id = mentionNoticeId('a', 'b')
		expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
		expect(mentionNoticeId('a', 'b')).toBe(id)
	})
})
