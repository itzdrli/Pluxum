import { VaultAdminPlugin } from '@pluxel/services/plugins'
import { pluginNodeAddressOf } from '@pluxel/core'
import * as v from 'valibot'
import { ForumApiConfig, ForumApiPlugin } from '@forum/forum-api'
import { ForumCorePlugin } from '@forum/forum-core'
import { ForumRedisConfig, ForumRedisPlugin } from '@forum/forum-redis'

export const appPlugins = [
	ForumRedisPlugin,
	ForumCorePlugin,
	ForumApiPlugin,
	VaultAdminPlugin,
] as const

export function appHostState() {
	return {
		initial: { autoStart: appPlugins.map(pluginNodeAddressOf) },
	}
}

export type AppConfigEnv = Readonly<{
	NODE_ENV?: string
	FORUM_DEV_IDENTITY?: string
	REDIS_CONNECTIONS?: string
}>

export function appConfigRecords(env: AppConfigEnv) {
	return {
		initial: [...redisConfigRecord(env.REDIS_CONNECTIONS), ...devIdentityConfigRecord(env)],
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

/**
 * FORUM_DEV_IDENTITY (JSON object: subject?, displayName?, roles?) makes every forum request act
 * as one account until real login lands (M2). Development only: a production host refuses it here,
 * and ForumApiPlugin refuses it again at start.
 */
function devIdentityConfigRecord(env: AppConfigEnv) {
	const raw = env.FORUM_DEV_IDENTITY
	if (raw === undefined || raw === '') return []
	if (env.NODE_ENV === 'production') {
		throw new Error('FORUM_DEV_IDENTITY must not be set when NODE_ENV is "production"')
	}
	const identity = parseJsonEnv('FORUM_DEV_IDENTITY', raw)
	if (typeof identity !== 'object' || identity === null || Array.isArray(identity)) {
		throw new TypeError('FORUM_DEV_IDENTITY must be a JSON object')
	}
	return [
		{
			owner: pluginNodeAddressOf(ForumApiPlugin),
			config: v.parse(ForumApiConfig, { devIdentity: { ...identity, enabled: true } }),
		},
	]
}
