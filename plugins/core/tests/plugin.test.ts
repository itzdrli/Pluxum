import { GUEST, type ForumNotification, type Principal } from '@pluxum/domain'
import {
	ForumCorePlugin,
	type ActivityQuery,
	type ForumResult,
	type PostAfterWriteEvent,
	type SearchProviderQuery,
} from '@pluxum/core'
import { BasePlugin, Plugin } from '@pluxel/core'
import { pglite } from '@pluxel/services/pg/pglite'
import { createTestHost } from '@pluxel/test'
import { describe, expect, it } from 'vitest'

const MISSING_ID = '00000000-0000-4000-8000-000000000000'

/** Lets the clock move on, so what follows is strictly later than what came before. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

const createHost = () => createTestHost({ services: [pglite({ dataDir: 'memory://' })] })

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
		const core = await host.start(ForumCorePlugin.nodeAddress())

		const first = (await core.ensureUser({ subject: 'idp|1', displayName: ' Ada  L ' })).unwrap()
		const again = (await core.ensureUser({ subject: 'idp|1', displayName: 'Renamed' })).unwrap()
		expect(first).toEqual({ id: again.id, handle: 'ada-l', displayName: 'Ada L' })
		expect(again.displayName).toBe('Ada L')

		// A second account with the same derived handle gets a numeric suffix; pure-CJK gets u<number>.
		const duplicate = (await core.ensureUser({ subject: 'idp|2', displayName: 'Ada L' })).unwrap()
		expect(duplicate.handle).toBe('ada-l-2')
		const cjk = (await core.ensureUser({ subject: 'idp|3', displayName: '张三' })).unwrap()
		expect(cjk.handle).toBe('u3')

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

	it('lists accounts for admin tooling, newest first, with roles and a name filter', async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin.nodeAddress())
		const ada = (await core.ensureUser({ subject: 'idp|a', displayName: 'Ada' })).unwrap()
		const bob = (await core.ensureUser({ subject: 'idp|b', displayName: 'Bob 100%' })).unwrap()
		;(await core.grantRole(ada.id, 'admin')).unwrap()

		const all = await core.listUsers()
		expect(all.total).toBe(2)
		expect(all.items.map((user) => [user.id, user.roles])).toEqual([
			[bob.id, []],
			[ada.id, ['admin']],
		])
		expect((await core.listUsers({ query: 'ADA' })).items.map((user) => user.id)).toEqual([ada.id])
		// LIKE wildcards in the query match literally.
		expect((await core.listUsers({ query: '%' })).items.map((user) => user.id)).toEqual([bob.id])
		expect(await core.listUsers({ query: 'nobody' })).toMatchObject({ items: [], total: 0 })
		const second = await core.listUsers({ page: 2, pageSize: 1 })
		expect(second.items.map((user) => user.id)).toEqual([ada.id])
	})

	it('removes an account, handing what it wrote to Ghost', async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin.nodeAddress())
		const { admin, alice, bob, category } = await seed(core)
		const thread = (
			await core.createThread(alice, { categoryId: category.id, title: 'Hi', body: 'Opening' })
		).unwrap()
		;(await core.createPost(alice, { threadId: thread.id, body: 'Mine too' })).unwrap()
		;(await core.createPost(bob, { threadId: thread.id, body: 'Bob here' })).unwrap()
		const handlers: string[] = []
		const dispose = core.registerUserRemoval({
			id: 'test.removal',
			remove: ({ userId, ghostId }) => {
				handlers.push(`${userId}>${ghostId}`)
			},
		})
		// Nobody new gets the handle, even before Ghost exists.
		expect(
			(await core.ensureUser({ subject: 'test:ghosty', displayName: 'Ghost' })).unwrap().handle,
		).not.toBe('ghost')

		;(await core.removeUser(alice.userId!)).unwrap()
		dispose()
		const ghost = (await core.getUser('ghost')).unwrap()
		expect(ghost.displayName).toBe('Ghost')
		expect(handlers).toEqual([`${alice.userId}>${ghost.id}`])
		expect(await codeOf(core.getUser(alice.userId!))).toBe('not_found')
		// Its page shows only the name: no counts, no list.
		const profile = (await core.getUserProfile(admin, 'ghost')).unwrap()
		expect(profile).toMatchObject({
			ghost: true,
			threadCount: 0,
			postCount: 0,
			can: { edit: false },
		})
		expect(profile.threads.items).toEqual([])
		expect((await core.getUserProfile(admin, bob.userId!)).unwrap().ghost).toBe(false)
		const page = (await core.getThread(GUEST, thread.id)).unwrap()
		expect(page.thread.author.id).toBe(ghost.id)

		// Ghost is nobody's member, can't be edited, given roles or removed, and gets no mail.
		expect((await core.listUsers()).items.map((user) => user.handle)).not.toContain('ghost')
		expect((await core.communityPulse(GUEST)).newMembers.map((user) => user.id)).not.toContain(
			ghost.id,
		)
		expect(await codeOf(core.updateProfile(admin, 'ghost', { displayName: 'Boo' }))).toBe(
			'forbidden',
		)
		expect(await codeOf(core.updateProfile(bob, bob.userId!, { handle: 'ghost' }))).toBe('conflict')
		expect(await codeOf(core.grantRole(ghost.id, 'admin'))).toBe('not_found')
		expect(await codeOf(core.removeUser(ghost.id))).toBe('forbidden')
		// A second removal reuses the same Ghost.
		;(await core.removeUser(bob.userId!)).unwrap()
		expect(
			(await core.getThread(GUEST, thread.id)).unwrap().posts.items.map((post) => post.author.id),
		).toEqual([ghost.id, ghost.id, ghost.id])
	})

	it('reads user profiles and lets members or admins update display names', async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin.nodeAddress())
		const { admin, alice, bob, category } = await seed(core)

		const thread = (
			await core.createThread(alice, {
				categoryId: category.id,
				title: 'Alice Thread',
				body: 'Opening body',
			})
		).unwrap()
		;(await core.createPost(alice, { threadId: thread.id, body: 'Second post' })).unwrap()

		const asGuest = (await core.getUserProfile(GUEST, alice.userId!)).unwrap()
		expect(asGuest).toMatchObject({
			user: { id: alice.userId, displayName: 'Alice' },
			roles: ['member'],
			threadCount: 1,
			postCount: 2,
			can: { edit: false },
		})
		expect(asGuest.threads.items).toHaveLength(1)

		const asAlice = (await core.getUserProfile(alice, alice.userId!)).unwrap()
		expect(asAlice.can.edit).toBe(true)

		expect(await codeOf(core.updateProfile(GUEST, alice.userId!, { displayName: 'Hack' }))).toBe(
			'unauthenticated',
		)
		expect(await codeOf(core.updateProfile(bob, alice.userId!, { displayName: 'Hack' }))).toBe(
			'forbidden',
		)
		expect(
			(await core.updateProfile(alice, 'alice', { displayName: '  Alice   W ' })).unwrap(),
		).toEqual({
			id: alice.userId,
			handle: 'alice',
			displayName: 'Alice W',
		})
		expect(
			(
				await core.updateProfile(admin, alice.userId!, {
					displayName: 'Alice Admin',
					handle: 'alice-admin',
				})
			).unwrap(),
		).toEqual({
			id: alice.userId,
			handle: 'alice-admin',
			displayName: 'Alice Admin',
		})
		expect(await codeOf(core.updateProfile(bob, 'bob', { handle: 'alice-admin' }))).toBe('conflict')
	})

	it('runs a thread from creation through replies with consistent counters', async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin.nodeAddress())
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
		expect(detail.can).toEqual({
			reply: true,
			edit: false,
			delete: false,
			moderate: false,
			move: false,
		})
	})

	it('orders threads by pin, then latest activity, and pages them', async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin.nodeAddress())
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

	it('lists recent active threads across visible categories with category summary and paging', async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin.nodeAddress())
		const { admin, alice, bob, category: general } = await seed(core)
		const secret = (
			await core.createCategory(admin, { name: 'Secret', description: 'Staff only' })
		).unwrap()
		const announcements = (
			await core.createCategory(admin, { name: 'Announcements', slug: 'news' })
		).unwrap()

		const t1 = (
			await core.createThread(alice, { categoryId: general.id, title: 'General 1', body: 'a' })
		).unwrap()
		const t2 = (
			await core.createThread(bob, { categoryId: announcements.id, title: 'News 1', body: 'b' })
		).unwrap()
		const tSecret = (
			await core.createThread(admin, { categoryId: secret.id, title: 'Secret 1', body: 'c' })
		).unwrap()
		const tDeleted = (
			await core.createThread(alice, { categoryId: general.id, title: 'Deleted 1', body: 'd' })
		).unwrap()

		// Pinning t2 does not force it ahead of newer activity; bumping t1 puts t1 first.
		;(await core.updateThread(admin, t2.id, { pinned: true })).unwrap()
		;(await core.createPost(bob, { threadId: t1.id, body: 'bump' })).unwrap()
		;(await core.deleteThread(alice, tDeleted.id)).unwrap()

		const allVisible = await core.listRecentThreads(GUEST)
		expect(allVisible.total).toBe(3)
		expect(allVisible.page).toBe(1)
		expect(allVisible.items.map((item) => item.id)).toEqual([t1.id, tSecret.id, t2.id])
		expect(allVisible.items[0]).toMatchObject({
			id: t1.id,
			title: 'General 1',
			replyCount: 1,
			category: { id: general.id, slug: 'general', name: 'General' },
			author: { id: alice.userId, displayName: 'Alice' },
			ext: {},
		})
		expect(allVisible.items[2]?.category).toEqual({
			id: announcements.id,
			slug: 'news',
			name: 'Announcements',
		})

		// Pagination across categories.
		const page1 = await core.listRecentThreads(GUEST, { page: 1, pageSize: 2 })
		expect(page1.total).toBe(3)
		expect(page1.page).toBe(1)
		expect(page1.pageSize).toBe(2)
		expect(page1.items.map((item) => item.title)).toEqual(['General 1', 'Secret 1'])

		const page2 = await core.listRecentThreads(GUEST, { page: 2, pageSize: 2 })
		expect(page2.total).toBe(3)
		expect(page2.page).toBe(2)
		expect(page2.pageSize).toBe(2)
		expect(page2.items.map((item) => item.title)).toEqual(['News 1'])

		// Sorting: `new` orders by start time; `hot` ranks by replies among recently active threads.
		const byNew = await core.listRecentThreads(GUEST, {}, { sort: 'new' })
		expect(byNew.items.map((item) => item.id)).toEqual([tSecret.id, t2.id, t1.id])
		const byHot = await core.listRecentThreads(GUEST, {}, { sort: 'hot' })
		expect(byHot.items[0]?.id).toBe(t1.id)

		// Custom permission policy hides restricted categories for non-admins.
		const disposeHideSecret = core.registerPermissionPolicy({
			id: 'test.hide-secret',
			evaluate: ({ principal, action, resource }) =>
				action === 'category.view' &&
				resource.categoryId === secret.id &&
				!principal.roles.includes('admin')
					? 'deny'
					: 'abstain',
		})

		const guestRestricted = await core.listRecentThreads(GUEST)
		expect(guestRestricted.total).toBe(2)
		expect(guestRestricted.items.map((item) => item.id)).toEqual([t1.id, t2.id])

		const adminView = await core.listRecentThreads(admin)
		expect(adminView.total).toBe(3)
		expect(adminView.items.map((item) => item.id)).toEqual([t1.id, tSecret.id, t2.id])

		disposeHideSecret()

		// When no categories are visible, returns an empty page immediately.
		const disposeHideAll = core.registerPermissionPolicy({
			id: 'test.hide-all',
			evaluate: ({ action }) => (action === 'category.view' ? 'deny' : 'abstain'),
		})
		expect(await core.listRecentThreads(GUEST, { page: 2, pageSize: 5 })).toEqual({
			items: [],
			page: 2,
			pageSize: 5,
			total: 0,
		})
		disposeHideAll()
	})

	it("counts what is new in a list since an instant, leaving out the viewer's own posts", async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin.nodeAddress())
		const { admin, alice, bob, category: general } = await seed(core)
		const staff = (
			await core.createCategory(admin, { name: 'Staff', access: { view: 'moderator' } })
		).unwrap()
		const old = (
			await core.createThread(alice, { categoryId: general.id, title: 'Old', body: 'a' })
		).unwrap()
		const since = old.lastPostAt
		await tick()
		const counted = async (principal: Principal, query: Omit<ActivityQuery, 'since'> = {}) =>
			(await core.activitySince(principal, { since, ...query })).unwrap().count

		expect(await counted(GUEST)).toBe(0)

		// Bob replies to the old thread and starts a new one; the hidden category gets one too.
		;(await core.createPost(bob, { threadId: old.id, body: 'reply' })).unwrap()
		;(await core.createThread(bob, { categoryId: general.id, title: 'New', body: 'b' })).unwrap()
		;(await core.createThread(admin, { categoryId: staff.id, title: 'Hush', body: 'c' })).unwrap()

		expect(await counted(GUEST)).toBe(2)
		expect(await counted(alice)).toBe(2)
		// Only what others wrote counts, and only where the viewer may look.
		expect(await counted(bob)).toBe(0)
		expect(await counted(admin)).toBe(2)
		expect(await counted(GUEST, { sort: 'new' })).toBe(1)
		expect(await counted(bob, { sort: 'new' })).toBe(0)
		expect(await counted(GUEST, { categorySlug: 'general' })).toBe(2)
		expect(await counted(admin, { categorySlug: staff.slug })).toBe(0)
		expect(await codeOf(core.activitySince(bob, { since, categorySlug: staff.slug }))).toBe(
			'not_found',
		)
		expect(await codeOf(core.activitySince(GUEST, { since, categorySlug: 'nowhere' }))).toBe(
			'not_found',
		)
		// Without a follow graph the 「关注」 feed is empty, so nothing is new in it either.
		expect(await counted(alice, { scope: 'following' })).toBe(0)

		// A post that was deleted again is not news.
		await tick()
		const oops = (await core.createPost(bob, { threadId: old.id, body: 'oops' })).unwrap()
		const justBefore = new Date(Date.parse(oops.createdAt) - 1).toISOString()
		expect((await core.activitySince(alice, { since: justBefore })).unwrap().count).toBe(1)
		;(await core.deletePost(bob, oops.id)).unwrap()
		expect((await core.activitySince(alice, { since: justBefore })).unwrap().count).toBe(0)

		const malformed = ['', 'yesterday', '2026-13-45T00:00:00Z', '2026-01-01']
		expect(
			await Promise.all(malformed.map((bad) => codeOf(core.activitySince(GUEST, { since: bad })))),
		).toEqual(malformed.map(() => 'invalid'))
	})

	it('counts new replies in a thread since an instant and names the first new floor', async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin.nodeAddress())
		const { admin, alice, bob, category } = await seed(core)
		const thread = (
			await core.createThread(alice, { categoryId: category.id, title: 'Talk', body: 'a' })
		).unwrap()
		const since = thread.lastPostAt
		await tick()
		const activity = async (principal: Principal) =>
			(await core.threadActivitySince(principal, thread.ref, since)).unwrap()

		expect(await activity(GUEST)).toEqual({ count: 0, floor: null })
		;(await core.createPost(alice, { threadId: thread.id, body: 'mine' })).unwrap()
		const floor = (await core.createPost(bob, { threadId: thread.id, body: 'two' })).unwrap()
		;(
			await core.createPost(bob, { threadId: thread.id, body: 'inside', parentId: floor.id })
		).unwrap()

		expect(await activity(GUEST)).toEqual({ count: 3, floor: 2 })
		expect(await activity(alice)).toEqual({ count: 2, floor: 3 })
		expect(await activity(bob)).toEqual({ count: 1, floor: 2 })

		expect(await codeOf(core.threadActivitySince(GUEST, thread.ref, 'soon'))).toBe('invalid')
		expect(await codeOf(core.threadActivitySince(GUEST, '999999', since))).toBe('not_found')
		;(await core.updateCategory(admin, category.id, { access: { view: 'moderator' } })).unwrap()
		expect(await codeOf(core.threadActivitySince(alice, thread.ref, since))).toBe('not_found')
		expect((await core.threadActivitySince(admin, thread.ref, since)).unwrap().count).toBe(3)
	})

	it('long-polls: answers when someone else writes, waits out own posts, and times out', async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin.nodeAddress())
		const { alice, bob, category } = await seed(core)
		const old = (
			await core.createThread(alice, { categoryId: category.id, title: 'Old', body: 'a' })
		).unwrap()
		const since = old.lastPostAt
		await tick()

		// Nothing new: the wait runs out and answers what it counted.
		const started = Date.now()
		expect(
			(await core.awaitActivity(alice, { since }, { known: 0, waitMs: 80 })).unwrap().count,
		).toBe(0)
		expect(Date.now() - started).toBeGreaterThanOrEqual(70)
		expect(core.activityWaiters()).toBe(0)

		// Someone else's reply wakes the list and the thread long before the wait would end.
		const list = core.awaitActivity(alice, { since }, { known: 0, waitMs: 5_000 })
		const inCategory = core.awaitActivity(
			alice,
			{ since, categorySlug: category.slug },
			{ known: 0, waitMs: 5_000 },
		)
		const inThread = core.awaitThreadActivity(alice, old.ref, since, { known: 0, waitMs: 5_000 })
		await tick()
		expect(core.activityWaiters()).toBe(3)
		const woke = Date.now()
		;(await core.createPost(bob, { threadId: old.id, body: 'news' })).unwrap()
		expect((await list).unwrap().count).toBe(1)
		expect((await inCategory).unwrap().count).toBe(1)
		expect((await inThread).unwrap()).toMatchObject({ count: 1, floor: 2 })
		expect(Date.now() - woke).toBeLessThan(2_000)

		// Already more than known: at once. Own posts wake the wait but do not end it.
		const done = Date.now()
		expect(
			(await core.awaitActivity(alice, { since }, { known: 0, waitMs: 5_000 })).unwrap().count,
		).toBe(1)
		expect(Date.now() - done).toBeLessThan(1_000)
		const own = core.awaitActivity(alice, { since }, { known: 1, waitMs: 600 })
		await tick()
		;(await core.createPost(alice, { threadId: old.id, body: 'mine' })).unwrap()
		expect((await own).unwrap().count).toBe(1)

		// A request that goes away stops waiting.
		const gone = new AbortController()
		const aborted = core.awaitActivity(
			alice,
			{ since },
			{
				known: 1,
				waitMs: 5_000,
				signal: gone.signal,
			},
		)
		await tick()
		gone.abort()
		expect((await aborted).unwrap().count).toBe(1)
		expect(core.activityWaiters()).toBe(0)
	})

	it('summarises members and recent posting for the community panel', async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin.nodeAddress())
		const { alice, bob, category } = await seed(core)
		const thread = (
			await core.createThread(alice, { categoryId: category.id, title: 'Hello', body: 'a' })
		).unwrap()
		;(await core.createPost(bob, { threadId: thread.id, body: 'one' })).unwrap()
		;(await core.createPost(bob, { threadId: thread.id, body: 'two' })).unwrap()

		const pulse = await core.communityPulse(GUEST)
		expect(pulse.days).toBe(7)
		expect(pulse.members).toBeGreaterThanOrEqual(3)
		expect(pulse.newMembers.map((user) => user.id)).toEqual(
			expect.arrayContaining([alice.userId, bob.userId]),
		)
		expect(pulse.activeMembers.map((member) => [member.user.id, member.posts])).toEqual([
			[bob.userId, 2],
			[alice.userId, 1],
		])

		// Posts in a category the viewer cannot see do not show up for them.
		const dispose = core.registerPermissionPolicy({
			id: 'test.hide-all',
			evaluate: ({ action }) => (action === 'category.view' ? 'deny' : 'abstain'),
		})
		expect((await core.communityPulse(GUEST)).activeMembers).toEqual([])
		dispose()
	})

	it('rejects writes from guests and from members without the right', async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin.nodeAddress())
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
		const core = await host.start(ForumCorePlugin.nodeAddress())
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
		const core = await host.start(ForumCorePlugin.nodeAddress())
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

		// The history lists the original, each edit and who made it; a moderator's edit counts too.
		const original = (await core.getPostHistory(GUEST, opening.id)).unwrap()
		expect(original.versions).toMatchObject([
			{ number: 1, body: 'v1', editor: { id: alice.userId } },
		])
		;(await core.updatePost(admin, reply.id, { body: 'fixed!' })).unwrap()
		const history = (await core.getPostHistory(GUEST, reply.id)).unwrap()
		expect(
			history.versions.map((version) => [version.number, version.body, version.editor.id]),
		).toEqual([
			[1, 'typo', bob.userId],
			[2, 'fixed', bob.userId],
			[3, 'fixed!', admin.userId],
		])
		expect(history.versions[0]?.createdAt).toBe(reply.createdAt)
		expect(await codeOf(core.getPostHistory(GUEST, MISSING_ID))).toBe('not_found')

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
		// The stream the migration seeds stays, and cannot be removed.
		const slugs = (await core.listCategories(GUEST)).map((item) => item.slug)
		expect(slugs.toSorted()).toEqual(['general', 'stream'])
		const stream = (await core.listCategories(GUEST)).find((item) => item.kind === 'stream')!
		expect(await codeOf(core.deleteCategory(admin, stream.id))).toBe('conflict')
	})

	it('keeps data across a restart of the plugin', async () => {
		await using host = await createHost()
		let core = await host.start(ForumCorePlugin.nodeAddress())
		const { alice, category } = await seed(core)
		const thread = (
			await core.createThread(alice, { categoryId: category.id, title: 'Durable', body: 'yes' })
		).unwrap()

		core = await host.restart(ForumCorePlugin.nodeAddress())
		const detail = (await core.getThread(GUEST, thread.id)).unwrap()
		expect(detail.thread.title).toBe('Durable')
		expect(detail.posts.items[0].author.displayName).toBe('Alice')
	})
})

async function streamOf(core: ForumCorePlugin) {
	const stream = await core.streamFor(GUEST)
	if (!stream) throw new Error('the migration seeds a stream')
	return stream.category
}

describe('notes, moves, replies inside floors and hot (M6.1)', () => {
	it('posts notes to the stream without a title and shows them as cards in listings', async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin.nodeAddress())
		const { alice, category } = await seed(core)
		const stream = await streamOf(core)
		expect(await core.streamFor(alice)).toMatchObject({ canPost: true })
		expect(await core.streamFor(GUEST)).toMatchObject({ canPost: false })

		expect(
			await codeOf(core.createThread(alice, { categoryId: stream.id, title: 'No', body: 'x' })),
		).toBe('invalid')
		expect(
			await codeOf(
				core.createThread(alice, { categoryId: stream.id, title: '', body: 'x'.repeat(501) }),
			),
		).toBe('invalid')
		expect(
			await codeOf(core.createThread(alice, { categoryId: category.id, title: '', body: 'x' })),
		).toBe('invalid')

		const note = (
			await core.createThread(alice, { categoryId: stream.id, title: '', body: 'just a note' })
		).unwrap()
		expect(note).toMatchObject({ kind: 'note', title: '', categoryId: stream.id })
		const topic = (
			await core.createThread(alice, { categoryId: category.id, title: 'Topic', body: 'long' })
		).unwrap()
		expect(topic.kind).toBe('topic')

		// The opening post of a note keeps the note limit when edited.
		const detail = (await core.getThread(alice, note.id)).unwrap()
		expect(detail.thread.kind).toBe('note')
		expect(detail.category.kind).toBe('stream')
		const opening = detail.posts.items[0]
		expect(await codeOf(core.updatePost(alice, opening.id, { body: 'y'.repeat(501) }))).toBe(
			'invalid',
		)

		const recent = await core.listRecentThreads(GUEST, {}, { sort: 'new' })
		expect(recent.items.map((item) => item.kind)).toEqual(['topic', 'note'])
		expect(recent.items[0].opening).toBeUndefined()
		expect(recent.items[1].opening).toMatchObject({
			id: opening.id,
			number: 1,
			body: 'just a note',
			bodyHtml: 'just a note',
			can: { edit: false, delete: false },
		})
		expect(recent.items[1].category).toMatchObject({ slug: 'stream' })

		const notes = (await core.getUserProfile(GUEST, alice.userId!, { kind: 'note' })).unwrap()
		expect(notes).toMatchObject({ threadCount: 1, noteCount: 1 })
		expect(notes.threads.items.map((item) => item.opening?.body)).toEqual(['just a note'])
		const topics = (await core.getUserProfile(GUEST, alice.userId!)).unwrap()
		expect(topics.threads.items.map((item) => item.title)).toEqual(['Topic'])
	})

	it("shows a note's newest visible reply in the overview feed", async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin.nodeAddress())
		const { alice, bob, category } = await seed(core)
		const stream = await streamOf(core)
		const quiet = (
			await core.createThread(alice, { categoryId: stream.id, title: '', body: 'quiet' })
		).unwrap()
		const note = (
			await core.createThread(alice, { categoryId: stream.id, title: '', body: 'talk' })
		).unwrap()
		const topic = (
			await core.createThread(alice, { categoryId: category.id, title: 'Topic', body: 'long' })
		).unwrap()
		;(await core.createPost(bob, { threadId: topic.id, body: 'topic reply' })).unwrap()
		const floor = (await core.createPost(bob, { threadId: note.id, body: 'first' })).unwrap()
		const inner = (
			await core.createPost(alice, { threadId: note.id, parentId: floor.id, body: 'inside' })
		).unwrap()

		const latestOf = async (id: string) =>
			(await core.listRecentThreads(GUEST)).items.find((item) => item.id === id)?.latestReply
		expect(await latestOf(note.id)).toMatchObject({
			id: inner.id,
			parentId: floor.id,
			body: 'inside',
			author: { displayName: 'Alice' },
		})
		expect(await latestOf(quiet.id)).toBeUndefined()
		expect(await latestOf(topic.id)).toBeUndefined()

		;(await core.deletePost(alice, inner.id)).unwrap()
		expect(await latestOf(note.id)).toMatchObject({ id: floor.id, body: 'first', parentId: null })
	})

	it('moves threads between boards and turns a note into a topic', async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin.nodeAddress())
		const { admin, alice, bob, category } = await seed(core)
		const stream = await streamOf(core)
		const other = (await core.createCategory(admin, { name: 'Other' })).unwrap()
		const events: PostAfterWriteEvent[] = []
		const note = (
			await core.createThread(alice, { categoryId: stream.id, title: '', body: 'grow me' })
		).unwrap()
		;(await core.createPost(bob, { threadId: note.id, body: 'reply' })).unwrap()
		const listen = core.registerPostHook({
			id: 'test.moves',
			afterWrite: (event) => {
				events.push(event)
			},
		})

		expect(await codeOf(core.updateThread(alice, note.id, { title: 'Titled note' }))).toBe(
			'invalid',
		)
		expect(await codeOf(core.updateThread(alice, note.id, { categoryId: other.id }))).toBe(
			'invalid',
		)
		expect(
			await codeOf(core.updateThread(bob, note.id, { categoryId: other.id, title: 'Mine' })),
		).toBe('forbidden')

		const moved = (
			await core.updateThread(alice, note.id, { categoryId: other.id, title: 'Grown up' })
		).unwrap()
		expect(moved).toMatchObject({ kind: 'topic', title: 'Grown up', categoryId: other.id })
		expect(events.at(-1)).toMatchObject({
			kind: 'thread.updated',
			categoryId: other.id,
			previousCategoryId: stream.id,
			threadKind: 'topic',
		})
		const categories = await core.listCategories(GUEST)
		expect(categories.find((item) => item.id === stream.id)).toMatchObject({
			threadCount: 0,
			postCount: 0,
		})
		expect(categories.find((item) => item.id === other.id)).toMatchObject({
			threadCount: 1,
			postCount: 2,
		})

		// Topics never go back into the stream; moderators move between boards.
		expect(await codeOf(core.updateThread(admin, note.id, { categoryId: stream.id }))).toBe(
			'invalid',
		)
		;(await core.updateThread(admin, note.id, { categoryId: category.id })).unwrap()
		expect((await core.getThread(GUEST, note.id)).unwrap().category.id).toBe(category.id)
		listen()
	})

	it('nests replies one level inside floors and locates any floor on its page', async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin.nodeAddress())
		const { admin, alice, bob, category } = await seed(core)
		const events: PostAfterWriteEvent[] = []
		const listen = core.registerPostHook({
			id: 'test.nesting',
			afterWrite: (event) => {
				events.push(event)
			},
		})
		const thread = (
			await core.createThread(alice, { categoryId: category.id, title: 'Nest', body: 'op' })
		).unwrap()
		const opening = (await core.getThread(GUEST, thread.id)).unwrap().posts.items[0]
		const floor2 = (await core.createPost(bob, { threadId: thread.id, body: 'two' })).unwrap()
		// Answering the opening post is an ordinary reply.
		const floor3 = (
			await core.createPost(admin, { threadId: thread.id, body: 'three', parentId: opening.id })
		).unwrap()
		expect(floor3.parentId).toBeNull()

		const inner = (
			await core.createPost(alice, { threadId: thread.id, body: 'in two', parentId: floor2.id })
		).unwrap()
		expect(inner).toMatchObject({ number: 4, parentId: floor2.id, replyTo: null })
		expect(events.at(-1)).toMatchObject({
			kind: 'post.created',
			parentId: floor2.id,
			parentAuthorId: bob.userId,
			replyToAuthorId: null,
			threadKind: 'topic',
		})
		// Answering a reply stays in the same floor and names who it answers.
		const answer = (
			await core.createPost(bob, { threadId: thread.id, body: 'back', parentId: inner.id })
		).unwrap()
		expect(answer).toMatchObject({
			parentId: floor2.id,
			replyTo: { id: alice.userId, displayName: 'Alice' },
		})
		expect(events.at(-1)).toMatchObject({ replyToAuthorId: alice.userId })
		for (const body of ['a', 'b']) {
			// oxlint-disable-next-line no-await-in-loop -- floors are numbered in order.
			;(await core.createPost(admin, { threadId: thread.id, body, parentId: floor2.id })).unwrap()
		}
		expect(
			await codeOf(core.createPost(bob, { threadId: thread.id, body: 'x', parentId: MISSING_ID })),
		).toBe('not_found')

		const detail = (await core.getThread(GUEST, thread.id)).unwrap()
		expect(detail.thread.replyCount).toBe(6)
		expect(detail.posts.total).toBe(3)
		expect(detail.posts.items.map((post) => post.number)).toEqual([1, 2, 3])
		const two = detail.posts.items[1]
		expect(two.replies?.total).toBe(4)
		expect(two.replies?.items.map((post) => post.body)).toEqual(['in two', 'back', 'a'])
		expect(two.replies?.items[1].replyTo).toMatchObject({ handle: expect.any(String) })
		expect(detail.posts.items[0].replies).toEqual({ items: [], total: 0 })

		const expanded = (await core.getThread(GUEST, thread.id, { expandFloor: 2 })).unwrap()
		expect(expanded.posts.items[1].replies?.items).toHaveLength(4)

		const rest = (await core.listReplies(GUEST, floor2.id, { page: 2, pageSize: 3 })).unwrap()
		expect(rest).toMatchObject({ total: 4, page: 2 })
		expect(rest.items.map((post) => post.body)).toEqual(['b'])

		// A deleted reply leaves the floor without a placeholder.
		;(await core.deletePost(alice, inner.id)).unwrap()
		const after = (await core.getThread(GUEST, thread.id)).unwrap()
		expect(after.posts.items[1].replies?.total).toBe(3)
		expect(after.thread.replyCount).toBe(5)

		expect((await core.locateFloor(GUEST, thread.ref, 5, { pageSize: 2 })).unwrap()).toEqual({
			threadRef: thread.ref,
			floor: 5,
			page: 1,
			parentFloor: 2,
		})
		expect((await core.locateFloor(GUEST, thread.ref, 3, { pageSize: 2 })).unwrap()).toMatchObject({
			page: 2,
			parentFloor: null,
		})
		expect(await codeOf(core.locateFloor(GUEST, thread.ref, 99))).toBe('not_found')
		listen()
	})

	it('ranks hot threads by replies and engagement decaying with age', async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin.nodeAddress())
		const { alice, bob, category } = await seed(core)
		const open = async (title: string) =>
			(await core.createThread(alice, { categoryId: category.id, title, body: 'x' })).unwrap()
		const quiet = await open('quiet')
		const liked = await open('liked')
		const busy = await open('busy')
		;(await core.createPost(bob, { threadId: busy.id, body: 'reply' })).unwrap()
		await core.adjustEngagement(liked.id, 3)
		// Engagement never goes below zero.
		await core.adjustEngagement(quiet.id, -5)

		const hot = await core.listRecentThreads(GUEST, {}, { sort: 'hot' })
		expect(hot.items.map((item) => item.title)).toEqual(['liked', 'busy', 'quiet'])
	})
})

describe('follow graph slot (M6.2)', () => {
	it('builds the following feed from the graph, within what the reader may see', async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin.nodeAddress())
		const { admin, alice, bob, category } = await seed(core)
		const hidden = (await core.createCategory(admin, { name: 'Staff' })).unwrap()
		const titles = async (principal: Principal) =>
			(await core.listRecentThreads(principal, {}, { scope: 'following' })).items
				.map((item) => item.title)
				.toSorted()
		await core.createThread(alice, { categoryId: category.id, title: 'Mine', body: 'x' })
		await core.createThread(bob, { categoryId: category.id, title: 'Bob', body: 'x' })
		await core.createThread(admin, { categoryId: hidden.id, title: 'Secret', body: 'x' })

		// No graph: no such feed.
		expect(core.followGraphId()).toBeNull()
		expect(await titles(alice)).toEqual([])
		expect(await core.followingOf(alice)).toEqual({ available: false, any: false })

		const dispose = core.registerFollowGraph({
			id: 'test.graph',
			following: () => Promise.resolve({ userIds: [bob.userId ?? ''], categoryIds: [hidden.id] }),
		})
		const hide = core.registerPermissionPolicy({
			id: 'test.hide-staff',
			evaluate: ({ action, resource }) =>
				action === 'category.view' && resource.categoryId === hidden.id ? 'deny' : 'abstain',
		})
		expect(await titles(alice)).toEqual(['Bob', 'Mine'])
		expect(await titles(GUEST)).toEqual([])
		expect(await core.followingOf(alice)).toEqual({ available: true, any: true })
		expect(await core.followingOf(GUEST)).toEqual({ available: false, any: false })
		hide()
		expect(await titles(alice)).toEqual(['Bob', 'Mine', 'Secret'])

		expect(() =>
			core.registerFollowGraph({
				id: 'test.other',
				following: () => Promise.resolve({ userIds: [], categoryIds: [] }),
			}),
		).toThrow(/already installed/)
		dispose()
		expect(core.followGraphId()).toBeNull()
	})

	it('serves an empty feed when the graph fails or answers nonsense', async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin.nodeAddress())
		const { alice, category } = await seed(core)
		await core.createThread(alice, { categoryId: category.id, title: 'Mine', body: 'x' })
		expect(() =>
			// @ts-expect-error -- deliberately missing the following function
			core.registerFollowGraph({ id: 'test.broken' }),
		).toThrow(TypeError)

		const failing = core.registerFollowGraph({
			id: 'test.failing',
			following: () => Promise.reject(new Error('graph bug')),
		})
		expect((await core.listRecentThreads(alice, {}, { scope: 'following' })).items).toEqual([])
		expect(await core.followingOf(alice)).toEqual({ available: true, any: false })
		failing()

		const nonsense = core.registerFollowGraph({
			id: 'test.nonsense',
			// @ts-expect-error -- deliberately not ID lists
			following: () => Promise.resolve({ userIds: 'everyone' }),
		})
		expect((await core.listRecentThreads(alice, {}, { scope: 'following' })).items).toEqual([])
		nonsense()
		// The ordinary feed never depended on it.
		expect((await core.listRecentThreads(alice)).items.map((item) => item.title)).toEqual(['Mine'])
	})
})

describe('permission policy registry', () => {
	it('applies a contributed policy only while its contributor runs', async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin.nodeAddress())
		const { alice, category } = await seed(core)
		const thread = (
			await core.createThread(alice, { categoryId: category.id, title: 'Open', body: 'x' })
		).unwrap()
		const reply = () => core.createPost(alice, { threadId: thread.id, body: 'reply' })

		expect((await reply()).isOk()).toBe(true)

		await host.start(FreezeRepliesPlugin.nodeAddress())
		expect(core.permissionPolicyIds()).toEqual(['forum-core.roles', 'test.freeze-replies'])
		expect(await codeOf(reply())).toBe('forbidden')
		expect((await core.getThread(alice, thread.id)).unwrap().can.reply).toBe(false)

		await host.stop(FreezeRepliesPlugin.nodeAddress())
		expect(core.permissionPolicyIds()).toEqual(['forum-core.roles'])
		expect((await reply()).isOk()).toBe(true)
	})

	it('re-registers contributions after the core restarts', async () => {
		await using host = await createHost()
		await host.start([ForumCorePlugin.nodeAddress(), FreezeRepliesPlugin.nodeAddress()])
		const before = host.require(ForumCorePlugin.nodeAddress())

		const core = await host.restart(ForumCorePlugin.nodeAddress())
		expect(core).not.toBe(before)
		expect(host.isRunning(FreezeRepliesPlugin.nodeAddress())).toBe(true)
		expect(core.permissionPolicyIds()).toEqual(['forum-core.roles', 'test.freeze-replies'])
	})

	it('fails a contributor that reuses a registered ID without disturbing the core', async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin.nodeAddress())

		const failure = await host.commitExpectFail((change) =>
			change.start(DuplicatePolicyPlugin.nodeAddress()),
		)
		expect(failure.lifecycleReport.issues).toContainEqual(
			expect.objectContaining({ kind: 'start-failed' }),
		)
		expect(host.isRunning(ForumCorePlugin.nodeAddress())).toBe(true)
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
		const core = await host.start(ForumCorePlugin.nodeAddress())
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
		const core = await host.start(ForumCorePlugin.nodeAddress())
		const read = await openingPost(core, 'hello')

		await host.start(ShoutPlugin.nodeAddress())
		expect(core.contentRendererId()).toBe('test.shout')
		expect(await read()).toMatchObject({
			body: 'hello',
			bodyFormat: 'markdown',
			bodyHtml: '<p>HELLO</p>',
		})

		await host.stop(ShoutPlugin.nodeAddress())
		expect(core.contentRendererId()).toBeNull()
		expect(await read()).toMatchObject({ bodyFormat: 'plain', bodyHtml: 'hello' })
	})

	it('re-installs the renderer after the core restarts', async () => {
		await using host = await createHost()
		const before = (await host.start([ForumCorePlugin.nodeAddress(), ShoutPlugin.nodeAddress()]))[0]
		const read = await openingPost(before, 'hello')

		const core = await host.restart(ForumCorePlugin.nodeAddress())
		expect(core).not.toBe(before)
		expect(host.isRunning(ShoutPlugin.nodeAddress())).toBe(true)
		expect((await read(core)).bodyHtml).toBe('<p>HELLO</p>')
	})

	it('refuses a second renderer and accepts it once the first has stopped', async () => {
		await using host = await createHost()
		const core = (await host.start([ForumCorePlugin.nodeAddress(), ShoutPlugin.nodeAddress()]))[0]

		const failure = await host.commitExpectFail((change) =>
			change.start(SecondRendererPlugin.nodeAddress()),
		)
		expect(failure.lifecycleReport.issues).toContainEqual(
			expect.objectContaining({ kind: 'start-failed' }),
		)
		expect(core.contentRendererId()).toBe('test.shout')

		await host.stop(ShoutPlugin.nodeAddress())
		await host.start(SecondRendererPlugin.nodeAddress())
		expect(core.contentRendererId()).toBe('test.second')
	})

	it('falls back to plain text when the renderer throws', async () => {
		await using host = await createHost()
		const core = (
			await host.start([ForumCorePlugin.nodeAddress(), BrokenRendererPlugin.nodeAddress()])
		)[0]
		const read = await openingPost(core, 'a < b')

		expect(await read()).toMatchObject({ bodyFormat: 'plain', bodyHtml: 'a &lt; b' })
	})

	it('filters renderer output down to the allowlist', async () => {
		await using host = await createHost()
		const core = (await host.start([ForumCorePlugin.nodeAddress(), RawHtmlPlugin.nodeAddress()]))[0]
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
			'<img src="/api/forum/ext/forum-attachments/files/0b9e8f1c-3a2d-4c5e-9f10-1234567890ab" alt="a" onerror="x()" width="9"><img src="https://example.com/api/forum/ext/forum-attachments/files/0b9e8f1c-3a2d-4c5e-9f10-1234567890ab">',
			'<table style="width:9px" border="1"><thead><tr><th align="center" onclick="x()">h</th></tr></thead><tbody><tr><td align="justify" colspan="2">c</td></tr></tbody><tfoot><tr><td>f</td></tr></tfoot></table>',
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
				'<img src="/api/forum/ext/forum-attachments/files/0b9e8f1c-3a2d-4c5e-9f10-1234567890ab" alt="a" loading="lazy" decoding="async" />',
				'<table><thead><tr><th align="center">h</th></tr></thead><tbody><tr><td>c</td></tr></tbody><tr><td>f</td></tr></table>',
			].join('\n'),
		)
	})

	it('renders nothing for a deleted post', async () => {
		await using host = await createHost()
		const core = (await host.start([ForumCorePlugin.nodeAddress(), ShoutPlugin.nodeAddress()]))[0]
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
		const core = await host.start(ForumCorePlugin.nodeAddress())
		const { alice, bob, category } = await seed(core)
		const thread = (
			await core.createThread(alice, { categoryId: category.id, title: 'Ext', body: 'one' })
		).unwrap()
		;(await core.createPost(bob, { threadId: thread.id, body: 'two' })).unwrap()
		const read = async () => (await core.getThread(bob, thread.id)).unwrap()

		expect((await read()).posts.items.map((post) => post.ext)).toEqual([{}, {}])
		expect(core.uiSlots()).toEqual([])

		badgeBatches.length = 0
		await host.start(BadgePlugin.nodeAddress())
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

		await host.stop(BadgePlugin.nodeAddress())
		expect(core.entityExtensionIds('post')).toEqual([])
		expect(core.uiSlots()).toEqual([])
		expect((await read()).posts.items.map((post) => post.ext)).toEqual([{}, {}, {}])
	})

	it('re-registers extensions and slots after the core restarts', async () => {
		await using host = await createHost()
		const before = (await host.start([ForumCorePlugin.nodeAddress(), BadgePlugin.nodeAddress()]))[0]

		const core = await host.restart(ForumCorePlugin.nodeAddress())
		expect(core).not.toBe(before)
		expect(host.isRunning(BadgePlugin.nodeAddress())).toBe(true)
		expect(core.entityExtensionIds('post')).toEqual(['test.badge'])
		expect(core.uiSlots()).toHaveLength(2)
	})

	it('fails a contributor with a taken ID or an unknown slot without disturbing the rest', async () => {
		await using host = await createHost()
		const core = (await host.start([ForumCorePlugin.nodeAddress(), BadgePlugin.nodeAddress()]))[0]

		const duplicate = await host.commitExpectFail((change) =>
			change.start(DuplicateBadgePlugin.nodeAddress()),
		)
		const unknownSlot = await host.commitExpectFail((change) =>
			change.start(UnknownSlotPlugin.nodeAddress()),
		)
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
		const core = (
			await host.start([
				ForumCorePlugin.nodeAddress(),
				BadgePlugin.nodeAddress(),
				FaultyExtensionsPlugin.nodeAddress(),
			])
		)[0]
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
		const core = await host.start(ForumCorePlugin.nodeAddress())
		const { alice, bob, category } = await seed(core)
		const thread = (
			await core.createThread(alice, { categoryId: category.id, title: 'Where', body: 'x' })
		).unwrap()
		const reply = (await core.createPost(bob, { threadId: thread.id, body: 'y' })).unwrap()

		expect((await core.locatePost(GUEST, reply.id)).unwrap()).toEqual({
			postId: reply.id,
			threadId: thread.id,
			threadRef: thread.ref,
			postNumber: 2,
			threadKind: 'topic',
			threadAuthorId: alice.userId,
			authorId: bob.userId,
			body: 'y',
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
		const core = await host.start(ForumCorePlugin.nodeAddress())

		expect(core.contentFormat()).toBe('plain')
		expect(core.previewBody('a < b').unwrap()).toEqual({
			bodyHtml: 'a &lt; b',
			bodyFormat: 'plain',
		})
		expect(core.previewBody('   ').isErr()).toBe(true)

		await host.start(ShoutPlugin.nodeAddress())
		expect(core.contentFormat()).toBe('markdown')
		expect(core.previewBody('hi').unwrap()).toEqual({
			bodyHtml: '<p>HI</p>',
			bodyFormat: 'markdown',
		})
	})
})

const afterWriteLog: PostAfterWriteEvent[] = []

/** Filters banned words before writes and records committed writes after they happen. */
@Plugin()
class WordFilterHookPlugin extends BasePlugin {
	constructor(private readonly core: ForumCorePlugin) {
		super()
	}

