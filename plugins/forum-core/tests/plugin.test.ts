import { GUEST, type Principal } from '@forum/domain'
import { ForumCorePlugin, type ForumResult } from '@forum/forum-core'
import { BasePlugin, Plugin } from '@pluxel/core'
import { database } from '@pluxel/services/database'
import { pglite } from '@pluxel/services/database/pglite'
import { createTestHost } from '@pluxel/test'
import { describe, expect, it } from 'vitest'

const MISSING_ID = '00000000-0000-4000-8000-000000000000'

const createHost = () =>
	createTestHost({ services: [database({ backend: pglite({ dataDir: 'memory://' }) })] })

/** The failure code of an operation, or undefined when it succeeded. */
async function codeOf(pending: Promise<ForumResult<unknown>>) {
	const result = await pending
	return result.isErr() ? result.error.code : undefined
}

async function signUp(core: ForumCorePlugin, name: string): Promise<Principal> {
	const user = (await core.ensureUser({ subject: `test:${name}`, displayName: name })).unwrap()
	return core.principalOf(user.id)
}

/** An admin, two members and one category to post in. */
async function seed(core: ForumCorePlugin) {
	const adminUser = (
		await core.ensureUser({ subject: 'test:admin', displayName: 'Admin' })
	).unwrap()
	;(await core.grantRole(adminUser.id, 'admin')).unwrap()
	const admin = await core.principalOf(adminUser.id)
	const alice = await signUp(core, 'Alice')
	const bob = await signUp(core, 'Bob')
	const category = (
		await core.createCategory(admin, { name: 'General', description: 'Anything goes' })
	).unwrap()
	return { admin, alice, bob, category }
}

/** Blocks replies for everyone while it runs, to observe contribution and withdrawal. */
@Plugin()
class FreezeRepliesPlugin extends BasePlugin {
	constructor(private readonly core: ForumCorePlugin) {
		super()
	}

	protected override init(): void {
		this.ctx.effects.defer(
			this.core.registerPermissionPolicy({
				id: 'test.freeze-replies',
				evaluate: ({ action }) => (action === 'post.create' ? 'deny' : 'abstain'),
			}),
		)
	}
}

/** Registers an ID that the core already uses, which must fail its own start only. */
@Plugin()
class DuplicatePolicyPlugin extends BasePlugin {
	constructor(private readonly core: ForumCorePlugin) {
		super()
	}

	protected override init(): void {
		this.ctx.effects.defer(
			this.core.registerPermissionPolicy({ id: 'forum-core.roles', evaluate: () => 'allow' }),
		)
	}
}

/** Renders every post in capitals, to observe the content renderer slot. */
@Plugin()
class ShoutPlugin extends BasePlugin {
	constructor(private readonly core: ForumCorePlugin) {
		super()
	}

	protected override init(): void {
		this.ctx.effects.defer(
			this.core.registerContentRenderer({
				id: 'test.shout',
				format: 'markdown',
				render: (source) => `<p>${source.toUpperCase()}</p>`,
			}),
		)
	}
}

/** A second renderer, which the core must refuse while another is installed. */
@Plugin()
class SecondRendererPlugin extends BasePlugin {
	constructor(private readonly core: ForumCorePlugin) {
		super()
	}

	protected override init(): void {
		this.ctx.effects.defer(
			this.core.registerContentRenderer({
				id: 'test.second',
				format: 'markdown',
				render: (source) => `<p>${source}</p>`,
			}),
		)
	}
}

/** A renderer with a bug: it throws for every post. */
@Plugin()
class BrokenRendererPlugin extends BasePlugin {
	constructor(private readonly core: ForumCorePlugin) {
		super()
	}

	protected override init(): void {
		this.ctx.effects.defer(
			this.core.registerContentRenderer({
				id: 'test.broken',
				format: 'markdown',
				render: () => {
					throw new Error('renderer bug')
				},
			}),
		)
	}
}

/** Passes the source through as HTML, so tests can feed the core's filter directly. */
@Plugin()
class RawHtmlPlugin extends BasePlugin {
	constructor(private readonly core: ForumCorePlugin) {
		super()
	}

	protected override init(): void {
		this.ctx.effects.defer(
			this.core.registerContentRenderer({
				id: 'test.raw',
				format: 'markdown',
				render: (source) => source,
			}),
		)
	}
}

