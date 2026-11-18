import { GUEST } from '@pluxum/domain'
import { ForumCorePlugin } from '@pluxum/core'
import { BasePlugin, Plugin } from '@pluxel/core'
import { CachePlugin, MemoryCacheBackendPlugin } from '@pluxel/plugin-cache'
import { database } from '@pluxel/services/database'
import { pglite } from '@pluxel/services/database/pglite'
import { createTestHost } from '@pluxel/test'
import { describe, expect, it } from 'vitest'
import { ForumCachePlugin } from '../src'

/** Counts how often the core asks for a body to be rendered. */
const renders: string[] = []

@Plugin()
class CountingRendererPlugin extends BasePlugin {
	constructor(private readonly core: ForumCorePlugin) {
		super()
	}

	protected override init(): void {
		this.ctx.effects.defer(
			this.core.registerContentRenderer({
				id: 'test.counting',
				format: 'markdown',
				render: (source) => {
					renders.push(source)
					return `<p>${source}</p>`
				},
			}),
		)
	}
}

async function boot() {
	const host = await createTestHost({
		services: [database({ backend: pglite({ dataDir: 'memory://' }) })],
	})
	await host.commit((change) => {
		change.start(ForumCorePlugin)
		change.start(CountingRendererPlugin)
		change.start(MemoryCacheBackendPlugin)
		change.start(CachePlugin)
		change.start(ForumCachePlugin)
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

describe('forum cache plugin', () => {
	it('renders a post body once and serves the same HTML afterwards', async () => {
		const { core, admin, category } = await boot()
		expect(core.cacheId()).toBe('forum-cache.cache')
		const thread = (
			await core.createThread(admin, { categoryId: category.id, title: '缓存', body: '只渲染一次' })
		).unwrap()
		renders.length = 0
		const first = (await core.getThread(GUEST, thread.ref)).unwrap()
		const second = (await core.getThread(GUEST, thread.ref)).unwrap()
		expect(first.posts.items[0]?.bodyHtml).toBe('<p>只渲染一次</p>')
		expect(second.posts.items[0]?.bodyHtml).toBe('<p>只渲染一次</p>')
		expect(renders.filter((source) => source === '只渲染一次')).toHaveLength(1)

		// An edited body is new source: rendered again.
		const opening = first.posts.items[0]
		if (!opening) throw new Error('no opening post')
		;(await core.updatePost(admin, opening.id, { body: '改过了' })).unwrap()
		const edited = (await core.getThread(GUEST, thread.ref)).unwrap()
		expect(edited.posts.items[0]?.bodyHtml).toBe('<p>改过了</p>')
	})

	it('keeps listings until a write changes them', async () => {
		const { host, core, admin, category } = await boot()
		const post = (title: string) =>
			core.createThread(admin, { categoryId: category.id, title, body: '正文' })
		;(await post('第一个')).unwrap()

		const feed = await core.listRecentThreads(GUEST)
		expect(feed.items.map((item) => item.title)).toEqual(['第一个'])
		const listing = (await core.listThreads(GUEST, category.slug)).unwrap()
		expect(listing.threads.total).toBe(1)
		expect((await core.communityPulse(GUEST)).members).toBe(1)

		// Each kind of write shows up on the next read.
		;(await post('第二个')).unwrap()
		expect((await core.listRecentThreads(GUEST)).items.map((item) => item.title)).toEqual([
			'第二个',
			'第一个',
		])
		expect((await core.listThreads(GUEST, category.slug)).unwrap().threads.total).toBe(2)
		await core.ensureUser({ subject: 'test:new', displayName: 'Newcomer' })
		expect((await core.communityPulse(GUEST)).members).toBe(2)
		;(await core.updateCategory(admin, category.id, { name: '综合' })).unwrap()
		expect((await core.listThreads(GUEST, category.slug)).unwrap().category.name).toBe('综合')
		expect((await core.listThreads(GUEST, 'missing')).isErr()).toBe(true)

		// Without the plugin the core reads fresh, and keeps working.
		await host.stop(ForumCachePlugin)
		expect(core.cacheId()).toBeNull()
		;(await post('第三个')).unwrap()
		expect((await core.listRecentThreads(GUEST)).total).toBe(3)
	})

	it('applies a saved setting by starting empty scopes', async () => {
		const { host, core, admin, category } = await boot()
		;(
			await core.createThread(admin, { categoryId: category.id, title: '设置', body: '正文' })
		).unwrap()
		expect((await core.listRecentThreads(GUEST)).total).toBe(1)
		const saved = await host.config.patch(ForumCachePlugin, {
			set: { listingTtlSeconds: 5, renderedEntries: 500 },
		})
		expect(saved).toMatchObject({ ok: true, application: 'applied' })
		expect((await core.listRecentThreads(GUEST)).total).toBe(1)
	})
})
