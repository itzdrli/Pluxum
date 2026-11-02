import { VaultAdminPlugin } from '@pluxel/services/plugins'
import { pluginNodeAddressOf } from '@pluxel/core'
import * as v from 'valibot'
import { ForumApiPlugin } from '@forum/forum-api'
import { ForumRedisConfig, ForumRedisPlugin } from '@forum/forum-redis'
import { AuditPlugin } from '@forum/audit-plugin'
import { HttpPlugin } from '@forum/http-plugin'
import { TodoPlugin } from '@forum/todo-plugin'

// Template example plugins (Audit/Todo/Http) stay as a reference until the forum core runs (M1).
export const appPlugins = [
	ForumRedisPlugin,
	ForumApiPlugin,
	AuditPlugin,
	TodoPlugin,
	HttpPlugin,
	VaultAdminPlugin,
] as const
const autoStartPlugins = [ForumRedisPlugin, ForumApiPlugin, VaultAdminPlugin] as const

export function appHostState() {
	return {
		initial: { autoStart: autoStartPlugins.map(pluginNodeAddressOf) },
	}
}

export type AppConfigEnv = Readonly<{
	EXAMPLE_TODO_MAX_ITEMS?: string
	REDIS_CONNECTIONS?: string
}>

export function appConfigRecords(env: AppConfigEnv) {
	return {
		initial: [
			{
				owner: pluginNodeAddressOf(TodoPlugin),
				config: {
					maxItems:
						env.EXAMPLE_TODO_MAX_ITEMS === undefined ? 12 : Number(env.EXAMPLE_TODO_MAX_ITEMS),
					seedTitle: 'Trace a Todo from React to a Plugin',
				},
			},
			...redisConfigRecord(env.REDIS_CONNECTIONS),
		],
	}
}

/**
 * REDIS_CONNECTIONS (JSON array) becomes the base config layer of ForumRedisPlugin.
 * Not an `envBinding`: the static `modules` deployment build cannot yet resolve package Plugin
 * catalogs for env bindings, so Workbench edits can still override this value (see FORUM_PLAN).
 */
function redisConfigRecord(raw: string | undefined) {
	if (raw === undefined) return []
	let connections: unknown
	try {
		connections = JSON.parse(raw)
	} catch (cause) {
		throw new TypeError('REDIS_CONNECTIONS must be a JSON array', { cause })
	}
	return [
		{
			owner: pluginNodeAddressOf(ForumRedisPlugin),
			config: v.parse(ForumRedisConfig, { connections }),
		},
	]
}
