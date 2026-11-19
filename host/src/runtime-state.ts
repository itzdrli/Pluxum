import type { HostConfigOptions, HostPolicyOptions } from '@pluxel/host'
import { Cache, CacheBackend, CachePlugin } from '@pluxel/plugin-cache'
import { Rates, RatesBackend, RatesPlugin } from '@pluxel/plugin-rates'
import {
	Redis,
	RedisCacheBackendConfig,
	RedisCacheBackendPlugin,
	RedisRatesBackendConfig,
	RedisRatesBackendPlugin,
} from '@pluxel/plugin-redis'
import { S3 } from '@pluxel/plugin-storage'
import * as v from 'valibot'
import { ForumApiPlugin } from '@pluxum/api'
import { ForumAttachmentsPlugin, ForumStorageConfig, ForumStoragePlugin } from '@pluxum/attachments'
import { ForumAuth, ForumAuthConfig, ForumAuthPlugin } from '@pluxum/auth'
import { ForumCachePlugin } from '@pluxum/cache'
import { ForumCorePlugin } from '@pluxum/core'
import { ForumFollowsPlugin } from '@pluxum/follows'
import { ForumFooterPlugin } from '@pluxum/footer'
import { ForumMailConfig, ForumMailPlugin } from '@pluxum/mail'
import { ForumMarkdownPlugin } from '@pluxum/markdown'
import { ForumMentionsPlugin } from '@pluxum/mentions'
import { ForumModerationPlugin } from '@pluxum/moderation'
import { ForumNotificationsPlugin } from '@pluxum/notifications'
import { ForumOutlinePlugin } from '@pluxum/outline'
import { ForumRatesPlugin } from '@pluxum/rates'
import { ForumReactionsPlugin } from '@pluxum/reactions'
import { ForumReadsPlugin } from '@pluxum/reads'
import { ForumRedisConfig, ForumRedisPlugin } from '@pluxum/redis'
import { ForumSearchPlugin } from '@pluxum/search'
import { ForumSolvedPlugin } from '@pluxum/solved'

export const appPlugins = [
	ForumRedisPlugin,
	// Official cache and rate capabilities, both backed by the forum's Redis connection.
	RedisCacheBackendPlugin,
	CachePlugin,
	RedisRatesBackendPlugin,
	RatesPlugin,
	ForumStoragePlugin,
	ForumCorePlugin,
	ForumAuthPlugin,
	ForumApiPlugin,
	ForumMarkdownPlugin,
	ForumReactionsPlugin,
	ForumReadsPlugin,
	ForumOutlinePlugin,
	ForumAttachmentsPlugin,
	ForumNotificationsPlugin,
	ForumSearchPlugin,
	ForumModerationPlugin,
	ForumFooterPlugin,
	ForumCachePlugin,
	ForumRatesPlugin,
	ForumMailPlugin,
	ForumMentionsPlugin,
	ForumFollowsPlugin,
	ForumSolvedPlugin,
	// No VaultAdminPlugin: in the standalone bundle it lowers @pluxel/services from source while
	// the host uses its dist, so its Vault token never matches. Each forum plugin manages its own
	// secrets on its Workbench page.
] as const

/**
 * Which plugins start and which forum plugin provides each shared capability. Saved policy
 * (Workbench edits) wins; these declarations apply until something is saved.
 */
export function appHostPolicy(): HostPolicyOptions {
	return {
		mode: { autoStart: 'saved-first', providerDefaults: 'saved-first' },
		// The default 1.5 s is too short on a cold boot, while the Workbench builds: Redis misses
		// it and every plugin that needs a session is blocked.
		startTimeoutMs: 30_000,
		autoStart: appPlugins,
		providerDefaults: [
			{ token: ForumAuth.definitionAddress(), provider: ForumAuthPlugin.nodeAddress() },
			{ token: Redis.definitionAddress(), provider: ForumRedisPlugin.nodeAddress() },
			{ token: S3.definitionAddress(), provider: ForumStoragePlugin.nodeAddress() },
			{ token: Cache.definitionAddress(), provider: CachePlugin.nodeAddress() },
			{ token: CacheBackend.definitionAddress(), provider: RedisCacheBackendPlugin.nodeAddress() },
			{ token: Rates.definitionAddress(), provider: RatesPlugin.nodeAddress() },
			{ token: RatesBackend.definitionAddress(), provider: RedisRatesBackendPlugin.nodeAddress() },
		],
	}
}

export type AppConfigEnv = Readonly<{
	FORUM_WEB_PUBLIC_ORIGIN?: string
	FORUM_OIDC_ISSUER?: string
	FORUM_OIDC_CLIENT_ID?: string
	FORUM_OIDC_PROVIDER_LOGOUT?: string
	FORUM_ADMIN_SUBJECTS?: string
	FORUM_TEST_LOGIN_TOKEN_SHA256?: string
	REDIS_CONNECTIONS?: string
	S3_BUCKETS?: string
}>

