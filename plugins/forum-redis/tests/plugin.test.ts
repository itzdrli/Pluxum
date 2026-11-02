import { BasePlugin, Plugin, pluginNodeAddressOf } from '@pluxel/core'
import { defineRedisScript, Redis } from '@pluxel/plugin-redis'
import { createTestHost } from '@pluxel/test'
import { describe, expect, it } from 'vitest'
import { ForumRedisPlugin } from '@forum/forum-redis'

const connection = (url: string) => ({
	id: 'session',
	url,
	database: 0,
	connectTimeoutMs: 1_000,
	commandQueueMaxLength: 100,
	disableOfflineQueue: true,
	pingIntervalMs: 0,
})

@Plugin()
class RedisConsumer extends BasePlugin {
	constructor(readonly redis: Redis) {
		super()
	}
}

const Increment = defineRedisScript<readonly [string], readonly [string], number>({
	name: 'forum.test.increment',
	numberOfKeys: 1,
	source: `return redis.call('INCRBY', KEYS[1], ARGV[1])`,
	decode: (reply) => Number(reply),
})

describe('ForumRedisPlugin', () => {
	it('fails to start, and blocks its consumers, when a connection is unreachable', async () => {
		await using host = await createTestHost()
		const failure = await host.commitExpectFail((change) => {
			change.start(ForumRedisPlugin, {
				initialConfig: { connections: [connection('redis://127.0.0.1:1')] },
			})
			change.start(RedisConsumer)
		})
		expect(failure.lifecycleReport.issues).toContainEqual(
			expect.objectContaining({
				plugin: pluginNodeAddressOf(ForumRedisPlugin),
				kind: 'start-failed',
			}),
		)
		expect(host.isRunning(RedisConsumer)).toBe(false)
	})

	// Live check against the dev valkey (compose.dev.yaml); set FORUM_TEST_REDIS_URL to enable.
	const liveUrl = process.env.FORUM_TEST_REDIS_URL
	it.skipIf(!liveUrl)('serves owner-bound connections and revokes them on stop', async () => {
		await using host = await createTestHost()
		await host.commit((change) => {
			change.start(ForumRedisPlugin, {
				initialConfig: { connections: [connection(liveUrl!)] },
			})
			change.start(RedisConsumer)
		})
		const { redis } = host.require(RedisConsumer)
		expect(redis.connectionIds()).toEqual(['session'])

		const session = redis.connection('session')
		expect(await session.client.ping()).toBe('PONG')
		const key = `forum:test:${crypto.randomUUID()}`
		try {
			expect(await session.scripts.run(Increment, { keys: [key], arguments: ['2'] })).toBe(2)
			expect(await session.scripts.use(Increment)({ keys: [key], arguments: ['3'] })).toBe(5)
		} finally {
			await session.client.del(key)
		}

		await host.stop(ForumRedisPlugin)
		// Core's generation gate revokes the captured handle before the provider's own owner check.
		expect(() => session.client).toThrow('Plugin owner stopped')
		expect(host.isRunning(RedisConsumer)).toBe(false)
	})
})
