import { ForumCorePlugin } from '@pluxum/core'
import { ForumMarkdownPlugin, MARKDOWN_RENDERER_ID } from '@pluxum/markdown'
import { database } from '@pluxel/services/database'
import { pglite } from '@pluxel/services/database/pglite'
import { createTestHost } from '@pluxel/test'
import { describe, expect, it } from 'vitest'

const createHost = () =>
	createTestHost({ services: [database({ backend: pglite({ dataDir: 'memory://' }) })] })

/** A thread whose opening post has the given source; returns a reader of that post. */
async function openingPost(core: ForumCorePlugin, body: string) {
	const user = (await core.ensureUser({ subject: 'test:admin', displayName: 'Admin' })).unwrap()
	;(await core.grantRole(user.id, 'admin')).unwrap()
	const admin = await core.principalOf(user.id)
	const category = (await core.createCategory(admin, { name: 'General' })).unwrap()
	const thread = (
		await core.createThread(admin, { categoryId: category.id, title: 'Markdown', body })
	).unwrap()
	return async (from: ForumCorePlugin = core) =>
		(await from.getThread(admin, thread.id)).unwrap().posts.items[0]
}

describe('ForumMarkdownPlugin', () => {
	it('renders posts as Markdown only while it runs', async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin)
		const read = await openingPost(core, '**你好** <i>x</i>')

		expect(await read()).toMatchObject({
			bodyFormat: 'plain',
			bodyHtml: '**你好** &lt;i&gt;x&lt;/i&gt;',
		})

		await host.start(ForumMarkdownPlugin)
		expect(core.contentRendererId()).toBe(MARKDOWN_RENDERER_ID)
		expect(await read()).toMatchObject({
			body: '**你好** <i>x</i>',
			bodyFormat: 'markdown',
			bodyHtml: '<p><strong>你好</strong> &lt;i&gt;x&lt;/i&gt;</p>\n',
		})

		await host.stop(ForumMarkdownPlugin)
		expect(core.contentRendererId()).toBeNull()
		expect((await read()).bodyFormat).toBe('plain')
	})

	it('registers again after the core restarts', async () => {
		await using host = await createHost()
		const before = (await host.start([ForumCorePlugin, ForumMarkdownPlugin]))[0]
		const read = await openingPost(before, '## 标题')

		const core = await host.restart(ForumCorePlugin)
		expect(core).not.toBe(before)
		expect(host.isRunning(ForumMarkdownPlugin)).toBe(true)
		expect(core.contentRendererId()).toBe(MARKDOWN_RENDERER_ID)
		expect((await read(core)).bodyHtml).toBe('<h2>标题</h2>\n')
	})

	it('has its links filtered by the core', async () => {
		await using host = await createHost()
		const core = (await host.start([ForumCorePlugin, ForumMarkdownPlugin]))[0]
		const read = await openingPost(
			core,
			'[坏](javascript:alert(1)) [外](https://example.com/?a=1&b=2) [内](/c/general)',
		)

		expect((await read()).bodyHtml).toBe(
			'<p><a>坏</a> <a href="https://example.com/?a=1&amp;b=2" rel="nofollow ugc noopener">外</a> <a href="/c/general">内</a></p>\n',
		)
	})
})