/** Declared config; a plugin's saved record (Workbench edits) replaces its declared one. */
export function appConfig(env: AppConfigEnv): HostConfigOptions {
	return {
		mode: 'saved-first',
		records: [
			...redisConfigRecord(env.REDIS_CONNECTIONS),
			...redisBackendConfigRecords(env.REDIS_CONNECTIONS),
			...storageConfigRecord(env.S3_BUCKETS),
			...authConfigRecord(env),
			...mailConfigRecord(env),
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
 * REDIS_CONNECTIONS (JSON array) becomes the declared config of ForumRedisPlugin.
 * Not an `envBinding`: the static `modules` deployment build cannot yet resolve package Plugin
 * catalogs for env bindings, so Workbench edits can still override this value (see FORUM_PLAN).
 */
function redisConfigRecord(raw: string | undefined) {
	if (raw === undefined) return []
	return [
		{
			owner: ForumRedisPlugin.nodeAddress(),
			config: v.parse(ForumRedisConfig, {
				connections: parseJsonEnv('REDIS_CONNECTIONS', raw),
			}),
		},
	]
}

/**
 * The official cache and rate backends use the Redis connections named `cache` and `rates` when
 * REDIS_CONNECTIONS has them (separate logical databases, so clearing the cache never scans
 * sessions), else the first connection there is. Keys get a `pluxum:` prefix either way.
 */
function redisBackendConfigRecords(raw: string | undefined) {
	const ids =
		raw === undefined
			? ['default']
			: v
					.parse(ForumRedisConfig, { connections: parseJsonEnv('REDIS_CONNECTIONS', raw) })
					.connections.map((connection) => connection.id)
	const pick = (preferred: string) => (ids.includes(preferred) ? preferred : (ids[0] ?? 'default'))
	return [
		{
			owner: RedisCacheBackendPlugin.nodeAddress(),
			config: v.parse(RedisCacheBackendConfig, {
				connectionId: pick('cache'),
				keyPrefix: 'pluxum:cache:',
			}),
		},
		{
			owner: RedisRatesBackendPlugin.nodeAddress(),
			config: v.parse(RedisRatesBackendConfig, {
				connectionId: pick('rates'),
				keyPrefix: 'pluxum:rates:',
			}),
		},
	]
}

function storageConfigRecord(raw: string | undefined) {
	if (raw === undefined) return []
	return [
		{
			owner: ForumStoragePlugin.nodeAddress(),
			config: v.parse(ForumStorageConfig, {
				buckets: parseJsonEnv('S3_BUCKETS', raw),
			}),
		},
	]
}

const set = (value: string | undefined): string | undefined => (value === '' ? undefined : value)

/**
 * Declared config of ForumAuthPlugin (a saved Workbench record replaces it, like Redis above):
 * - FORUM_WEB_PUBLIC_ORIGIN: the forum frontend's origin as browsers see it;
 * - FORUM_OIDC_ISSUER + FORUM_OIDC_CLIENT_ID: the Zitadel instance and the forum's OIDC application;
 * - FORUM_OIDC_PROVIDER_LOGOUT=true: logging out of the forum also ends the Zitadel session;
 * - FORUM_ADMIN_SUBJECTS: comma-separated Zitadel user IDs that become forum admins at login;
 * - FORUM_TEST_LOGIN_TOKEN_SHA256: hex SHA-256 of the test-login token; unset keeps test login off.
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
	const testLoginTokenSha256 = set(env.FORUM_TEST_LOGIN_TOKEN_SHA256)
	if (
		publicOrigin === undefined &&
		issuer === undefined &&
		adminSubjects.length === 0 &&
		testLoginTokenSha256 === undefined
	) {
		return []
	}
	return [
		{
			owner: ForumAuthPlugin.nodeAddress(),
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
				...(testLoginTokenSha256 === undefined ? {} : { testLoginTokenSha256 }),
			}),
		},
	]
}

/**
 * Declared config of ForumMailPlugin: links in mail start with FORUM_WEB_PUBLIC_ORIGIN. The SMTP
 * settings are entered in Workbench (mail stays off until then); the password lives in the
 * plugin's Vault record.
 */
function mailConfigRecord(env: AppConfigEnv) {
	const siteUrl = set(env.FORUM_WEB_PUBLIC_ORIGIN)
	if (siteUrl === undefined) return []
	return [
		{
			owner: ForumMailPlugin.nodeAddress(),
			config: v.parse(ForumMailConfig, { siteUrl: new URL(siteUrl).origin }),
		},
	]
}
