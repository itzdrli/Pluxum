import { ForumCorePlugin } from '@forum/forum-core'
import { defineDevConsole } from '@pluxel/host-vite/console'

const categories = [
	{ slug: 'announcements', name: '公告', description: '站点动态与版本更新。' },
	{ slug: 'general', name: '综合讨论', description: '随便聊聊，和论坛有关的都可以。' },
	{ slug: 'plugins', name: '插件开发', description: '写插件、扩展点和框架用法。' },
	{ slug: 'feedback', name: '问题反馈', description: '报告问题，或者提一个建议。' },
] as const

const welcome = {
	title: '欢迎来到 Pluxel Forum',
	body: '这是开发种子脚本写入的第一个主题。\n\n可以在这里试试回复、编辑和删除。',
	replies: ['第一条回复，用来看列表和分页的样子。', '锁定主题以后，普通成员就不能再回复了。'],
}

// vp exec pluxel dev run host/web/dev/seed.ts → create the starter categories and a welcome thread
// Safe to repeat: existing category slugs are kept as they are, and the welcome thread is written
// only together with a newly created announcements category.
export default defineDevConsole(async (dev) => {
	const core = dev.plugins.require(ForumCorePlugin)
	const user = await core.ensureUser({ subject: 'dev:local', displayName: '开发者' })
	if (user.isErr()) throw new Error(user.error.message)
	// The core trusts the principal it is given; seeding acts as an admin regardless of stored roles.
	const admin = { userId: user.value.id, roles: ['member', 'admin'] } as const

	const existing = new Set((await core.listCategories(admin)).map((category) => category.slug))
	const missing = categories
		.map((category, position) => ({ ...category, position }))
		.filter((category) => !existing.has(category.slug))
	const created = await Promise.all(
		missing.map(async (category) => {
			const result = await core.createCategory(admin, category)
			if (result.isErr()) throw new Error(`${category.slug}: ${result.error.message}`)
			return result.value
		}),
	)

	let threadId: string | null = null
	const announcements = created.find((category) => category.slug === 'announcements')
	if (announcements) {
		const thread = await core.createThread(admin, {
			categoryId: announcements.id,
			title: welcome.title,
			body: welcome.body,
		})
		if (thread.isErr()) throw new Error(thread.error.message)
		threadId = thread.value.id
		// One after the other, so the replies keep their order.
		await welcome.replies.reduce(async (previous, body) => {
			await previous
			const reply = await core.createPost(admin, { threadId: thread.value.id, body })
			if (reply.isErr()) throw new Error(reply.error.message)
		}, Promise.resolve())
	}
	return { created: created.map((category) => category.slug), kept: [...existing], threadId }
})
