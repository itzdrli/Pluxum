import type { Principal } from '@pluxum/domain'
import { ForumCorePlugin, type PostAdmitEvent, type PostAdmitRejection } from '@pluxum/core'
import { BasePlugin, Plugin } from '@pluxel/core'
import { Rates, type RateLimiter } from '@pluxel/plugin-rates'
import * as v from 'valibot'
import * as f from 'valibot-form'

export const RATES_POST_HOOK_ID = 'forum-rates.writes'

const MAX_LIMIT = 10_000
const MAX_WINDOW_MINUTES = 7 * 24 * 60

const Window = (title: string, description: string, limit: number, minutes: number) =>
	v.optional(
		v.pipe(
			v.object({
				limit: v.pipe(
					v.number(),
					v.integer(),
					v.minValue(0),
					v.maxValue(MAX_LIMIT),
					f.formMeta({ title: '次数', description: '0 表示不限制。' }),
				),
				minutes: v.pipe(
					v.number(),
					v.integer(),
					v.minValue(1),
					v.maxValue(MAX_WINDOW_MINUTES),
					f.formMeta({ title: '时间窗口（分钟）' }),
				),
			}),
			f.formMeta({ title, description }),
		),
		{ limit, minutes },
	)

/** How often one account may write. Every limit counts per account, in a sliding window. */
export const ForumRatesConfig = v.object({
	threads: Window('发主题', '每个账号在时间窗口内最多发几个主题。', 5, 10),
	replies: Window('回帖', '每个账号在时间窗口内最多回几次帖。', 20, 10),
	edits: Window('编辑', '每个账号在时间窗口内最多编辑几次帖子或标题。', 30, 10),
	exemptStaff: v.optional(
		v.pipe(
			v.boolean(),
			f.formMeta({ title: '版主和管理员不受限', description: '关闭后，所有账号使用同样的限制。' }),
		),
		true,
	),
})
export type ForumRatesConfig = v.InferOutput<typeof ForumRatesConfig>

type Bucket = 'threads' | 'replies' | 'edits'

const BUCKET_OF: Readonly<Record<PostAdmitEvent['kind'], Bucket>> = {
	'thread.create': 'threads',
	'post.create': 'replies',
	'thread.update': 'edits',
	'post.update': 'edits',
}

const WHAT: Readonly<Record<Bucket, string>> = {
	threads: '发主题',
	replies: '回帖',
	edits: '编辑',
}

/** "30 秒" / "5 分钟" / "2 小时", rounded up. */
export function waitText(ms: number): string {
	const seconds = Math.max(1, Math.ceil(ms / 1000))
	if (seconds < 60) return `${seconds} 秒`
	const minutes = Math.ceil(seconds / 60)
	if (minutes < 60) return `${minutes} 分钟`
	return `${Math.ceil(minutes / 60)} 小时`
}

function isStaff(principal: Principal): boolean {
	return principal.roles.includes('moderator') || principal.roles.includes('admin')
}

/**
 * Limits how often an account writes: threads, replies and edits each have their own sliding
 * window, set in Workbench. It plugs into Forum Core's `postHooks` admission stage, so a refused
 * write answers 429 with how long to wait. Counts live in the `Rates` capability's backend (Redis
 * in this host), so they hold across restarts of this plugin. Stopping it lifts every limit.
 */
@Plugin({ displayName: 'Forum Rates' })
export class ForumRatesPlugin extends BasePlugin {
	private readonly config = this.configs.use(ForumRatesConfig)
	private limiters = new Map<Bucket, RateLimiter>()

	constructor(
		private readonly core: ForumCorePlugin,
		private readonly rates: Rates,
	) {
		super()
	}

	protected override init(): void {
		this.limiters = this.open(this.config)
		this.configs.onUpdate(this.config, ({ desired }) => {
			this.limiters = this.open(v.parse(ForumRatesConfig, desired))
		})
		this.ctx.effects.defer(
			this.core.registerPostHook({
				id: RATES_POST_HOOK_ID,
				admit: (event) => this.admit(event),
			}),
		)
	}

	/**
	 * One limiter per bucket that has a limit. The policy is part of the name, so a changed limit
	 * starts a fresh count instead of conflicting with the one already open.
	 */
	private open(config: Readonly<ForumRatesConfig>): Map<Bucket, RateLimiter> {
		const limiters = new Map<Bucket, RateLimiter>()
		for (const bucket of ['threads', 'replies', 'edits'] as const) {
			const { limit, minutes } = config[bucket]
			if (limit === 0) continue
			limiters.set(
				bucket,
				this.rates.use(`${bucket}-${limit}-per-${minutes}m`, {
					algorithm: 'sliding-window-counter',
					limit,
					windowMs: minutes * 60_000,
				}),
			)
		}
		return limiters
	}

	private async admit(event: PostAdmitEvent): Promise<PostAdmitRejection | undefined> {
		const { principal } = event
		if (principal.userId === null) return undefined
		if (this.config.exemptStaff && isStaff(principal)) return undefined
		const bucket = BUCKET_OF[event.kind]
		const limiter = this.limiters.get(bucket)
		if (!limiter) return undefined
		const decision = await limiter.consume(principal.userId)
		if (!decision.denied) return undefined
		return {
			code: 'rate_limited',
			message: `${WHAT[bucket]}太频繁了，请 ${waitText(decision.retryAfterMs)}后再试`,
		}
	}
}
