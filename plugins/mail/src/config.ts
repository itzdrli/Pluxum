import * as v from 'valibot'
import * as f from 'valibot-form'

const SMTP = { id: 'smtp', title: 'SMTP', order: 0 }
const SENDER = { id: 'sender', title: '发件人', order: 1 }

/**
 * SMTP settings, edited in Workbench. The password is not configuration: it lives in this
 * plugin's Vault record `smtp-password`, set from the plugin's "邮件" tab.
 */
export const ForumMailConfig = v.object({
	enabled: v.optional(
		v.pipe(
			v.boolean(),
			f.formMeta({
				title: '发送邮件',
				description: '关闭时不发任何邮件。',
				section: SMTP,
			}),
		),
		false,
	),
	host: v.optional(
		v.pipe(
			v.string(),
			v.trim(),
			v.maxLength(253),
			f.formMeta({ title: 'SMTP 服务器', section: SMTP }),
			f.stringMeta({ placeholder: 'smtp.example.com' }),
		),
		'',
	),
	port: v.optional(
		v.pipe(
			v.number(),
			v.integer(),
			v.minValue(1),
			v.maxValue(65_535),
			f.formMeta({
				title: '端口',
				description: '常见：465（TLS）、587（STARTTLS）。',
				section: SMTP,
			}),
		),
		465,
	),
	security: v.optional(
		v.pipe(
			v.picklist(['tls', 'starttls', 'none']),
			f.formMeta({ title: '加密方式', section: SMTP }),
			f.picklistMeta({
				labels: {
					tls: 'TLS（连接即加密）',
					starttls: 'STARTTLS（连接后升级，必须成功）',
					none: '不加密（只用于本机中继）',
				},
			}),
		),
		'tls',
	),
	username: v.optional(
		v.pipe(
			v.string(),
			v.trim(),
			v.maxLength(254),
			f.formMeta({
				title: '用户名',
				description: '留空表示不登录。密码在插件的“邮件”页设置，存进 Vault。',
				section: SMTP,
			}),
		),
		'',
	),
	fromAddress: v.optional(
		v.pipe(
			v.string(),
			v.trim(),
			v.maxLength(254),
			f.formMeta({ title: '发件地址', section: SENDER }),
			f.stringMeta({ placeholder: 'noreply@example.com' }),
		),
		'',
	),
	fromName: v.optional(
		v.pipe(
			v.string(),
			v.trim(),
			v.maxLength(80),
			f.formMeta({ title: '发件人名称', description: '留空时用站点名称。', section: SENDER }),
		),
		'',
	),
	siteUrl: v.optional(
		v.pipe(
			v.string(),
			v.trim(),
			v.check(
				(value) => value === '' || /^https?:\/\/[^/]+\/?$/i.test(value),
				'论坛地址须是 http(s):// 开头的站点根地址',
			),
			f.formMeta({
				title: '论坛地址',
				description: '邮件里的链接以它开头。留空时邮件不带链接。',
				section: SENDER,
			}),
			f.stringMeta({ placeholder: 'https://forum.example.com' }),
		),
		'',
	),
})
export type ForumMailConfig = v.InferOutput<typeof ForumMailConfig>

/** Whether `config` names everything a send needs (the password is checked separately). */
export function isSendable(config: Readonly<ForumMailConfig>): boolean {
	return config.enabled && config.host !== '' && config.fromAddress !== ''
}
