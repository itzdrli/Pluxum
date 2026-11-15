import { VaultAdminPlugin } from '@pluxel/services/plugins'
import { pluginNodeAddressOf } from '@pluxel/core'
import * as v from 'valibot'
import { ForumApiPlugin } from '@forum/forum-api'
import {
	ForumAttachmentsPlugin,
	ForumStorageConfig,
	ForumStoragePlugin,
} from '@forum/forum-attachments'
import { ForumAuthConfig, ForumAuthPlugin } from '@forum/forum-auth'
import { ForumCorePlugin } from '@forum/forum-core'
import { ForumMarkdownPlugin } from '@forum/forum-markdown'
import { ForumModerationPlugin } from '@forum/forum-moderation'
import { ForumNotificationsPlugin } from '@forum/forum-notifications'
import { ForumReactionsPlugin } from '@forum/forum-reactions'
import { ForumRedisConfig, ForumRedisPlugin } from '@forum/forum-redis'
import { ForumSearchPlugin } from '@forum/forum-search'

export const appPlugins = [
	ForumRedisPlugin,
	ForumStoragePlugin,
	ForumCorePlugin,
	ForumAuthPlugin,
	ForumApiPlugin,
	ForumMarkdownPlugin,
	ForumReactionsPlugin,
	ForumAttachmentsPlugin,
	ForumNotificationsPlugin,
	ForumSearchPlugin,
	ForumModerationPlugin,
	VaultAdminPlugin,
] as const

export function appHostState() {
	return {
		initial: { autoStart: appPlugins.map(pluginNodeAddressOf) },
	}
}

export type AppConfigEnv = Readonly<{
	FORUM_WEB_PUBLIC_ORIGIN?: string
	FORUM_OIDC_ISSUER?: string
	FORUM_OIDC_CLIENT_ID?: string
	FORUM_OIDC_PROVIDER_LOGOUT?: string
	FORUM_ADMIN_SUBJECTS?: string
	REDIS_CONNECTIONS?: string
	S3_BUCKETS?: string
}>

export function appConfigRecords(env: AppConfigEnv) {
	return {
		initial: [
			...redisConfigRecord(env.REDIS_CONNECTIONS),
			...storageConfigRecord(env.S3_BUCKETS),
			...authConfigRecord(env),
		],
	}
}

function parseJsonEnv(name: string, raw: string): unknown {
	try {
		return JSON.parse(raw)
	} catch (cause) {
		throw new TypeError(`${name} must be valid JSON`, { cause })
	}
}

/**
 * REDIS_CONNECTIONS (JSON array) becomes the base config layer of ForumRedisPlugin.
 * Not an `envBinding`: the static `modules` deployment build cannot yet resolve package Plugin
 * catalogs for env bindings, so Workbench edits can still override this value (see FORUM_PLAN).
 */
function redisConfigRecord(raw: string | undefined) {
	if (raw === undefined) return []
	return [
		{
			owner: pluginNodeAddressOf(ForumRedisPlugin),
			config: v.parse(ForumRedisConfig, {
				connections: parseJsonEnv('REDIS_CONNECTIONS', raw),
			}),
		},
	]
}

function storageConfigRecord(raw: string | undefined) {
	if (raw === undefined) return []
	return [
		{
			owner: pluginNodeAddressOf(ForumStoragePlugin),
			config: v.parse(ForumStorageConfig, {
				buckets: parseJsonEnv('S3_BUCKETS', raw),
			}),
		},
	]
}

const set = (value: string | undefined): string | undefined => (value === '' ? undefined : value)

/**
 * Base config layer of ForumAuthPlugin (Workbench edits can override it, like Redis above):
 * - FORUM_WEB_PUBLIC_ORIGIN: the forum frontend's origin as browsers see it;
 * - FORUM_OIDC_ISSUER + FORUM_OIDC_CLIENT_ID: the Zitadel instance and the forum's OIDC application;
 * - FORUM_OIDC_PROVIDER_LOGOUT=true: logging out of the forum also ends the Zitadel session;
 * - FORUM_ADMIN_SUBJECTS: comma-separated Zitadel user IDs that become forum admins at login.
 * The client secret is never an environment value here; it lives in the plugin's Vault record.
 */
function authConfigRecord(env: AppConfigEnv) {
	const issuer = set(env.FORUM_OIDC_ISSUER)
	const clientId = set(env.FORUM_OIDC_CLIENT_ID)
	if ((issuer === undefined) !== (clientId === undefined)) {
		throw new TypeError('FORUM_OIDC_ISSUER and FORUM_OIDC_CLIENT_ID must be set together')
	}
	const publicOrigin = set(env.FORUM_WEB_PUBLIC_ORIGIN)
	const adminSubjects = (env.FORUM_ADMIN_SUBJECTS ?? '')
		.split(',')
		.map((subject) => subject.trim())
		.filter(Boolean)
	if (publicOrigin === undefined && issuer === undefined && adminSubjects.length === 0) return []
	return [
		{
			owner: pluginNodeAddressOf(ForumAuthPlugin),
			// Config records hold plain data: an unset option is left out, not stored as undefined.
			config: v.parse(ForumAuthConfig, {
				...(publicOrigin === undefined ? {} : { publicOrigin }),
				...(issuer === undefined
					? {}
					: {
							oidc: {
								issuer,
								clientId,
								providerLogout: env.FORUM_OIDC_PROVIDER_LOGOUT === 'true',
							},
						}),
				adminSubjects,
			}),
		},
	]
}