/** Post IDs of every batch the badge extension was asked for, to prove one call per page. */
const badgeBatches: string[][] = []

/** Tags every post with who is looking and fills a slot, to observe the extension registries. */
@Plugin()
class BadgePlugin extends BasePlugin {
	constructor(private readonly core: ForumCorePlugin) {
		super()
	}

	protected override init(): void {
		this.ctx.effects.defer(
			this.core.registerEntityExtension({
				id: 'test.badge',
				entity: 'post',
				load: (ids, viewer) => {
					badgeBatches.push([...ids])
					return Promise.resolve(new Map(ids.map((id) => [id, { seenBy: viewer.userId }])))
				},
			}),
		)
		this.ctx.effects.defer(
			this.core.registerUiSlots({ id: 'test.badge', slots: ['post.footer', 'post.actions'] }),
		)
	}
}

/** Reuses the badge's extension ID for posts, which must fail its own start only. */
@Plugin()
class DuplicateBadgePlugin extends BasePlugin {
	constructor(private readonly core: ForumCorePlugin) {
		super()
	}

	protected override init(): void {
		this.ctx.effects.defer(
			this.core.registerEntityExtension({
				id: 'test.badge',
				entity: 'post',
				load: () => Promise.resolve(new Map()),
			}),
		)
	}
}

/** Two faulty extensions: one throws for posts, one never answers for threads. */
@Plugin()
class FaultyExtensionsPlugin extends BasePlugin {
	constructor(private readonly core: ForumCorePlugin) {
		super()
	}

	protected override init(): void {
		this.ctx.effects.defer(
			this.core.registerEntityExtension({
				id: 'test.throws',
				entity: 'post',
				load: () => {
					throw new Error('extension bug')
				},
			}),
		)
		this.ctx.effects.defer(
			this.core.registerEntityExtension({
				id: 'test.hangs',
				entity: 'thread',
				load: () => new Promise(() => {}),
			}),
		)
	}
}

/** Names a slot the frontend does not have. */
@Plugin()
class UnknownSlotPlugin extends BasePlugin {
	constructor(private readonly core: ForumCorePlugin) {
		super()
	}

	protected override init(): void {
		this.ctx.effects.defer(
			// @ts-expect-error -- the slot name is deliberately not one of UI_SLOTS
			this.core.registerUiSlots({ id: 'test.unknown-slot', slots: ['post.nowhere'] }),
		)
	}
}