	protected override init(): void {
		this.ctx.effects.defer(
			this.core.registerPostHook({
				id: 'test.word-filter',
				beforeWrite: (event) => {
					const text =
						event.kind === 'thread.create'
							? `${event.title} ${event.body}`
							: event.kind === 'thread.update'
								? event.title
								: event.body
					if (text.includes('FORBIDDEN')) return { code: 'forbidden', message: '账号已被限制发言' }
					if (text.includes('SPAM')) return { message: '内容包含违禁词' }
					return undefined
				},
				afterWrite: (event) => {
					afterWriteLog.push(event)
				},
			}),
		)
	}
}

@Plugin()
class DuplicateHookPlugin extends BasePlugin {
	constructor(private readonly core: ForumCorePlugin) {
		super()
	}

	protected override init(): void {
		this.ctx.effects.defer(
			this.core.registerPostHook({
				id: 'test.word-filter',
				afterWrite: () => {},
			}),
		)
	}
}

@Plugin()
class EmptyHookPlugin extends BasePlugin {
	constructor(private readonly core: ForumCorePlugin) {
		super()
	}

	protected override init(): void {
		this.ctx.effects.defer(this.core.registerPostHook({ id: 'test.empty-hook' }))
	}
}

@Plugin()
class BrokenHookPlugin extends BasePlugin {
	constructor(private readonly core: ForumCorePlugin) {
		super()
	}

