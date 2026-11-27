import { workbench } from '@pluxel/workbench'
import * as v from 'valibot'
import * as f from 'valibot-form'

const AuthStatus = v.pipe(
	v.object({
		login: v.pipe(
			v.picklist(['available', 'unconfigured']),
			f.formMeta({ title: '登录' }),
			f.picklistMeta({ labels: { available: '可用', unconfigured: '未配置' } }),
		),
		publicOrigin: v.pipe(v.nullable(v.string()), f.formMeta({ title: '论坛公开地址' })),
		issuer: v.pipe(v.nullable(v.string()), f.formMeta({ title: 'Issuer' })),
		clientId: v.pipe(v.nullable(v.string()), f.formMeta({ title: 'Client ID' })),
		clientSecret: v.pipe(
			v.picklist(['vault', 'deployment', 'none']),
			f.formMeta({ title: '客户端密钥' }),
			f.picklistMeta({
				labels: {
					vault: '已存入 Vault',
					deployment: '由部署提供（只读）',
					none: '未设置（只用 PKCE）',
				},
			}),
		),
		admins: v.pipe(v.number(), v.integer(), f.formMeta({ title: '指定的管理员' })),
		testLogin: v.pipe(
			v.picklist(['on', 'off']),
			f.formMeta({ title: '测试登录' }),
			f.picklistMeta({ labels: { on: '开启', off: '关闭' } }),
		),
	}),
	f.formMeta({ title: '登录状态' }),
)
export type AuthStatus = v.InferOutput<typeof AuthStatus>

const SecretInput = v.object({
	secret: v.pipe(
		v.string(),
		v.trim(),
		v.minLength(1),
		v.maxLength(512),
		f.formMeta({
			title: '客户端密钥',
			description: 'Zitadel 应用的 Client Secret，只写入 Vault',
		}),
		f.stringMeta({ control: 'password' }),
	),
})

export const AuthWorkbench = workbench.define(import.meta.url, {
	login: workbench.content({
		document: './workbench.md',
		slots: {
			status: workbench.data(AuthStatus),
			probe: workbench.action({ label: '检查登录服务' }),
			setSecret: workbench.action({ label: '设置客户端密钥', input: SecretInput }),
			clearSecret: workbench.action({
				label: '删除客户端密钥',
				confirm: '删除后论坛只用 PKCE 向 Zitadel 认证；如果应用是机密客户端，登录会失败。继续吗？',
			}),
		},
		placement: { kind: 'tab', label: '登录', icon: 'shield-lock', order: 10 },
	}),
})
