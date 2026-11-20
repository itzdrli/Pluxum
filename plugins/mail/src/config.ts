import * as v from 'valibot'
import * as f from 'valibot-form'
import {
	DEFAULT_MAIL_LOCALE,
	DEFAULT_TEMPLATES,
	MAIL_LOCALES,
	validTemplate,
	type MailLocale,
} from './templates'

const SMTP = { id: 'smtp', title: 'SMTP', order: 0 }
const SENDER = { id: 'sender', title: '发件人', order: 1 }
const TEMPLATES = { id: 'templates', title: '邮件模板', order: 2 }
const SITE_TOKEN = ['siteName'] as const
const TITLE_TOKENS = ['siteName', 'title'] as const
const BODY_TOKENS = ['siteName', 'title', 'body'] as const

export const MAIL_LOCALE_LABELS = { 'zh-CN': '简体中文', en: 'English' }

function templateField(
	label: string,
	fallback: string,
	placeholders: readonly string[],
	rows?: number,
) {
	const tokens = placeholders.map((name) => `{${name}}`).join('、')
	return v.optional(
		v.pipe(
			v.string(),
			v.trim(),
			v.maxLength(rows === undefined ? 240 : 4000),
			v.check((value) => validTemplate(value, placeholders), `可用占位符：${tokens}`),
			f.formMeta({ title: label, description: `留空用内置文案。可用：${tokens}` }),
			f.stringMeta(
				rows === undefined
					? { placeholder: fallback }
					: { control: 'textarea', rows, placeholder: fallback },
			),
		),
		fallback,
	)
}

function templates(locale: MailLocale) {
	const defaults = DEFAULT_TEMPLATES[locale]
	return v.optional(
		v.pipe(
			v.object({
				notificationSubject: templateField('通知主题', defaults.notificationSubject, TITLE_TOKENS),
				notificationBody: templateField('通知正文', defaults.notificationBody, BODY_TOKENS, 4),
				viewLabel: templateField('查看按钮', defaults.viewLabel, SITE_TOKEN),
				footer: templateField('通知页脚', defaults.footer, SITE_TOKEN, 2),
				settingsLabel: templateField('邮件设置链接', defaults.settingsLabel, SITE_TOKEN),
				testSubject: templateField('测试邮件主题', defaults.testSubject, SITE_TOKEN),
				testBody: templateField('测试邮件正文', defaults.testBody, SITE_TOKEN, 3),
			}),
			f.formMeta({ title: MAIL_LOCALE_LABELS[locale], section: TEMPLATES }),
			f.objectMeta({ variant: 'stack' }),
		),
		{},
	)
}

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
	defaultLocale: v.optional(
		v.pipe(
			v.picklist(MAIL_LOCALES),
			f.formMeta({
				title: '默认邮件语言',
				description: '用户没选邮件语言时使用。',
				section: TEMPLATES,
			}),
			f.picklistMeta({ labels: MAIL_LOCALE_LABELS }),
		),
		DEFAULT_MAIL_LOCALE,
	),
	templatesZhCN: templates('zh-CN'),
	templatesEn: templates('en'),
})
export type ForumMailConfig = v.InferOutput<typeof ForumMailConfig>

/** Whether `config` names everything a send needs (the password is checked separately). */
export function isSendable(config: Readonly<ForumMailConfig>): boolean {
	return config.enabled && config.host !== '' && config.fromAddress !== ''
}