	protected override init(): void {
		this.ctx.effects.defer(
			this.core.registerPostHook({
				id: 'test.broken-hook',
				beforeWrite: () => {
					throw new Error('beforeWrite bug')
				},
				afterWrite: () => Promise.reject(new Error('afterWrite bug')),
			}),
		)
	}
}

describe('post hooks registry', () => {
	it('runs beforeWrite validation and emits afterWrite events while the contributor runs', async () => {
		await using host = await createHost()
		const core = await host.start(ForumCorePlugin.nodeAddress())
		const { alice, bob, category } = await seed(core)

		afterWriteLog.length = 0
		await host.start(WordFilterHookPlugin.nodeAddress())
		expect(core.postHookIds()).toEqual(['test.word-filter'])

		// Rejected writes abort the transaction and emit no afterWrite event.
		expect(
			await codeOf(
				core.createThread(alice, { categoryId: category.id, title: 'Buy SPAM', body: 'ok' }),
			),
		).toBe('invalid')
		expect(
			await codeOf(
				core.createThread(alice, { categoryId: category.id, title: 'ok', body: 'FORBIDDEN' }),
			),
		).toBe('forbidden')
		expect(afterWriteLog).toEqual([])
		const [unchangedCat] = await core.listCategories(GUEST)
		expect(unchangedCat).toMatchObject({ threadCount: 0, postCount: 0 })

		const thread = (
			await core.createThread(alice, {
				categoryId: category.id,
				title: 'Clean title',
				body: 'Opening body',
			})
		).unwrap()
		const opening = (await core.getThread(alice, thread.id)).unwrap().posts.items[0]
		expect(afterWriteLog).toHaveLength(1)
		expect(afterWriteLog[0]).toMatchObject({
			kind: 'thread.created',
			categoryId: category.id,
			threadId: thread.id,
			postId: opening.id,
			authorId: alice.userId,
			title: 'Clean title',
			body: 'Opening body',
		})

		expect(
			await codeOf(core.createPost(bob, { threadId: thread.id, body: 'more SPAM here' })),
		).toBe('invalid')
		const reply = (
			await core.createPost(bob, { threadId: thread.id, body: 'Nice thread' })
		).unwrap()
		expect(afterWriteLog[1]).toMatchObject({
			kind: 'post.created',
			categoryId: category.id,
			threadId: thread.id,
			threadAuthorId: alice.userId,
			threadTitle: 'Clean title',
			postId: reply.id,
			authorId: bob.userId,
			body: 'Nice thread',
		})

		expect(await codeOf(core.updatePost(bob, reply.id, { body: 'SPAM edit' }))).toBe('invalid')
		// Editing with the identical body writes nothing and emits no event.
		;(await core.updatePost(bob, reply.id, { body: 'Nice thread' })).unwrap()
		expect(afterWriteLog).toHaveLength(2)

		;(await core.updatePost(bob, reply.id, { body: 'Edited reply' })).unwrap()
		expect(afterWriteLog[2]).toMatchObject({
			kind: 'post.updated',
			categoryId: category.id,
			threadId: thread.id,
			threadTitle: 'Clean title',
			postId: reply.id,
			authorId: bob.userId,
			opening: false,
			body: 'Edited reply',
		})

		expect(await codeOf(core.updateThread(alice, thread.id, { title: 'SPAM title' }))).toBe(
			'invalid',
		)
		;(await core.updateThread(alice, thread.id, { title: 'Renamed title' })).unwrap()
		expect(afterWriteLog[3]).toMatchObject({
			kind: 'thread.updated',
			categoryId: category.id,
			threadId: thread.id,
			postId: opening.id,
			authorId: alice.userId,
			title: 'Renamed title',
			body: 'Opening body',
		})

		;(await core.deletePost(bob, reply.id)).unwrap()
		expect(afterWriteLog[4]).toMatchObject({
			kind: 'post.deleted',
			categoryId: category.id,
			threadId: thread.id,
			postId: reply.id,
			authorId: bob.userId,
		})

		;(await core.deleteThread(alice, thread.id)).unwrap()
		expect(afterWriteLog[5]).toMatchObject({
			kind: 'thread.deleted',
			categoryId: category.id,
			threadId: thread.id,
			authorId: alice.userId,
		})

		await host.stop(WordFilterHookPlugin.nodeAddress())
		expect(core.postHookIds()).toEqual([])
		expect(
			(
				await core.createThread(alice, {
					categoryId: category.id,
					title: 'SPAM is allowed after stop',
					body: 'ok',
				})
			).isOk(),
		).toBe(true)
		expect(afterWriteLog).toHaveLength(6)
	})

	it('isolates broken hooks, rejects bad registrations and survives core restarts', async () => {
		await using host = await createHost()
		const before = (
			await host.start([
				ForumCorePlugin.nodeAddress(),
				WordFilterHookPlugin.nodeAddress(),
				BrokenHookPlugin.nodeAddress(),
			])
		)[0]
		const { alice, category } = await seed(before)

		// BrokenHookPlugin throws in both beforeWrite and afterWrite, yet normal writes succeed.
		expect(
			(await before.createThread(alice, { categoryId: category.id, title: 'T', body: 'B' })).isOk(),
		).toBe(true)

		const core = await host.restart(ForumCorePlugin.nodeAddress())
		expect(core).not.toBe(before)
		expect(core.postHookIds().toSorted()).toEqual(['test.broken-hook', 'test.word-filter'])

		const duplicate = await host.commitExpectFail((change) =>
			change.start(DuplicateHookPlugin.nodeAddress()),
		)
		const empty = await host.commitExpectFail((change) =>
			change.start(EmptyHookPlugin.nodeAddress()),
		)
		for (const failure of [duplicate, empty]) {
			expect(failure.lifecycleReport.issues).toContainEqual(
				expect.objectContaining({ kind: 'start-failed' }),
			)
		}
		expect(core.postHookIds().toSorted()).toEqual(['test.broken-hook', 'test.word-filter'])
	})
})

