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
import { FontsConfig } from '@pluxel/plugin-fonts'
import * as v from 'valibot'
import { ForumStorageConfig, ForumStoragePlugin } from '@pluxum/attachments'
import { ForumAuth, ForumAuthConfig, ForumAuthPlugin } from '@pluxum/auth'
import { ForumMailConfig } from '@pluxum/mail'
import { ForumRedisConfig, ForumRedisPlugin } from '@pluxum/redis'

/**
 * Which plugins start and which forum plugin provides each shared capability. Saved policy
 * (Workbench edits) wins; these declarations apply until something is saved.
 */
export function appHostPolicy(): HostPolicyOptions {
	return {
		modes: { autoStart: 'saved-first', providerDefaults: 'saved-first' },
		// The default 1.5 s is too short on a cold boot, while the Workbench builds: Redis misses
		// it and every plugin that needs a session is blocked.
		execution: { startTimeoutMs: 30_000 },
		providerDefaults: [
			{ token: ForumAuth.address(), provider: ForumAuthPlugin.nodeAddress() },
			{ token: Redis.address(), provider: ForumRedisPlugin.nodeAddress() },
			{ token: S3.address(), provider: ForumStoragePlugin.nodeAddress() },
			{ token: Cache.address(), provider: CachePlugin.nodeAddress() },
			{ token: CacheBackend.address(), provider: RedisCacheBackendPlugin.nodeAddress() },
			{ token: Rates.address(), provider: RatesPlugin.nodeAddress() },
			{ token: RatesBackend.address(), provider: RedisRatesBackendPlugin.nodeAddress() },
		],
	}
}

export type AppConfigEnv = Readonly<{
	FORUM_WEB_PUBLIC_ORIGIN?: string
	FORUM_OIDC_ISSUER?: string
	FORUM_OIDC_CLIENT_ID?: string
	FORUM_OIDC_PROVIDER_LOGOUT?: string
	FORUM_OIDC_BUTTON_LABEL?: string
	FORUM_ADMIN_SUBJECTS?: string
	FORUM_TEST_LOGIN_TOKEN_SHA256?: string
	REDIS_CONNECTIONS?: string
	S3_BUCKETS?: string
	FONT_FILES?: string
}>

/** Saved Workbench records replace each plugin's declared config until reset. */
export function appConfig(): HostConfigOptions {
	return { mode: 'saved-first' }
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
export function redisConfig(raw: string | undefined): Record<string, unknown> | undefined {
	if (raw === undefined) return undefined
	return v.parse(ForumRedisConfig, {
		connections: parseJsonEnv('REDIS_CONNECTIONS', raw),
	})
}

function redisConnectionIds(raw: string | undefined): string[] {
	return raw === undefined
		? ['default']
		: v
				.parse(ForumRedisConfig, { connections: parseJsonEnv('REDIS_CONNECTIONS', raw) })
				.connections.map((connection) => connection.id)
}

function pickRedisConnectionId(raw: string | undefined, preferred: string): string {
	const ids = redisConnectionIds(raw)
	return ids.includes(preferred) ? preferred : (ids[0] ?? 'default')
}

/**
 * The official cache and rate backends use the Redis connections named `cache` and `rates` when
 * REDIS_CONNECTIONS has them (separate logical databases, so clearing the cache never scans
 * sessions), else the first connection there is. Keys get a `pluxum:` prefix either way.
 */
export function redisCacheBackendConfig(raw: string | undefined): Record<string, unknown> {
	return v.parse(RedisCacheBackendConfig, {
		connectionId: pickRedisConnectionId(raw, 'cache'),
		keyPrefix: 'pluxum:cache:',
	})
}

export function redisRatesBackendConfig(raw: string | undefined): Record<string, unknown> {
	return v.parse(RedisRatesBackendConfig, {
		connectionId: pickRedisConnectionId(raw, 'rates'),
		keyPrefix: 'pluxum:rates:',
	})
}

export function storageConfig(raw: string | undefined): Record<string, unknown> | undefined {
	if (raw === undefined) return undefined
	return v.parse(ForumStorageConfig, {
		buckets: parseJsonEnv('S3_BUCKETS', raw),
	})
}

const set = (value: string | undefined): string | undefined => (value === '' ? undefined : value)

/**
 * Declared config of ForumAuthPlugin (a saved Workbench record replaces it, like Redis above):
 * - FORUM_WEB_PUBLIC_ORIGIN: the forum frontend's origin as browsers see it;
 * - FORUM_OIDC_ISSUER + FORUM_OIDC_CLIENT_ID: the Zitadel instance and the forum's OIDC application;
 * - FORUM_OIDC_PROVIDER_LOGOUT=true: logging out of the forum also ends the Zitadel session;
 * - FORUM_OIDC_BUTTON_LABEL: the sign-in page's provider button text (e.g. "Sign in with OIDC");
 * - FORUM_ADMIN_SUBJECTS: comma-separated Zitadel user IDs that become forum admins at login;
 * - FORUM_TEST_LOGIN_TOKEN_SHA256: hex SHA-256 of the test-login token; unset keeps test login off.
 * The client secret is never an environment value here; it lives in the plugin's Vault record.
 */
export function authConfig(env: AppConfigEnv): Record<string, unknown> | undefined {
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
		return undefined
	}
	// Config records hold plain data: an unset option is left out, not stored as undefined.
	return v.parse(ForumAuthConfig, {
		...(publicOrigin === undefined ? {} : { publicOrigin }),
		...(issuer === undefined
			? {}
			: {
					oidc: {
						issuer,
						clientId,
						providerLogout: env.FORUM_OIDC_PROVIDER_LOGOUT === 'true',
						...(set(env.FORUM_OIDC_BUTTON_LABEL) === undefined
							? {}
							: { buttonLabel: set(env.FORUM_OIDC_BUTTON_LABEL) }),
					},
				}),
		adminSubjects,
		...(testLoginTokenSha256 === undefined ? {} : { testLoginTokenSha256 }),
	})
}

/**
 * Declared config of ForumMailPlugin: links in mail start with FORUM_WEB_PUBLIC_ORIGIN. The SMTP
 * settings are entered in Workbench (mail stays off until then); the password lives in the
 * plugin's Vault record.
 */
export function mailConfig(env: AppConfigEnv): Record<string, unknown> | undefined {
	const siteUrl = set(env.FORUM_WEB_PUBLIC_ORIGIN)
	if (siteUrl === undefined) return undefined
	return v.parse(ForumMailConfig, { siteUrl: new URL(siteUrl).origin })
}

/**
 * Declared config of FontsPlugin: FONT_FILES (JSON array of absolute paths) are the fonts social
 * cards draw with; a CJK one is needed for Chinese. CJK fonts often pass the default 16 MiB file
 * limit (WenQuanYi Zen Hei is 16.8 MB), so the limit is raised for them and for uploads.
 */
export function fontsConfig(raw: string | undefined): Record<string, unknown> {
	const files = set(raw) === undefined ? [] : parseJsonEnv('FONT_FILES', raw ?? '')
	return v.parse(FontsConfig, { files, maxFontBytes: 64 * 1024 * 1024 })
}
