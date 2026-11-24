import type { Principal } from '@pluxum/domain'
import { ForumCorePlugin } from '@pluxum/core'
import { MemoryRatesBackendPlugin, RatesPlugin } from '@pluxel/plugin-rates'
import { database } from '@pluxel/services/database'
import { pglite } from '@pluxel/services/database/pglite'
import { createTestHost } from '@pluxel/test'
import { describe, expect, it } from 'vitest'
import { ForumRatesPlugin, waitText } from '../src'

async function signUp(core: ForumCorePlugin, name: string): Promise<Principal> {
	const user = (await core.ensureUser({ subject: `test:${name}`, displayName: name })).unwrap()
	return core.principalOf(user.id)
}

async function boot(initialConfig: Record<string, unknown>) {
	const host = await createTestHost({
		services: [database({ backend: pglite({ dataDir: 'memory://' }) })],
	})
	await host.commit((change) => {
		change.start(ForumCorePlugin)
		change.start(MemoryRatesBackendPlugin)
		change.start(RatesPlugin)
		change.start(ForumRatesPlugin, { initialConfig })
	})
	const core = host.require(ForumCorePlugin)
	const adminUser = (
		await core.ensureUser({ subject: 'test:admin', displayName: 'Admin' })
	).unwrap()
	;(await core.grantRole(adminUser.id, 'admin')).unwrap()
	const admin = await core.principalOf(adminUser.id)
	const category = (await core.createCategory(admin, { name: 'General', description: '' })).unwrap()
	return { host, core, admin, category }
}

describe('forum rates plugin', () => {
	it('refuses writes over the limit with rate_limited, per account and per kind', async () => {
		const { host, core, category } = await boot({
			threads: { limit: 2, minutes: 10 },
			replies: { limit: 1, minutes: 10 },
		})
		const alice = await signUp(core, 'Alice')
		const bob = await signUp(core, 'Bob')
		const thread = async (who: Principal, title: string) =>
			core.createThread(who, { categoryId: category.id, title, body: '正文内容' })

		const first = (await thread(alice, '第一个主题')).unwrap()
		;(await thread(alice, '第二个主题')).unwrap()
		const third = await thread(alice, '第三个主题')
		expect(third.isErr() && third.error).toMatchObject({ code: 'rate_limited' })
		expect(third.isErr() && third.error.message).toMatch(/^发主题太频繁了，请 \d+ 分钟后再试$/)

		// Another account has its own count; replies have their own limit.
		expect((await thread(bob, 'Bob 的主题')).isOk()).toBe(true)
		expect((await core.createPost(alice, { threadId: first.id, body: '回复' })).isOk()).toBe(true)
		const reply = await core.createPost(alice, { threadId: first.id, body: '再回复' })
		expect(reply.isErr() && reply.error.code).toBe('rate_limited')

		// Stopping the plugin lifts every limit.
		await host.stop(ForumRatesPlugin)
		expect((await thread(alice, '第四个主题')).isOk()).toBe(true)
	})

	it('lets staff through unless told otherwise, and applies a saved limit at once', async () => {
		const { host, core, admin, category } = await boot({ threads: { limit: 1, minutes: 10 } })
		const staff = await Promise.all(
			['管理员一', '管理员二', '管理员三'].map((title) =>
				core.createThread(admin, { categoryId: category.id, title, body: '正文' }),
			),
		)
		expect(staff.every((result) => result.isOk())).toBe(true)
		await host.config.patch(ForumRatesPlugin, { set: { exemptStaff: false } })
		await host.config.patch(ForumRatesPlugin, { set: { threads: { limit: 1, minutes: 5 } } })
		expect(
			(
				await core.createThread(admin, { categoryId: category.id, title: '受限一', body: '正文' })
			).isOk(),
		).toBe(true)
		const refused = await core.createThread(admin, {
			categoryId: category.id,
			title: '受限二',
			body: '正文',
		})
		expect(refused.isErr() && refused.error.code).toBe('rate_limited')

		// A limit of 0 switches that kind off.
		await host.config.patch(ForumRatesPlugin, { set: { threads: { limit: 0, minutes: 5 } } })
		expect(
			(
				await core.createThread(admin, { categoryId: category.id, title: '不限', body: '正文' })
			).isOk(),
		).toBe(true)
	})

	it('words the wait in seconds, minutes or hours', () => {
		expect(waitText(400)).toBe('1 秒')
		expect(waitText(59_000)).toBe('59 秒')
		expect(waitText(61_000)).toBe('2 分钟')
		expect(waitText(3 * 3_600_000)).toBe('3 小时')
	})
})