const inboxDeliveries: ForumNotification[] = []
const mailDeliveries: ForumNotification[] = []

@Plugin()
class InboxChannelPlugin extends BasePlugin {
	constructor(private readonly core: ForumCorePlugin) {
		super()
	}

	protected override init(): void {
		this.ctx.effects.defer(
			this.core.registerNotificationChannel({
				id: 'test.inbox',
				deliver: (notification) => {
					inboxDeliveries.push(notification)
				},
			}),
		)
	}
}

@Plugin()
class MailAndBrokenChannelPlugin extends BasePlugin {
	constructor(private readonly core: ForumCorePlugin) {
		super()
	}

	protected override init(): void {
		this.ctx.effects.defer(
			this.core.registerNotificationChannel({
				id: 'test.broken-channel',
				deliver: () => Promise.reject(new Error('smtp down')),
			}),
		)
		this.ctx.effects.defer(
			this.core.registerNotificationChannel({
				id: 'test.mail',
				deliver: async (notification) => {
					await Promise.resolve()
					mailDeliveries.push(notification)
				},
			}),
		)
	}
}

@Plugin()
class DuplicateChannelPlugin extends BasePlugin {
	constructor(private readonly core: ForumCorePlugin) {
		super()
	}

	protected override init(): void {
		this.ctx.effects.defer(
			this.core.registerNotificationChannel({
				id: 'test.inbox',
				deliver: () => {},
			}),
		)
	}
}