describe('ForumCorePlugin', () => {
	it('creates accounts once per subject and resolves their roles', async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin)

		const first = (await core.ensureUser({ subject: 'idp|1', displayName: ' Ada  L ' })).unwrap()
		const again = (await core.ensureUser({ subject: 'idp|1', displayName: 'Renamed' })).unwrap()
		expect(first).toEqual({ id: again.id, displayName: 'Ada L' })
		expect(again.displayName).toBe('Ada L')

		expect(await core.principalOf(first.id)).toEqual({ userId: first.id, roles: ['member'] })
		;(await core.grantRole(first.id, 'moderator')).unwrap()
		;(await core.grantRole(first.id, 'moderator')).unwrap()
		expect((await core.principalOf(first.id)).roles).toEqual(['member', 'moderator'])
		;(await core.revokeRole(first.id, 'moderator')).unwrap()
		expect((await core.principalOf(first.id)).roles).toEqual(['member'])

		expect(await core.principalOf(null)).toEqual(GUEST)
		expect(await core.principalOf(MISSING_ID)).toEqual(GUEST)
		expect(await core.principalOf('not-an-id')).toEqual(GUEST)
		expect((await core.grantRole(MISSING_ID, 'admin')).isErr()).toBe(true)
		expect((await core.ensureUser({ subject: ' ', displayName: 'x' })).isErr()).toBe(true)
	})

	it('runs a thread from creation through replies with consistent counters', async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin)
		const { alice, bob, category } = await seed(core)

		const thread = (
			await core.createThread(alice, {
				categoryId: category.id,
				title: '  Hello   forum ',
				body: 'First post\r\nwith two lines',
			})
		).unwrap()
		expect(thread).toMatchObject({
			categoryId: category.id,
			title: 'Hello forum',
			author: { id: alice.userId, displayName: 'Alice' },
			replyCount: 0,
			pinned: false,
			locked: false,
		})

		const reply = (await core.createPost(bob, { threadId: thread.id, body: 'Welcome!' })).unwrap()
		expect(reply).toMatchObject({
			threadId: thread.id,
			author: { displayName: 'Bob' },
			body: 'Welcome!',
			deleted: false,
			editedAt: null,
			can: { edit: true, delete: true },
		})

		const listing = (await core.listThreads(GUEST, category.slug)).unwrap()
		expect(listing.category).toMatchObject({ slug: 'general', threadCount: 1, postCount: 2 })
		expect(listing.can.createThread).toBe(false)
		expect(listing.threads).toMatchObject({ page: 1, total: 1 })
		expect(listing.threads.items[0]).toMatchObject({ id: thread.id, replyCount: 1 })
		expect(Date.parse(listing.threads.items[0].lastPostAt)).toBeGreaterThanOrEqual(
			Date.parse(thread.createdAt),
		)

		const detail = (await core.getThread(bob, thread.id)).unwrap()
		expect(detail.posts.total).toBe(2)
		expect(detail.posts.items.map((post) => post.body)).toEqual([
			'First post\nwith two lines',
			'Welcome!',
		])
		// The opening post is never deletable on its own; Bob may only touch his reply.
		expect(detail.posts.items.map((post) => post.can)).toEqual([
			{ edit: false, delete: false },
			{ edit: true, delete: true },
		])
		expect(detail.can).toEqual({ reply: true, edit: false, delete: false, moderate: false })
	})

	it('orders threads by pin, then latest activity, and pages them', async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin)
		const { admin, alice, category } = await seed(core)
		const open = async (title: string) =>
			(await core.createThread(alice, { categoryId: category.id, title, body: 'x' })).unwrap()

		const first = await open('first')
		const second = await open('second')
		const third = await open('third')
		;(await core.createPost(alice, { threadId: first.id, body: 'bump' })).unwrap()
		;(await core.updateThread(admin, second.id, { pinned: true })).unwrap()

		const titles = async (page: number) =>
			(await core.listThreads(GUEST, category.slug, { page, pageSize: 2 }))
				.unwrap()
				.threads.items.map((thread) => thread.title)
		expect(await titles(1)).toEqual(['second', 'first'])
		expect(await titles(2)).toEqual(['third'])
		expect(third.title).toBe('third')
	})

	it('rejects writes from guests and from members without the right', async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin)
		const { admin, alice, bob, category } = await seed(core)
		const thread = (
			await core.createThread(alice, { categoryId: category.id, title: 'Rules', body: 'Be kind' })
		).unwrap()
		const opening = (await core.getThread(alice, thread.id)).unwrap().posts.items[0]

		expect(
			await codeOf(core.createThread(GUEST, { categoryId: category.id, title: 't', body: 'b' })),
		).toBe('unauthenticated')
		expect(await codeOf(core.createPost(GUEST, { threadId: thread.id, body: 'b' }))).toBe(
			'unauthenticated',
		)
		expect(await codeOf(core.createCategory(alice, { name: 'Mine' }))).toBe('forbidden')
		expect(await codeOf(core.updatePost(bob, opening.id, { body: 'hijacked' }))).toBe('forbidden')
		expect(await codeOf(core.updateThread(bob, thread.id, { title: 'hijacked' }))).toBe('forbidden')
		expect(await codeOf(core.updateThread(alice, thread.id, { pinned: true }))).toBe('forbidden')
		expect(await codeOf(core.deleteThread(bob, thread.id))).toBe('forbidden')

		// Locking freezes the thread for members, including its author, but not for staff.
		;(await core.updateThread(admin, thread.id, { locked: true })).unwrap()
		expect(await codeOf(core.createPost(bob, { threadId: thread.id, body: 'late' }))).toBe(
			'forbidden',
		)
		expect(await codeOf(core.updatePost(alice, opening.id, { body: 'edited' }))).toBe('forbidden')
		expect((await core.createPost(admin, { threadId: thread.id, body: 'Closed.' })).isOk()).toBe(
			true,
		)
		// Nothing above changed what Alice wrote.
		expect((await core.getThread(GUEST, thread.id)).unwrap().posts.items[0].body).toBe('Be kind')
	})

	it('validates input and reports missing or conflicting entities', async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin)
		const { admin, alice, category } = await seed(core)

		expect(await codeOf(core.createCategory(admin, { name: 'General' }))).toBe('conflict')
		expect(await codeOf(core.createCategory(admin, { name: '综合讨论' }))).toBe('invalid')
		expect(
			(await core.createCategory(admin, { name: '综合讨论', slug: 'zonghe' })).unwrap().slug,
		).toBe('zonghe')
		expect(await codeOf(core.updateCategory(admin, category.id, { slug: 'zonghe' }))).toBe(
			'conflict',
		)
		expect(await codeOf(core.createCategory(admin, { name: 'Bad', slug: 'Not A Slug' }))).toBe(
			'invalid',
		)

		expect(
			await codeOf(core.createThread(alice, { categoryId: category.id, title: ' ', body: 'b' })),
		).toBe('invalid')
		expect(
			await codeOf(core.createThread(alice, { categoryId: category.id, title: 't', body: ' \n' })),
		).toBe('invalid')
		expect(
			await codeOf(core.createThread(alice, { categoryId: MISSING_ID, title: 't', body: 'b' })),
		).toBe('not_found')
		expect(await codeOf(core.createPost(alice, { threadId: 'nope', body: 'b' }))).toBe('not_found')
		expect(await codeOf(core.getThread(alice, MISSING_ID))).toBe('not_found')
		expect(await codeOf(core.listThreads(alice, 'no-such-category'))).toBe('not_found')
		expect(await codeOf(core.updatePost(alice, MISSING_ID, { body: 'b' }))).toBe('not_found')

		// Failed operations left the counters alone.
		const [general] = await core.listCategories(GUEST)
		expect(general).toMatchObject({ slug: 'general', threadCount: 0, postCount: 0 })
	})

	it('edits posts with history and hides deleted posts and threads', async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin)
		const { admin, alice, bob, category } = await seed(core)
		const thread = (
			await core.createThread(alice, { categoryId: category.id, title: 'Draft', body: 'v1' })
		).unwrap()
		const reply = (await core.createPost(bob, { threadId: thread.id, body: 'typo' })).unwrap()
		const opening = (await core.getThread(alice, thread.id)).unwrap().posts.items[0]

		const unchanged = (await core.updatePost(bob, reply.id, { body: 'typo' })).unwrap()
		expect(unchanged.editedAt).toBeNull()
		const edited = (await core.updatePost(bob, reply.id, { body: 'fixed' })).unwrap()
		expect(edited.body).toBe('fixed')
		expect(edited.editedAt).not.toBeNull()
		expect((await core.updateThread(alice, thread.id, { title: 'Final' })).unwrap().title).toBe(
			'Final',
		)

		expect(await codeOf(core.deletePost(alice, opening.id))).toBe('conflict')
		expect(await codeOf(core.deletePost(alice, reply.id))).toBe('forbidden')
		;(await core.deletePost(bob, reply.id)).unwrap()
		const afterDelete = (await core.getThread(bob, thread.id)).unwrap()
		expect(afterDelete.thread.replyCount).toBe(0)
		expect(afterDelete.category.postCount).toBe(1)
		expect(afterDelete.posts.items[1]).toMatchObject({
			id: reply.id,
			deleted: true,
			body: '',
			can: { edit: false, delete: false },
		})
		// A deleted post can be neither edited nor deleted twice.
		expect(await codeOf(core.updatePost(bob, reply.id, { body: 'again' }))).toBe('not_found')
		expect(await codeOf(core.deletePost(bob, reply.id))).toBe('not_found')

		expect(await codeOf(core.deleteCategory(admin, category.id))).toBe('conflict')
		;(await core.deleteThread(alice, thread.id)).unwrap()
		expect(await codeOf(core.getThread(admin, thread.id))).toBe('not_found')
		expect(await codeOf(core.createPost(bob, { threadId: thread.id, body: 'x' }))).toBe('not_found')
		const listing = (await core.listThreads(GUEST, category.slug)).unwrap()
		expect(listing.threads.total).toBe(0)
		expect(listing.category).toMatchObject({ threadCount: 0, postCount: 0 })

		const empty = (await core.createCategory(admin, { name: 'Empty' })).unwrap()
		;(await core.deleteCategory(admin, empty.id)).unwrap()
		expect((await core.listCategories(GUEST)).map((item) => item.slug)).toEqual(['general'])
	})

	it('keeps data across a restart of the plugin', async () => {
		await using host = await createHost()
		let core = await host.start(ForumCorePlugin)
		const { alice, category } = await seed(core)
		const thread = (
			await core.createThread(alice, { categoryId: category.id, title: 'Durable', body: 'yes' })
		).unwrap()

		core = await host.restart(ForumCorePlugin)
		const detail = (await core.getThread(GUEST, thread.id)).unwrap()
		expect(detail.thread.title).toBe('Durable')
		expect(detail.posts.items[0].author.displayName).toBe('Alice')
	})
})

