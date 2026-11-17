import type { MetaDto, SearchPageDto } from '@pluxum/domain'
import { ForumApiPlugin } from '@pluxum/api'
import { ForumAuth, type Authentication } from '@pluxum/auth'
import { ForumCorePlugin } from '@pluxum/core'
import {
	buildSnippetHtml,
	createSearchTokenizer,
	ForumSearchPlugin,
	SEARCH_POST_HOOK_ID,
	SEARCH_PROVIDER_ID,
	stripMarkup,
} from '@pluxum/search'
import { Plugin } from '@pluxel/core'
import { database } from '@pluxel/services/database'
import { pglite } from '@pluxel/services/database/pglite'
import { elysia } from '@pluxel/services/elysia'
import { createTestHost } from '@pluxel/test'
import { describe, expect, it } from 'vitest'

const createHost = () =>
	createTestHost({
		services: [elysia(), database({ backend: pglite({ dataDir: 'memory://' }) })],
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
	}
}

async function setUp(host: Host, customWords: string[] = []) {
	await host.commit((change) => {
		change.start(ForumCorePlugin)
		change.start(FakeAuth)
		change.start(ForumApiPlugin)
		change.start(
			ForumSearchPlugin,
			customWords.length > 0 ? { initialConfig: { customWords } } : undefined,
		)
	})
	const core = host.require(ForumCorePlugin)
	const adminUser = (
		await core.ensureUser({ subject: 'test:admin', displayName: 'Admin' })
	).unwrap()
	;(await core.grantRole(adminUser.id, 'admin')).unwrap()
	const admin = await core.principalOf(adminUser.id)
	const aliceUser = (
		await core.ensureUser({ subject: 'test:alice', displayName: 'Alice' })
	).unwrap()
	const bobUser = (await core.ensureUser({ subject: 'test:bob', displayName: 'Bob' })).unwrap()
	const alice = await core.principalOf(aliceUser.id)
	const bob = await core.principalOf(bobUser.id)
	const general = (await core.createCategory(admin, { name: '综合讨论', slug: 'general' })).unwrap()
	const dev = (await core.createCategory(admin, { name: '技术开发', slug: 'dev' })).unwrap()
	return { core, admin, aliceUser, bobUser, alice, bob, general, dev }
}