describe('notification channels registry', () => {
	it('delivers notifications across running channels and isolates channel failures', async () => {
		await using host = await createHost()
		let core = await host.start(ForumCorePlugin.nodeAddress())
		const sample: ForumNotification = {
			id: '00000000-0000-4000-8000-000000000099',
			recipientId: '00000000-0000-4000-8000-000000000001',
			kind: 'thread.reply',
			title: 'Bob 回复了你的主题',
			path: '/t/1#post-2',
			createdAt: new Date().toISOString(),
		}

		inboxDeliveries.length = 0
		mailDeliveries.length = 0
		expect(await core.deliverNotification(sample)).toEqual([])

		await host.start([InboxChannelPlugin.nodeAddress(), MailAndBrokenChannelPlugin.nodeAddress()])
		expect(core.notificationChannelIds()).toEqual([
			'test.inbox',
			'test.broken-channel',
			'test.mail',
		])
		expect(await core.deliverNotification(sample)).toEqual(['test.inbox', 'test.mail'])
		expect(inboxDeliveries).toEqual([sample])
		expect(mailDeliveries).toEqual([sample])

		core = await host.restart(ForumCorePlugin.nodeAddress())
		expect(core.notificationChannelIds().toSorted()).toEqual([
			'test.broken-channel',
			'test.inbox',
			'test.mail',
		])

		await host.stop(MailAndBrokenChannelPlugin.nodeAddress())
		expect(core.notificationChannelIds()).toEqual(['test.inbox'])
		expect(await core.deliverNotification(sample)).toEqual(['test.inbox'])
		expect(inboxDeliveries).toHaveLength(2)
		expect(mailDeliveries).toHaveLength(1)

		const failure = await host.commitExpectFail((change) =>
			change.start(DuplicateChannelPlugin.nodeAddress()),
		)
		expect(failure.lifecycleReport.issues).toContainEqual(
			expect.objectContaining({ kind: 'start-failed' }),
		)
	})
})

