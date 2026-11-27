import { workbench } from '@pluxel/workbench'
import * as v from 'valibot'
import * as f from 'valibot-form'
import { MAIL_LOCALE_LABELS } from './config'
import { MAIL_LOCALES } from './templates'

const MailStatus = v.pipe(
	v.object({
		sending: v.pipe(
			v.picklist(['ready', 'disabled', 'incomplete']),
			f.formMeta({ title: '发信' }),
			f.picklistMeta({
				labels: { ready: '可以发信', disabled: '已关闭', incomplete: '设置不完整' },
			}),
		),
		server: v.pipe(v.nullable(v.string()), f.formMeta({ title: 'SMTP 服务器' })),
		password: v.pipe(
			v.picklist(['vault', 'deployment', 'none']),
			f.formMeta({ title: '密码' }),
			f.picklistMeta({
				labels: { vault: '已存入 Vault', deployment: '由部署提供（只读）', none: '未设置' },
			}),
		),
		optedOut: v.pipe(v.number(), v.integer(), f.formMeta({ title: '关闭了邮件通知的用户' })),
		queued: v.pipe(v.number(), v.integer(), f.formMeta({ title: '待发送' })),
	}),
	f.formMeta({ title: '邮件状态' }),
)
export type MailStatus = v.InferOutput<typeof MailStatus>

const PasswordInput = v.object({
	password: v.pipe(
		v.string(),
		v.minLength(1),
		v.maxLength(512),
		f.formMeta({ title: 'SMTP 密码', description: '只写入 Vault，不会显示出来' }),
		f.stringMeta({ control: 'password' }),
	),
})

const TestInput = v.object({
	to: v.pipe(
		v.string(),
		v.trim(),
		v.email('请输入有效的邮箱地址'),
		v.maxLength(254),
		f.formMeta({ title: '收件地址' }),
		f.stringMeta({ placeholder: 'you@example.com' }),
	),
	locale: v.optional(
		v.pipe(
			v.picklist(['default', ...MAIL_LOCALES]),
			f.formMeta({ title: '邮件语言' }),
			f.picklistMeta({ labels: { default: '站点默认', ...MAIL_LOCALE_LABELS } }),
		),
		'default',
	),
	template: v.optional(
		v.pipe(
			v.picklist(['test', 'notification']),
			f.formMeta({ title: '模板' }),
			f.picklistMeta({ labels: { test: '测试邮件', notification: '示例通知' } }),
		),
		'test',
	),
})
export type MailTestInput = v.InferOutput<typeof TestInput>

export const MailWorkbench = workbench.define(import.meta.url, {
	mail: workbench.content({
		document: './workbench.md',
		slots: {
			status: workbench.data(MailStatus),
			sendTest: workbench.action({ label: '发送测试邮件', input: TestInput }),
			setPassword: workbench.action({ label: '设置 SMTP 密码', input: PasswordInput }),
			clearPassword: workbench.action({
				label: '删除 SMTP 密码',
				confirm: '删除后需要登录的 SMTP 服务器将拒绝发信。继续吗？',
			}),
		},
		placement: { kind: 'tab', label: '邮件', icon: 'message-chatbot', order: 10 },
	}),
})
