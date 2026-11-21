import { workbench } from '@pluxel/workbench'
import * as v from 'valibot'
import * as f from 'valibot-form'

const AccountsStatus = v.pipe(
	v.object({
		registration: v.pipe(
			v.picklist(['open', 'closed']),
			f.formMeta({ title: '注册' }),
			f.picklistMeta({ labels: { open: '开放', closed: '关闭' } }),
		),
		accounts: v.pipe(v.number(), v.integer(), f.formMeta({ title: '账号数' })),
		mail: v.pipe(
			v.picklist(['available', 'off']),
			f.formMeta({ title: '重设密码邮件' }),
			f.picklistMeta({ labels: { available: '可发送', off: '未配置邮件' } }),
		),
		publicOrigin: v.pipe(v.nullable(v.string()), f.formMeta({ title: '论坛公开地址' })),
	}),
	f.formMeta({ title: '账号状态' }),
)
export type AccountsStatus = v.InferOutput<typeof AccountsStatus>

const ResetLinkInput = v.object({
	email: v.pipe(
		v.string(),
		v.trim(),
		v.minLength(3),
		v.maxLength(254),
		f.formMeta({ title: '邮箱' }),
	),
})
export type ResetLinkInput = v.InferOutput<typeof ResetLinkInput>

export const AccountsWorkbench = workbench.define({
	accounts: workbench.content({
		document: workbench.markdown(import.meta.url, './workbench.md', {
			status: workbench.data(AccountsStatus),
			resetLink: workbench.action({ label: '生成重设链接', input: ResetLinkInput }),
		}),
		placement: workbench.tab({ label: '账号', icon: workbench.icons.Users, order: 10 }),
	}),
})