const searchQueries: SearchProviderQuery[] = []

@Plugin()
class FakeSearchPlugin extends BasePlugin {
	constructor(private readonly core: ForumCorePlugin) {
		super()
	}

	protected override init(): void {
		this.ctx.effects.defer(
			this.core.registerSearchProvider({
				id: 'test.search',
				search: async (query) => {
					searchQueries.push(query)
					const posts = await this.core.listIndexablePosts()
					const matched = posts.filter(
						(post) =>
							query.categoryIds.includes(post.categoryId) &&
							(query.authorId === undefined || post.authorId === query.authorId) &&
							(!query.threadsOnly || post.opening) &&
							`${post.threadTitle} ${post.body}`.toLowerCase().includes(query.query.toLowerCase()),
					)
					return {
						items: matched.map((post) => ({
							postId: post.postId,
							threadId: post.threadId,
							categoryId: post.categoryId,
							authorId: post.authorId,
							opening: post.opening,
							title: post.threadTitle,
							snippetHtml: `<script>evil()</script><mark>${query.query}</mark> in <b>${post.body}</b>`,
							createdAt: post.createdAt,
						})),
						total: matched.length,
					}
				},
			}),
		)
	}
}

@Plugin()
class SecondSearchPlugin extends BasePlugin {
	constructor(private readonly core: ForumCorePlugin) {
		super()
	}

