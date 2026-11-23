import type { ForumCacheContribution } from '../cache'
import { ForumCorePlugin } from '../index'
import { BasePlugin, Plugin } from '@pluxel/core'
import { Cache, type CacheNamespace, type LocalCache } from '@pluxel/plugin-cache'
import * as v from 'valibot'
import * as f from 'valibot-form'

export const CACHE_CONTRIBUTION_ID = 'forum-cache.cache'

export const ForumCacheConfig = v.object({
	listingTtlSeconds: v.optional(
		v.pipe(
			v.number(),
			v.integer(),
			v.minValue(1),
			v.maxValue(3600),
			f.formMeta({
				title: '列表缓存时间（秒）',
				description: '首页、版块列表和社区面板的缓存时间。内容变动时会立即失效',
			}),
		),
		60,
	),
	renderedEntries: v.optional(
		v.pipe(
			v.number(),
			v.integer(),
			v.minValue(100),
			v.maxValue(100_000),
			f.formMeta({
				title: '渲染结果条数',
				description: '在本进程内存里保留多少条已渲染的帖子正文',
			}),
			f.numberMeta({ step: 100 }),
		),
		2000,
	),
})
export type ForumCacheConfig = v.InferOutput<typeof ForumCacheConfig>

/**
 * Lends Pluxum Core a cache: rendered post bodies in this process's memory, and the overview
 * feed, category pages and community panel in the `Cache` capability (Redis-backed in this host,
 * so they survive restarts and could be shared). Pluxum Core drops the listings after every write;
 * stopping this plugin makes the core read everything fresh again.
 */
@Plugin({ displayName: 'Pluxum Cache' })
export class ForumCachePlugin extends BasePlugin {
	private readonly config = this.configs.use(ForumCacheConfig)
	private rendered: LocalCache | undefined
	private listings: CacheNamespace | undefined

	constructor(
		private readonly core: ForumCorePlugin,
		private readonly cache: Cache,
	) {
		super()
	}

	protected override async init(): Promise<void> {
		const listings = this.open(this.config)
		this.configs.onUpdate(this.config, ({ desired }) => {
			this.open(v.parse(ForumCacheConfig, desired))
		})
		// Writes made while this plugin was stopped did not clear what the backend still holds.
		await listings.clear()
		const contribution: ForumCacheContribution = {
			id: CACHE_CONTRIBUTION_ID,
			rendered: {
				get: (key) => this.rendered?.get(key),
				set: (key, value) => this.rendered?.set(key, value),
				clear: () => this.rendered?.clear(),
			},
			listings: {
				get: async (key) => this.listings?.get(key),
				set: async (key, value) => this.listings?.set(key, value),
				clear: async () => {
					await this.listings?.clear()
				},
			},
		}
		this.ctx.effects.defer(this.core.registerCache(contribution))
	}

	/**
	 * Opens the scopes for `config`. A scope's policy is fixed once open, so the policy is part of
	 * its name: a changed setting starts an empty scope, and the old one is dropped.
	 */
	private open({ listingTtlSeconds, renderedEntries }: Readonly<ForumCacheConfig>): CacheNamespace {
		const previous = this.listings
		this.rendered?.clear()
		this.rendered = this.cache.scope(`rendered-${renderedEntries}`, {
			maxEntries: renderedEntries,
			ttlMs: 0,
		}).local
		this.listings = this.cache.scope(`listings-${listingTtlSeconds}s`, {
			ttlMs: listingTtlSeconds * 1000,
			backendFailure: 'bypass',
		})
		if (previous !== undefined && previous !== this.listings) {
			previous.clear().catch((error: unknown) => {
				this.ctx.logger.warn('could not drop the previous listing cache', { error })
			})
		}
		return this.listings
	}
}