describe('permission policy registry', () => {
	it('applies a contributed policy only while its contributor runs', async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin)
		const { alice, category } = await seed(core)
		const thread = (
			await core.createThread(alice, { categoryId: category.id, title: 'Open', body: 'x' })
		).unwrap()
		const reply = () => core.createPost(alice, { threadId: thread.id, body: 'reply' })

		expect((await reply()).isOk()).toBe(true)

		await host.start(FreezeRepliesPlugin)
		expect(core.permissionPolicyIds()).toEqual(['forum-core.roles', 'test.freeze-replies'])
		expect(await codeOf(reply())).toBe('forbidden')
		expect((await core.getThread(alice, thread.id)).unwrap().can.reply).toBe(false)

		await host.stop(FreezeRepliesPlugin)
		expect(core.permissionPolicyIds()).toEqual(['forum-core.roles'])
		expect((await reply()).isOk()).toBe(true)
	})

	it('re-registers contributions after the core restarts', async () => {
		await using host = await createHost()
		await host.start([ForumCorePlugin, FreezeRepliesPlugin])
		const before = host.require(ForumCorePlugin)

		const core = await host.restart(ForumCorePlugin)
		expect(core).not.toBe(before)
		expect(host.isRunning(FreezeRepliesPlugin)).toBe(true)
		expect(core.permissionPolicyIds()).toEqual(['forum-core.roles', 'test.freeze-replies'])
	})

	it('fails a contributor that reuses a registered ID without disturbing the core', async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin)

		const failure = await host.commitExpectFail((change) => change.start(DuplicatePolicyPlugin))
		expect(failure.lifecycleReport.issues).toContainEqual(
			expect.objectContaining({ kind: 'start-failed' }),
		)
		expect(host.isRunning(ForumCorePlugin)).toBe(true)
		expect(core.permissionPolicyIds()).toEqual(['forum-core.roles'])
		expect(core.can(GUEST, 'thread.view')).toBe(true)
	})
})