	protected override init(): void {
		this.ctx.effects.defer(
			this.core.registerSearchProvider({
				id: 'test.second-search',
				search: () => Promise.resolve({ items: [], total: 0 }),
			}),
		)
	}
}

@Plugin()
class BrokenSearchPlugin extends BasePlugin {
	constructor(private readonly core: ForumCorePlugin) {
		super()
	}

	protected override init(): void {
		this.ctx.effects.defer(
			this.core.registerSearchProvider({
				id: 'test.broken-search',
				search: () => Promise.reject(new Error('index corrupt')),
			}),
		)
	}
}

describe('search providers registry and indexable post scan', () => {
	it('scans visible posts in batches and serves search only while a provider runs', async () => {
		await using host = await createHost()
		let core = await host.start(ForumCorePlugin.nodeAddress())
		const { alice, bob, category } = await seed(core)

		const thread = (
			await core.createThread(alice, {
				categoryId: category.id,
				title: '乒乓球拍推荐',
				body: '求推荐底板',
			})
		).unwrap()
		const reply = (
			await core.createPost(bob, { threadId: thread.id, body: '乒乓球胶皮也很重要' })
		).unwrap()
		const doomed = (
			await core.createPost(bob, { threadId: thread.id, body: '将被删除的回复' })
		).unwrap()
		;(await core.deletePost(bob, doomed.id)).unwrap()

		// Backfill cursor scan skips deleted posts and respects afterPostId + limit.
		const firstBatch = await core.listIndexablePosts({ limit: 1 })
		expect(firstBatch).toHaveLength(1)
		const secondBatch = await core.listIndexablePosts({
			afterPostId: firstBatch[0].postId,
			limit: 10,
		})
		expect(secondBatch).toHaveLength(1)
		expect([...firstBatch, ...secondBatch].map((item) => item.body).toSorted()).toEqual([
			'乒乓球胶皮也很重要',
			'求推荐底板',
		])

		expect(core.searchAvailable()).toBe(false)
		expect(core.searchProviderId()).toBeNull()
		expect(await codeOf(core.search(GUEST, { query: '乒乓' }))).toBe('unavailable')

		searchQueries.length = 0
		await host.start(FakeSearchPlugin.nodeAddress())
		expect(core.searchAvailable()).toBe(true)
		expect(core.searchProviderId()).toBe('test.search')

		expect(await codeOf(core.search(GUEST, { query: '   ' }))).toBe('invalid')
		expect(await codeOf(core.search(GUEST, { query: '乒乓', categoryId: MISSING_ID }))).toBe(
			'not_found',
		)
		expect(await codeOf(core.search(GUEST, { query: '乒乓', authorId: 'bad-id' }))).toBe(
			'not_found',
		)

		const allHits = (await core.search(GUEST, { query: '乒乓' })).unwrap()
		expect(allHits.total).toBe(2)
		expect(allHits.items.find((hit) => hit.postId === reply.id)).toMatchObject({
			threadId: thread.id,
			categoryId: category.id,
			opening: false,
			title: '乒乓球拍推荐',
			snippetHtml: '<mark>乒乓</mark> in 乒乓球胶皮也很重要',
			author: { id: bob.userId, displayName: 'Bob' },
		})

		const topicOnly = (
			await core.search(GUEST, {
				query: '乒乓',
				categoryId: category.id,
				authorId: alice.userId!,
				threadsOnly: true,
			})
		).unwrap()
		expect(topicOnly.items).toHaveLength(1)
		expect(topicOnly.items[0]).toMatchObject({
			opening: true,
			author: { id: alice.userId, displayName: 'Alice' },
		})

		core = await host.restart(ForumCorePlugin.nodeAddress())
		expect(core.searchProviderId()).toBe('test.search')

		// Refuses a second search provider while the first is installed, then accepts it once free.
		const duplicate = await host.commitExpectFail((change) =>
			change.start(SecondSearchPlugin.nodeAddress()),
		)
		expect(duplicate.lifecycleReport.issues).toContainEqual(
			expect.objectContaining({ kind: 'start-failed' }),
		)
		expect(core.searchProviderId()).toBe('test.search')

		await host.stop(FakeSearchPlugin.nodeAddress())
		await host.start(SecondSearchPlugin.nodeAddress())
		expect(core.searchProviderId()).toBe('test.second-search')

		await host.stop(SecondSearchPlugin.nodeAddress())
		expect(core.searchAvailable()).toBe(false)
		await host.start(BrokenSearchPlugin.nodeAddress())
		expect(await codeOf(core.search(GUEST, { query: '乒乓' }))).toBe('unavailable')
	})
})

