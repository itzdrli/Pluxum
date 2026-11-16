import * as v from 'valibot'
import * as f from 'valibot-form'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** A bare origin (`scheme://host[:port]`), HTTPS unless it is plain HTTP for development. */
function isOrigin(value: string): boolean {
	try {
		const url = new URL(value)
		return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value
	} catch {
		return false
	}
}

/** HTTPS issuer without credentials, query or fragment; plain HTTP only on loopback (tests, mocks). */
function isIssuer(value: string): boolean {
	try {
		const url = new URL(value)
		if (url.username || url.password || url.search || url.hash) return false
		return (
			url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))
		)
	} catch {
		return false
	}
}

const seconds = (fallback: number, meta: Parameters<typeof f.formMeta>[0]) =>
	v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(60), f.formMeta(meta), f.numberMeta({ step: 3600 })),
		fallback,
	)

const LOGIN = { id: 'login', title: '登录', order: 0 }
const SESSION = { id: 'session', title: '会话', order: 1 }
const ACCESS = { id: 'access', title: '管理员与测试', order: 2 }

export const ForumAuthConfig = v.object({
	/**
	 * Origin of the forum frontend as browsers see it. The OIDC callback, the session cookie and the
	 * cross-site request check are all bound to it; it is never derived from request headers.
	 * Login stays unavailable until this and `oidc` are set.
	 */
	publicOrigin: v.optional(
		v.pipe(
			v.string(),
			v.check(isOrigin, 'publicOrigin must be an origin like https://forum.test'),
			f.formMeta({
				title: '论坛公开地址',
				description:
					'浏览器访问论坛前台的 origin，例如 https://forum.example.com。登录回调、会话 Cookie 和跨站检查都绑定它。',
				section: LOGIN,
			}),
			f.stringMeta({ placeholder: 'https://forum.example.com' }),
		),
	),
	/**
	 * OpenID Connect provider (Zitadel). The client secret is not configuration: a confidential
	 * client stores it in this plugin's Vault record `oidc-client-secret`; without that record the
	 * client authenticates with PKCE alone.
	 */
	oidc: v.optional(
		v.pipe(
			v.object({
				issuer: v.pipe(
					v.string(),
					v.check(isIssuer, 'issuer must be an https:// URL (http:// only on loopback)'),
					f.formMeta({ title: 'Issuer', description: 'Zitadel 实例地址。' }),
					f.stringMeta({ placeholder: 'https://auth.example.com' }),
				),
				clientId: v.pipe(
					v.string(),
					v.minLength(1),
					v.maxLength(255),
					f.formMeta({ title: 'Client ID', description: '论坛在 Zitadel 中的 OIDC 应用 ID。' }),
				),
				scopes: v.optional(
					v.pipe(
						v.array(v.pipe(v.string(), v.regex(/^[\x21\x23-\x5B\x5D-\x7E]+$/))),
						v.check((scopes) => scopes.includes('openid'), 'scopes must include "openid"'),
						f.formMeta({ title: 'Scopes', description: '必须包含 openid。' }),
						f.arrayMeta({ itemLabel: 'Scope', addLabel: '添加 scope' }),
					),
					['openid', 'profile', 'email'],
				),
				/** After a local logout, also end the provider's own session (RP-initiated logout). */
				providerLogout: v.optional(
					v.pipe(
						v.boolean(),
						f.formMeta({
							title: '同时退出 Zitadel',
							description: '用户退出论坛时，也结束其在 Zitadel 的登录状态。',
						}),
					),
					false,
				),
			}),
			f.formMeta({
				title: 'OpenID Connect',
				description:
					'登录服务（Zitadel）。客户端密钥不在这里填写：机密客户端把它存进本插件的 Vault 记录 oidc-client-secret，没有该记录时只用 PKCE。',
				section: LOGIN,
			}),
			f.objectMeta({ variant: 'card' }),
		),
	),
	session: v.optional(
		v.pipe(
			v.object({
				/** Named connection of the `Redis` capability that holds sessions. */
				connectionId: v.optional(
					v.pipe(
						v.string(),
						v.minLength(1),
						f.formMeta({
							title: 'Redis 连接',
							description: '保存会话的 Redis 连接 ID，须在 Forum Redis 插件中已声明。',
						}),
					),
					'session',
				),
				/** A session ends after this long without a request. */
				idleTtlSeconds: seconds(7 * 24 * 3600, {
					title: '空闲过期（秒）',
					description: '这么久没有任何请求，会话即失效。默认 7 天。',
				}),
				/** A session ends this long after login no matter how active it is. */
				absoluteTtlSeconds: seconds(30 * 24 * 3600, {
					title: '最长有效期（秒）',
					description: '从登录起算，无论是否活跃，到期都要重新登录。默认 30 天，不能短于空闲过期。',
				}),
			}),
			v.check(
				(session) => session.idleTtlSeconds <= session.absoluteTtlSeconds,
				'idleTtlSeconds must not exceed absoluteTtlSeconds',
			),
			f.formMeta({ title: '会话', section: SESSION }),
			f.objectMeta({ variant: 'stack' }),
		),
		{},
	),
	/**
	 * Hex SHA-256 of the token that unlocks test logins (`testLogin`), which open a session for a
	 * throwaway `pluxum-test:` account without the provider. Unset, test login is off. Only the hash
	 * is configuration, so reading the config never hands out the token.
	 */
	testLoginTokenSha256: v.optional(
		v.pipe(
			v.string(),
			v.regex(/^[0-9a-f]{64}$/, 'testLoginTokenSha256 must be hex SHA-256'),
			f.formMeta({
				title: '测试登录令牌（SHA-256）',
				description:
					'测试登录令牌的十六进制 SHA-256，只存哈希。留空则关闭测试登录（/auth/test-login）。',
				section: ACCESS,
			}),
		),
	),
	/** Provider subjects (`sub`) that receive the admin role when they log in. */
	adminSubjects: v.optional(
		v.pipe(
			v.array(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(255))),
			f.formMeta({
				title: '管理员',
				description: '这些 Zitadel 用户 ID（sub）登录时会被授予管理员角色。',
				section: ACCESS,
			}),
			f.arrayMeta({ itemLabel: '用户 ID', addLabel: '添加管理员', emptyHint: '没有指定管理员' }),
		),
		[],
	),
})

export type ForumAuthConfig = v.InferOutput<typeof ForumAuthConfig>
