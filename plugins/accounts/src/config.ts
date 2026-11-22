import * as v from 'valibot'
import * as f from 'valibot-form'

const ACCOUNTS = { id: 'accounts', title: '注册与登录', order: 0 }
const LIMITS = { id: 'limits', title: '登录与注册限频', order: 1 }

const count = (title: string, description: string, fallback: number) =>
	v.optional(
		v.pipe(
			v.number(),
			v.integer(),
			v.minValue(1),
			v.maxValue(1000),
			f.formMeta({ title, description }),
		),
		fallback,
	)

/** Pluxum Accounts' settings. A saved change applies to the next request. */
export const ForumAccountsConfig = v.object({
	registration: v.optional(
		v.pipe(
			v.picklist(['open', 'closed']),
			f.picklistMeta({ labels: { open: '开放', closed: '关闭' } }),
			f.formMeta({
				title: '注册',
				description: '关闭后只有已有账号能登录',
				section: ACCOUNTS,
			}),
		),
		'open',
	),
	passwordMin: v.optional(
		v.pipe(
			v.number(),
			v.integer(),
			v.minValue(8),
			v.maxValue(64),
			f.formMeta({ title: '密码最短长度', section: ACCOUNTS }),
		),
		8,
	),
	resetMinutes: v.optional(
		v.pipe(
			v.number(),
			v.integer(),
			v.minValue(10),
			v.maxValue(24 * 60),
			f.formMeta({
				title: '重设链接有效期（分钟）',
				section: ACCOUNTS,
			}),
		),
		60,
	),
	limits: v.optional(
		v.pipe(
			v.object({
				loginsPerEmail: count(
					'登录尝试 / 邮箱 / 15 分钟',
					'超过后这个邮箱要等一会儿才能再试。',
					10,
				),
				signupsPerAddress: count('注册 / IP / 小时', '按请求来源地址计。', 5),
				resetsPerEmail: count('重设邮件 / 邮箱 / 小时', '', 3),
			}),
			f.formMeta({ title: '登录与注册限频', section: LIMITS }),
			f.objectMeta({ variant: 'stack' }),
		),
		{},
	),
})
export type ForumAccountsConfig = v.InferOutput<typeof ForumAccountsConfig>