describe('category access', () => {
	it('lets a category say who sees it, starts threads and replies in it', async () => {
		await using host = await createHost()
		let core = await host.start(ForumCorePlugin.nodeAddress())
		await host.start(InboxChannelPlugin.nodeAddress())
		const { admin, alice, bob, category } = await seed(core)
		expect(category.access).toEqual({ view: 'guest', post: 'member', reply: 'member' })

		// Posting never asks for less than seeing.
		const staff = (
			await core.createCategory(admin, {
				name: 'Staff',
				access: { view: 'moderator', post: 'member' },
			})
		).unwrap()
		expect(staff.access).toEqual({ view: 'moderator', post: 'moderator', reply: 'moderator' })
		expect(
			// Browser input, untyped at runtime.
			await codeOf(core.createCategory(admin, { name: 'Bad', access: JSON.parse('{"view":"x"}') })),
		).toBe('invalid')

		// Announcements: only admins start threads, members still reply.
		const news = (
			await core.updateCategory(admin, category.id, { access: { post: 'admin' } })
		).unwrap()
		expect(news.access).toEqual({ view: 'guest', post: 'admin', reply: 'member' })
		expect(
			await codeOf(core.createThread(alice, { categoryId: news.id, title: 'Mine', body: 'x' })),
		).toBe('forbidden')
		const notice = (
			await core.createThread(admin, { categoryId: news.id, title: 'Notice', body: 'read me' })
		).unwrap()
		expect((await core.listThreads(alice, news.slug)).unwrap().can.createThread).toBe(false)
		expect((await core.listThreads(admin, news.slug)).unwrap().can.createThread).toBe(true)
		;(await core.createPost(alice, { threadId: notice.id, body: 'noted' })).unwrap()

		// Replies closed to members.
		;(await core.updateCategory(admin, news.id, { access: { reply: 'moderator' } })).unwrap()
		expect(await codeOf(core.createPost(bob, { threadId: notice.id, body: 'me too' }))).toBe(
			'forbidden',
		)
		expect((await core.getThread(bob, notice.id)).unwrap().can.reply).toBe(false)

		// Members only: guests lose the category, its threads and their place in every list.
		;(await core.updateCategory(admin, news.id, { access: { view: 'member' } })).unwrap()
		expect((await core.listCategories(GUEST)).map((item) => item.id)).not.toContain(news.id)
		expect((await core.listRecentThreads(GUEST)).items.map((item) => item.id)).not.toContain(
			notice.id,
		)
		expect(await codeOf(core.getThread(GUEST, notice.id))).toBe('not_found')
		expect((await core.getThread(alice, notice.id)).unwrap().thread.title).toBe('Notice')

		// Admins only: a member who wrote there no longer sees it, nor hears about it.
		;(await core.updateCategory(admin, news.id, { access: { view: 'admin' } })).unwrap()
		expect(await codeOf(core.getThread(alice, notice.id))).toBe('not_found')
		inboxDeliveries.length = 0
		const reply = {
			id: '00000000-0000-4000-8000-000000000123',
			recipientId: alice.userId!,
			kind: 'thread.reply',
			title: 'Admin 回复了你',
			threadId: notice.id,
			createdAt: new Date().toISOString(),
		}
		expect(await core.deliverNotification(reply)).toEqual([])
		expect(await core.deliverNotification({ ...reply, recipientId: admin.userId! })).toEqual([
			'test.inbox',
		])

		// The thresholds are read again on a cold start.
		core = await host.restart(ForumCorePlugin.nodeAddress())
		expect(await codeOf(core.getThread(alice, notice.id))).toBe('not_found')
		expect((await core.getThread(admin, notice.id)).unwrap().thread.title).toBe('Notice')
	})
})