/** A thread whose opening post has the given source; returns a reader of that post. */
async function openingPost(core: ForumCorePlugin, body: string) {
	const { alice, category } = await seed(core)
	const thread = (
		await core.createThread(alice, { categoryId: category.id, title: 'Content', body })
	).unwrap()
	return async (from: ForumCorePlugin = core) =>
		(await from.getThread(alice, thread.id)).unwrap().posts.items[0]
}

describe('content renderer', () => {
	it('shows posts as escaped plain text without a renderer', async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin)
		const read = await openingPost(core, `<b>1 & 2</b>\n"it's"`)

		expect(core.contentRendererId()).toBeNull()
		expect(await read()).toMatchObject({
			body: `<b>1 & 2</b>\n"it's"`,
			bodyFormat: 'plain',
			bodyHtml: '&lt;b&gt;1 &amp; 2&lt;/b&gt;\n&quot;it&#39;s&quot;',
		})
	})

	it('uses a contributed renderer only while its contributor runs', async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin)
		const read = await openingPost(core, 'hello')

		await host.start(ShoutPlugin)
		expect(core.contentRendererId()).toBe('test.shout')
		expect(await read()).toMatchObject({
			body: 'hello',
			bodyFormat: 'markdown',
			bodyHtml: '<p>HELLO</p>',
		})

		await host.stop(ShoutPlugin)
		expect(core.contentRendererId()).toBeNull()
		expect(await read()).toMatchObject({ bodyFormat: 'plain', bodyHtml: 'hello' })
	})

	it('re-installs the renderer after the core restarts', async () => {
		await using host = await createHost()
		const before = (await host.start([ForumCorePlugin, ShoutPlugin]))[0]
		const read = await openingPost(before, 'hello')

		const core = await host.restart(ForumCorePlugin)
		expect(core).not.toBe(before)
		expect(host.isRunning(ShoutPlugin)).toBe(true)
		expect((await read(core)).bodyHtml).toBe('<p>HELLO</p>')
	})

	it('refuses a second renderer and accepts it once the first has stopped', async () => {
		await using host = await createHost()
		const core = (await host.start([ForumCorePlugin, ShoutPlugin]))[0]

		const failure = await host.commitExpectFail((change) => change.start(SecondRendererPlugin))
		expect(failure.lifecycleReport.issues).toContainEqual(
			expect.objectContaining({ kind: 'start-failed' }),
		)
		expect(core.contentRendererId()).toBe('test.shout')

		await host.stop(ShoutPlugin)
		await host.start(SecondRendererPlugin)
		expect(core.contentRendererId()).toBe('test.second')
	})

	it('falls back to plain text when the renderer throws', async () => {
		await using host = await createHost()
		const core = (await host.start([ForumCorePlugin, BrokenRendererPlugin]))[0]
		const read = await openingPost(core, 'a < b')

		expect(await read()).toMatchObject({ bodyFormat: 'plain', bodyHtml: 'a &lt; b' })
	})

	it('filters renderer output down to the allowlist', async () => {
		await using host = await createHost()
		const core = (await host.start([ForumCorePlugin, RawHtmlPlugin]))[0]
		const source = [
			'<h1>t</h1><h2 id="x" onclick="evil()">ok</h2>',
			'<script>alert(1)</script><style>p{}</style><img src=x onerror=alert(1)>',
			'<p style="color:red">text <span class="a">span</span></p>',
			'<a href="javascript:alert(1)">js</a>',
			'<a href="//evil.example/x">relative protocol</a>',
			'<a href="/\\evil.example/x">backslash</a><a href=" JaVaScRiPt:alert(1)">case</a>',
			'<a href="https://example.com/a" target="_blank" rel="opener">out</a>',
			'<a href="/c/general" rel="x">in</a><a href="mailto:a@example.com">mail</a>',
			'<pre><code class="language-ts evil">code</code></pre><ol start="3"><li>x</li></ol>',
			'<iframe src="https://example.com"></iframe><form><input name="q"></form>',
		].join('\n')
		const read = await openingPost(core, source)

		expect((await read()).bodyHtml).toBe(
			[
				't<h2>ok</h2>',
				'',
				'<p>text span</p>',
				'<a>js</a>',
				'<a>relative protocol</a>',
				'<a>backslash</a><a>case</a>',
				'<a href="https://example.com/a" rel="nofollow ugc noopener">out</a>',
				'<a href="/c/general">in</a><a href="mailto:a@example.com">mail</a>',
				'<pre><code class="language-ts">code</code></pre><ol start="3"><li>x</li></ol>',
				'',
			].join('\n'),
		)
	})

	it('renders nothing for a deleted post', async () => {
		await using host = await createHost()
		const core = (await host.start([ForumCorePlugin, ShoutPlugin]))[0]
		const { alice, admin, category } = await seed(core)
		const thread = (
			await core.createThread(alice, { categoryId: category.id, title: 'T', body: 'x' })
		).unwrap()
		const reply = (await core.createPost(alice, { threadId: thread.id, body: 'gone' })).unwrap()
		expect(reply.bodyHtml).toBe('<p>GONE</p>')
		;(await core.deletePost(admin, reply.id)).unwrap()

		const detail = (await core.getThread(alice, thread.id)).unwrap()
		expect(detail.posts.items[1]).toMatchObject({ deleted: true, body: '', bodyHtml: '' })
	})
})