describe('tokenize & snippet helpers', () => {
	it('strips Markdown and HTML tags while preserving code identifiers', () => {
		const raw = [
			'## PostgreSQL 检索指南',
			'',
			'这里介绍 **中文分词**、*全文检索* 与 ~~旧方案~~，详见 [官方文档](https://example.com/docs)。',
			'![架构图](/api/forum/ext/forum-attachments/files/11111111-1111-4111-8111-111111111111)',
			'<div class="note">原生 <b>HTML</b> 标签<script>alert(1)</script></div>',
			'行内类型 `Result<SearchPageDto, ForumError>` 与字段 `ts_rank_cd`',
		].join('\n')

		const plain = stripMarkup(raw)
		expect(plain).toContain('PostgreSQL 检索指南')
		expect(plain).toContain('中文分词')
		expect(plain).toContain('官方文档')
		expect(plain).toContain('架构图')
		expect(plain).toContain('原生 HTML 标签')
		expect(plain).toContain('Result<SearchPageDto, ForumError>')
		expect(plain).toContain('ts_rank_cd')
		expect(plain).not.toContain('https://example.com/docs')
		expect(plain).not.toContain('11111111-1111-4111-8111-111111111111')
		expect(plain).not.toContain('alert(1)')
		expect(plain).not.toContain('<div')
	})

	it('keeps table cells and drops the table syntax', () => {
		const raw = [
			'对比如下：',
			'',
			'| 方案 | 成本 | 难度 |',
			'| --- | :-: | ---: |',
			'| 自建 | 高 | 高 |',
			'| 托管 | `a|b` | 低 \\| 中 |',
			'',
			'表格之后的一段。',
			'',
			'不是表格的 a | b 一行',
		].join('\n')

		const plain = stripMarkup(raw)
		expect(plain).toBe(
			'对比如下： 方案 成本 难度 自建 高 高 托管 a|b 低 | 中 表格之后的一段。 不是表格的 a | b 一行',
		)
		expect(plain).not.toContain('---')
	})

	it('uses search-mode segmentation for index recall and precise-mode for queries', () => {
		const tokenizer = createSearchTokenizer()
		const indexTokens = tokenizer.tokenizeForIndex('我买了一副乒乓球拍！PostgreSQL 17')
		expect(indexTokens.split(' ')).toEqual(
			expect.arrayContaining(['乒乓', '球拍', '乒乓球', '乒乓球拍', 'postgresql', '17']),
		)
		expect(tokenizer.tokenizeForQuery('乒乓球拍 PostgreSQL?!')).toEqual(['乒乓球拍', 'postgresql'])
		expect(tokenizer.tokenizeForQuery('   ？？？……   ')).toEqual([])

		tokenizer.insertWord('派鲁克塞尔')
		expect(tokenizer.tokenizeForQuery('欢迎来到派鲁克塞尔论坛')).toContain('派鲁克塞尔')

		const dictTokenizer = createSearchTokenizer()
		dictTokenizer.loadDict(new TextEncoder().encode('云原生架构 100000 nz\n'))
		expect(dictTokenizer.tokenizeForQuery('采用云原生架构部署')).toContain('云原生架构')
	})

	it('highlights matched terms with <mark> and escapes any raw HTML characters', () => {
		const snippet = buildSnippetHtml(
			'函数返回 Result<SearchPageDto, ForumError> 并支持 PostgreSQL 中文分词检索',
			['postgresql', '分词'],
		)
		expect(snippet).toContain('Result&lt;SearchPageDto, ForumError&gt;')
		expect(snippet).toContain('<mark>PostgreSQL</mark>')
		expect(snippet).toContain('<mark>分词</mark>')
	})
})