describe('entity extensions and UI slots', () => {
	it('attaches extension data in one batch per page, only while the contributor runs', async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin)
		const { alice, bob, category } = await seed(core)
		const thread = (
			await core.createThread(alice, { categoryId: category.id, title: 'Ext', body: 'one' })
		).unwrap()
		;(await core.createPost(bob, { threadId: thread.id, body: 'two' })).unwrap()
		const read = async () => (await core.getThread(bob, thread.id)).unwrap()

		expect((await read()).posts.items.map((post) => post.ext)).toEqual([{}, {}])
		expect(core.uiSlots()).toEqual([])

		badgeBatches.length = 0
		await host.start(BadgePlugin)
		expect(core.entityExtensionIds('post')).toEqual(['test.badge'])
		expect(core.entityExtensionIds('thread')).toEqual([])
		expect(core.uiSlots()).toEqual([
			{ slot: 'post.footer', extId: 'test.badge' },
			{ slot: 'post.actions', extId: 'test.badge' },
		])
		const page = await read()
		expect(page.posts.items.map((post) => post.ext)).toEqual([
			{ 'test.badge': { seenBy: bob.userId } },
			{ 'test.badge': { seenBy: bob.userId } },
		])
		expect(page.thread.ext).toEqual({})
		expect(badgeBatches).toEqual([page.posts.items.map((post) => post.id)])
		// A post that a write returns carries the data as well.
		const third = (await core.createPost(alice, { threadId: thread.id, body: 'three' })).unwrap()
		expect(third.ext).toEqual({ 'test.badge': { seenBy: alice.userId } })

		await host.stop(BadgePlugin)
		expect(core.entityExtensionIds('post')).toEqual([])
		expect(core.uiSlots()).toEqual([])
		expect((await read()).posts.items.map((post) => post.ext)).toEqual([{}, {}, {}])
	})

	it('re-registers extensions and slots after the core restarts', async () => {
		await using host = await createHost()
		const before = (await host.start([ForumCorePlugin, BadgePlugin]))[0]

		const core = await host.restart(ForumCorePlugin)
		expect(core).not.toBe(before)
		expect(host.isRunning(BadgePlugin)).toBe(true)
		expect(core.entityExtensionIds('post')).toEqual(['test.badge'])
		expect(core.uiSlots()).toHaveLength(2)
	})

	it('fails a contributor with a taken ID or an unknown slot without disturbing the rest', async () => {
		await using host = await createHost()
		const core = (await host.start([ForumCorePlugin, BadgePlugin]))[0]

		const duplicate = await host.commitExpectFail((change) => change.start(DuplicateBadgePlugin))
		const unknownSlot = await host.commitExpectFail((change) => change.start(UnknownSlotPlugin))
		for (const failure of [duplicate, unknownSlot]) {
			expect(failure.lifecycleReport.issues).toContainEqual(
				expect.objectContaining({ kind: 'start-failed' }),
			)
		}
		expect(core.entityExtensionIds('post')).toEqual(['test.badge'])
		expect(core.uiSlots()).toHaveLength(2)
	})

	it('serves pages without an extension that throws or does not answer', async () => {
		await using host = await createHost()
		const core = (await host.start([ForumCorePlugin, BadgePlugin, FaultyExtensionsPlugin]))[0]
		const { alice, category } = await seed(core)
		// Creating the thread already waits out the extension that never answers.
		const thread = (
			await core.createThread(alice, { categoryId: category.id, title: 'Faulty', body: 'x' })
		).unwrap()
		expect(thread.ext).toEqual({})

		const page = (await core.getThread(alice, thread.id)).unwrap()
		expect(page.thread.ext).toEqual({})
		expect(page.posts.items[0]?.ext).toEqual({ 'test.badge': { seenBy: alice.userId } })
	})

	it('locates only posts the principal can see', async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin)
		const { alice, bob, category } = await seed(core)
		const thread = (
			await core.createThread(alice, { categoryId: category.id, title: 'Where', body: 'x' })
		).unwrap()
		const reply = (await core.createPost(bob, { threadId: thread.id, body: 'y' })).unwrap()

		expect((await core.locatePost(GUEST, reply.id)).unwrap()).toEqual({
			postId: reply.id,
			threadId: thread.id,
			resource: {
				categoryId: category.id,
				threadId: thread.id,
				postId: reply.id,
				authorId: bob.userId,
				locked: false,
			},
		})
		expect(await codeOf(core.locatePost(alice, MISSING_ID))).toBe('not_found')
		expect(await codeOf(core.locatePost(alice, 'nope'))).toBe('not_found')
		;(await core.deletePost(bob, reply.id)).unwrap()
		expect(await codeOf(core.locatePost(alice, reply.id))).toBe('not_found')
	})

	it('previews a body with the installed renderer', async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin)

		expect(core.contentFormat()).toBe('plain')
		expect(core.previewBody('a < b').unwrap()).toEqual({
			bodyHtml: 'a &lt; b',
			bodyFormat: 'plain',
		})
		expect(core.previewBody('   ').isErr()).toBe(true)

		await host.start(ShoutPlugin)
		expect(core.contentFormat()).toBe('markdown')
		expect(core.previewBody('hi').unwrap()).toEqual({
			bodyHtml: '<p>HI</p>',
			bodyFormat: 'markdown',
		})
	})
})