describe('ForumSearchPlugin', () => {
	it('indexes Chinese & English posts, ranks title weight A above body weight B, and filters queries', async () => {
		await using host = await createHost()
		const { core, alice, bob, aliceUser, bobUser, general, dev } = await setUp(host)

		// Thread 1: term in body only (weight B)
		const bodyHitThread = (
			await core.createThread(alice, {
				categoryId: general.id,
				title: '周末运动装备推荐',
				body: '昨天新买了一副专业**乒乓球拍**，手感非常扎实，适合进阶练习。',
			})
		).unwrap()

		// Thread 2: term in title (weight A)
		const titleHitThread = (
			await core.createThread(bob, {
				categoryId: dev.id,
				title: '乒乓球拍底板材质对比分析',
				body: '本文对比纯木底板与碳纤维底板的弹性差异。',
			})
		).unwrap()

		// Reply on Thread 2 by Alice containing Markdown + raw HTML lookalikes
		const reply = (
			await core.createPost(alice, {
				threadId: titleHitThread.id,
				body: '补充测试数据：`PostgreSQL` 全文索引延迟 < 5ms，避免 <img src=x onerror=alert(1)> 注入。',
			})
		).unwrap()

		// Sub-word recall from `cutForSearch`: "乒乓", "球拍", "乒乓球", "乒乓球拍" all find both threads
		await Promise.all(
			['乒乓', '球拍', '乒乓球', '乒乓球拍'].map(async (term) => {
				const res = await client(host).get(`/search?q=${encodeURIComponent(term)}`)
				expect(res.status).toBe(200)
				const page: SearchPageDto = res.body
				expect(page.total).toBe(2)
				// Title match (weight A) ranks ahead of body-only match (weight B)
				expect(page.items[0]?.threadId).toBe(titleHitThread.id)
				expect(page.items[1]?.threadId).toBe(bodyHitThread.id)
			}),
		)

		// Snippet highlights <mark> safely and strips raw HTML tags
		const pgRes = await client(host).get('/search?q=PostgreSQL')
		expect(pgRes.status).toBe(200)
		const pgPage: SearchPageDto = pgRes.body
		expect(pgPage.total).toBe(1)
		expect(pgPage.items[0]).toMatchObject({
			postId: reply.id,
			threadId: titleHitThread.id,
			categoryId: dev.id,
			opening: false,
			title: '乒乓球拍底板材质对比分析',
			author: { id: aliceUser.id, displayName: 'Alice' },
		})
		expect(pgPage.items[0]?.snippetHtml).toContain('<mark>PostgreSQL</mark>')
		expect(pgPage.items[0]?.snippetHtml).not.toContain('<img')
		expect(pgPage.items[0]?.snippetHtml).not.toContain('onerror')

		// Filter: threadsOnly excludes replies
		const threadsOnlyRes = await client(host).get('/search?q=PostgreSQL&threadsOnly=true')
		expect(threadsOnlyRes.body.total).toBe(0)

		// Filter: categoryId narrows to one category
		const catRes = await client(host).get(
			`/search?q=${encodeURIComponent('乒乓球拍')}&categoryId=${general.id}`,
		)
		expect(catRes.body.total).toBe(1)
		expect(catRes.body.items[0]?.threadId).toBe(bodyHitThread.id)

		// Filter: authorId narrows to Bob's posts
		const authorRes = await client(host).get(
			`/search?q=${encodeURIComponent('乒乓球拍')}&authorId=${bobUser.id}`,
		)
		expect(authorRes.body.total).toBe(1)
		expect(authorRes.body.items[0]?.threadId).toBe(titleHitThread.id)

		// Pagination
		const page1 = await client(host).get(
			`/search?q=${encodeURIComponent('乒乓球拍')}&page=1&pageSize=1`,
		)
		const page2 = await client(host).get(
			`/search?q=${encodeURIComponent('乒乓球拍')}&page=2&pageSize=1`,
		)
		expect(page1.body.total).toBe(2)
		expect(page1.body.items).toHaveLength(1)
		expect(page2.body.items).toHaveLength(1)
		expect(page1.body.items[0]?.postId).not.toBe(page2.body.items[0]?.postId)
	})

	it('applies customWords dictionary config for domain recall and precision', async () => {
		await using host = await createHost()
		const { core, alice, general } = await setUp(host, ['云计算', '云原生'])

		const cloudComputing = (
			await core.createThread(alice, {
				categoryId: general.id,
				title: '基础设施笔记',
				body: '这篇讲云计算平台的搭建与监控实践。',
			})
		).unwrap()

		const cloudNative = (
			await core.createThread(alice, {
				categoryId: general.id,
				title: '现代部署方案',
				body: '我们全面采用云原生容器服务。',
			})
		).unwrap()

		// Contains "云" and "原生" separately, NOT the compound word "云原生"
		await core.createThread(alice, {
			categoryId: general.id,
			title: '摄影与前端杂谈',
			body: '天上的云很好看，顺便聊聊原生JavaScript写法。',
		})

		const hit1 = (await core.search(alice, { query: '云计算' })).unwrap()
		expect(hit1.items.map((item) => item.threadId)).toEqual([cloudComputing.id])

		const hit2 = (await core.search(alice, { query: '云原生' })).unwrap()
		expect(hit2.items.map((item) => item.threadId)).toEqual([cloudNative.id])
	})

	it('keeps the index synchronized across create, edit, thread rename, and soft delete hooks', async () => {
		await using host = await createHost()
		const { core, alice, bob, general } = await setUp(host)

		const thread = (
			await core.createThread(alice, {
				categoryId: general.id,
				title: '初代标题量子芯片',
				body: '主楼初始内容讨论超导电路。',
			})
		).unwrap()

		const reply = (
			await core.createPost(bob, {
				threadId: thread.id,
				body: '一楼回复讨论低温制冷机。',
			})
		).unwrap()

		expect((await core.search(alice, { query: '量子芯片' })).unwrap().total).toBe(1)
		expect((await core.search(alice, { query: '低温制冷机' })).unwrap().total).toBe(1)

		// Rename thread -> old title disappears, new title matches, and reply hit gets the new title
		;(await core.updateThread(alice, thread.id, { title: '新版标题光子计算' })).unwrap()
		expect((await core.search(alice, { query: '量子芯片' })).unwrap().total).toBe(0)
		expect((await core.search(alice, { query: '光子计算' })).unwrap().total).toBe(1)
		const replyAfterRename = (await core.search(alice, { query: '低温制冷机' })).unwrap()
		expect(replyAfterRename.items[0]?.title).toBe('新版标题光子计算')

		// Edit reply -> old reply body disappears, new reply body matches
		;(await core.updatePost(bob, reply.id, { body: '一楼修改为讨论激光干涉仪。' })).unwrap()
		expect((await core.search(alice, { query: '低温制冷机' })).unwrap().total).toBe(0)
		expect((await core.search(alice, { query: '激光干涉仪' })).unwrap().total).toBe(1)

		// Soft-delete reply -> removed from index while opening post remains
		;(await core.deletePost(bob, reply.id)).unwrap()
		expect((await core.search(alice, { query: '激光干涉仪' })).unwrap().total).toBe(0)
		expect((await core.search(alice, { query: '超导电路' })).unwrap().total).toBe(1)

		// Soft-delete thread -> opening post (and any remaining replies) removed from index
		await core.createPost(bob, { threadId: thread.id, body: '二楼补充拓扑量子比特。' })
		expect((await core.search(alice, { query: '拓扑量子比特' })).unwrap().total).toBe(1)
		;(await core.deleteThread(alice, thread.id)).unwrap()
		expect((await core.search(alice, { query: '超导电路' })).unwrap().total).toBe(0)
		expect((await core.search(alice, { query: '光子计算' })).unwrap().total).toBe(0)
		expect((await core.search(alice, { query: '拓扑量子比特' })).unwrap().total).toBe(0)
	})

	it('enforces category view permissions on search results and explicit category filters', async () => {
		await using host = await createHost()
		const { core, admin, alice, bob, general } = await setUp(host)
		const staffOnly = (
			await core.createCategory(admin, { name: '内部版务', slug: 'staff-only' })
		).unwrap()

		const disposePolicy = core.registerPermissionPolicy({
			id: 'test.staff-category',
			evaluate: ({ principal, action, resource }) => {
				if (
					(action === 'category.view' || action === 'thread.view') &&
					resource.categoryId === staffOnly.id &&
					!principal.roles.includes('admin')
				) {
					return 'deny'
				}
				return 'abstain'
			},
		})

		await core.createThread(alice, {
			categoryId: general.id,
			title: '公开安全公告',
			body: '零信任网络升级通知。',
		})
		await core.createThread(admin, {
			categoryId: staffOnly.id,
			title: '内部安全审计',
			body: '零信任网关密钥轮换记录。',
		})

		// Bob (member) sees only the public hit; explicit staffOnly filter answers 404
		const bobSearch = await client(host, bob.userId ?? undefined).get(
			`/search?q=${encodeURIComponent('零信任')}`,
		)
		expect(bobSearch.status).toBe(200)
		expect(bobSearch.body.total).toBe(1)
		expect(bobSearch.body.items[0]?.categoryId).toBe(general.id)

		const bobForbiddenCat = await client(host, bob.userId ?? undefined).get(
			`/search?q=${encodeURIComponent('零信任')}&categoryId=${staffOnly.id}`,
		)
		expect(bobForbiddenCat.status).toBe(404)

		// Admin sees both hits
		const adminSearch = await client(host, admin.userId ?? undefined).get(
			`/search?q=${encodeURIComponent('零信任')}`,
		)
		expect(adminSearch.status).toBe(200)
		expect(adminSearch.body.total).toBe(2)

		disposePolicy()
	})

	it('backfills pre-existing posts on mid-flight startup and reconciles changes across stop/restart', async () => {
		await using host = await createHost()
		// Start the forum WITHOUT ForumSearchPlugin first
		await host.commit((change) => {
			change.start(ForumCorePlugin)
			change.start(FakeAuth)
			change.start(ForumApiPlugin)
		})
		const core = host.require(ForumCorePlugin)
		const adminUser = (
			await core.ensureUser({ subject: 'test:admin', displayName: 'Admin' })
		).unwrap()
		;(await core.grantRole(adminUser.id, 'admin')).unwrap()
		const admin = await core.principalOf(adminUser.id)
		const aliceUser = (
			await core.ensureUser({ subject: 'test:alice', displayName: 'Alice' })
		).unwrap()
		const alice = await core.principalOf(aliceUser.id)
		const general = (
			await core.createCategory(admin, { name: '历史存档', slug: 'archive' })
		).unwrap()

		// Before ForumSearchPlugin starts: meta reports search unavailable & /search answers 503
		const metaBefore: MetaDto = (await client(host).get('/meta')).body
		expect(metaBefore.search.available).toBe(false)
		expect((await client(host).get('/search?q=历史')).status).toBe(503)

		// Pre-existing visible thread + reply, plus a deleted reply that must NOT be indexed
		const existingThread = (
			await core.createThread(alice, {
				categoryId: general.id,
				title: '历史遗留分布式事务讨论',
				body: '两阶段提交与幂等补偿机制。',
			})
		).unwrap()
		const keptReply = (
			await core.createPost(alice, {
				threadId: existingThread.id,
				body: '回填保留回复：共识算法 Raft 日志复制。',
			})
		).unwrap()
		const deletedBeforeStart = (
			await core.createPost(alice, {
				threadId: existingThread.id,
				body: '已删回复：拜占庭容错旧草稿。',
			})
		).unwrap()
		;(await core.deletePost(alice, deletedBeforeStart.id)).unwrap()

		// Enable ForumSearchPlugin mid-flight -> backfills existing visible posts
		await host.start(ForumSearchPlugin)
		const metaRunning: MetaDto = (await client(host).get('/meta')).body
		expect(metaRunning.search.available).toBe(true)
		expect(core.searchProviderId()).toBe(SEARCH_PROVIDER_ID)
		expect(core.postHookIds()).toContain(SEARCH_POST_HOOK_ID)

		expect((await core.search(alice, { query: '分布式事务' })).unwrap().total).toBe(1)
		expect((await core.search(alice, { query: 'Raft' })).unwrap().total).toBe(1)
		expect((await core.search(alice, { query: '拜占庭容错' })).unwrap().total).toBe(0)

		// Stop ForumSearchPlugin -> withdraws provider and hooks cleanly
		await host.stop(ForumSearchPlugin)
		expect(core.searchAvailable()).toBe(false)
		expect(core.postHookIds()).not.toContain(SEARCH_POST_HOOK_ID)
		expect((await client(host).get('/meta')).body.search.available).toBe(false)
		expect((await client(host).get('/search?q=Raft')).status).toBe(503)

		// Mutate posts while ForumSearchPlugin is offline: delete keptReply, add offlineReply
		;(await core.deletePost(alice, keptReply.id)).unwrap()
		await core.createPost(alice, {
			threadId: existingThread.id,
			body: '停机期间新增：向量时钟冲突检测。',
		})

		// Restart ForumSearchPlugin -> reconciles both offline deletion and offline creation
		await host.start(ForumSearchPlugin)
		expect((await core.search(alice, { query: 'Raft' })).unwrap().total).toBe(0)
		expect((await core.search(alice, { query: '向量时钟' })).unwrap().total).toBe(1)

		// Restart ForumCorePlugin -> dependent ForumSearchPlugin re-registers automatically
		const restartedCore = await host.restart(ForumCorePlugin)
		expect(host.isRunning(ForumSearchPlugin)).toBe(true)
		expect(restartedCore.searchProviderId()).toBe(SEARCH_PROVIDER_ID)
		expect((await restartedCore.search(alice, { query: '向量时钟' })).unwrap().total).toBe(1)
	})
})
