import { Plugin, type Context } from '@pluxel/core'
import {
	Redis,
	RedisConnectionError,
	RedisConnectionNotFoundError,
	RedisNotRunningError,
	RedisScripts,
	type RedisClient,
	type RedisConnection,
} from '@pluxel/plugin-redis'
import { createClient, type RedisClientType } from 'redis'
import * as v from 'valibot'
import * as f from 'valibot-form'

const ConnectionId = v.pipe(v.string(), v.regex(/^[a-z][a-z0-9-]{0,63}$/))

// Same shape as the official RedisConfig (deployments set REDIS_CONNECTIONS either way), declared
// with this workspace's valibot so config inference stays typed. Credentials stay out of config:
// a Vault-backed URL source is added here for deployment (M5).
const RedisConnectionConfig = v.object({
	id: v.pipe(
		ConnectionId,
		f.formMeta({ title: '连接 ID', description: '其他插件按这个名字取连接，例如 session。' }),
	),
	url: v.optional(
		v.pipe(
			v.string(),
			v.url(),
			v.check(
				isCredentialFreeRedisUrl,
				'Redis URL must be redis:// or rediss:// without credentials',
			),
			f.formMeta({ title: '地址', description: 'redis:// 或 rediss://，不能包含用户名和密码。' }),
			f.stringMeta({ placeholder: 'redis://127.0.0.1:6379' }),
		),
		'redis://127.0.0.1:6379',
	),
	database: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(0), f.formMeta({ title: '数据库编号' })),
		0,
	),
	connectTimeoutMs: v.optional(
		v.pipe(
			v.number(),
			v.integer(),
			v.minValue(1),
			f.formMeta({ title: '连接超时（毫秒）' }),
			f.numberMeta({ step: 1000 }),
		),
		10_000,
	),
	commandQueueMaxLength: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(1), f.formMeta({ title: '命令队列上限' })),
		10_000,
	),
	disableOfflineQueue: v.optional(
		v.pipe(
			v.boolean(),
			f.formMeta({
				title: '断线时直接报错',
				description: '开启后，断线期间的命令立即失败而不是排队等待。',
			}),
		),
		true,
	),
	pingIntervalMs: v.optional(
		v.pipe(
			v.number(),
			v.integer(),
			v.minValue(0),
			f.formMeta({ title: '心跳间隔（毫秒）', description: '0 表示不发送心跳。' }),
			f.numberMeta({ step: 1000 }),
		),
		0,
	),
})

export const ForumRedisConfig = v.object({
	connections: v.optional(
		v.pipe(
			v.array(RedisConnectionConfig),
			f.formMeta({
				title: '连接',
				description:
					'论坛使用的 Redis 连接。修改后需重启本插件；部署时由 REDIS_CONNECTIONS 提供初始值，这里保存的值会覆盖它。',
			}),
			f.arrayMeta({ itemLabel: '连接', addLabel: '添加连接', defaultItem: { id: 'default' } }),
			v.minLength(1),
			v.maxLength(64),
			v.check(
				(connections) => new Set(connections.map((c) => c.id)).size === connections.length,
				'Redis connection IDs must be unique',
			),
		),
		[{ id: 'default' }],
	),
})

type RedisConnectionConfig = v.InferOutput<typeof RedisConnectionConfig>

type ConnectionState = {
	readonly config: RedisConnectionConfig
	readonly client: RedisClientType
}

type OwnerState = {
	active: boolean
	readonly context: Context
	readonly handles: Map<string, RedisConnection>
}

/**
 * Forum-owned provider of the official `Redis` capability.
 *
 * The official `RedisPlugin` publishes a Markdown Workbench Content page that is neither emitted
 * into its built package nor compiled when the plugin is consumed from another workspace, so it
 * cannot start in this host. This provider keeps the same contract (config schema, named
 * connection catalog, owner-bound handles, typed Lua scripts) without the Workbench page, and is
 * also where Vault-backed credentials will land for deployment.
 */
@Plugin(Redis, { displayName: 'Forum Redis' })
export class ForumRedisPlugin extends Redis {
	private readonly config = this.configs.use(ForumRedisConfig)
	private ids: readonly string[] = Object.freeze([])
	private readonly states = new Map<string, ConnectionState>()
	private readonly owners = new WeakMap<Context, OwnerState>()
	private readonly activeOwners = new Set<OwnerState>()
	private active = false

	override connection(connectionId = 'default'): RedisConnection {
		this.assertRunning()
		const state = this.states.get(connectionId)
		if (!state) throw new RedisConnectionNotFoundError(connectionId)
		const owner = this.owner()
		const existing = owner.handles.get(connectionId)
		if (existing) return existing
		const handle = new ConnectionHandle(connectionId, () => {
			this.assertActive(owner, state)
			return toOfficialClient(state.client)
		})
		owner.handles.set(connectionId, handle)
		return handle
	}

	override connectionIds(): readonly string[] {
		this.assertRunning()
		return this.ids
	}

	protected override async init(signal: AbortSignal): Promise<void> {
		this.ids = Object.freeze(this.config.connections.map((connection) => connection.id))
		// All connections form one generation: any failure rolls back the ones already opened.
		const startup = new AbortController()
		const startupSignal = AbortSignal.any([signal, startup.signal])
		const results = await Promise.allSettled(
			this.config.connections.map(async (connection) => {
				try {
					await this.startConnection(connection, startupSignal)
				} catch (error) {
					startup.abort(error)
					throw error
				}
			}),
		)
		const failed = results.find(
			(result): result is PromiseRejectedResult => result.status === 'rejected',
		)
		if (failed) throw failed.reason
		signal.throwIfAborted()
		this.active = true
		this.ctx.effects.defer(() => this.deactivate(), {
			tag: 'ForumRedisCatalog',
			phase: 'shutdown',
		})
	}

	private async startConnection(config: RedisConnectionConfig, signal: AbortSignal): Promise<void> {
		signal.throwIfAborted()
		const client: RedisClientType = createClient({
			url: config.url,
			database: config.database,
			name: `forum:${config.id}`,
			commandsQueueMaxLength: config.commandQueueMaxLength,
			disableOfflineQueue: config.disableOfflineQueue,
			pingInterval: config.pingIntervalMs || undefined,
			socket: { connectTimeout: config.connectTimeoutMs },
		})
		const onError = (error: Error): void => {
			this.ctx.logger.error('Redis client error', { connectionId: config.id, error })
		}
		client.on('error', onError)
		let disposed = false
		const dispose = async (): Promise<void> => {
			if (disposed) return
			disposed = true
			client.off('error', onError)
			this.states.delete(config.id)
			try {
				if (client.isOpen) await client.close()
				else client.destroy()
			} catch {
				try {
					client.destroy()
				} catch {}
			}
		}
		this.ctx.effects.defer(dispose, { tag: `ForumRedisClient:${config.id}` })

		const abort = (): void => client.destroy()
		signal.addEventListener('abort', abort, { once: true })
		try {
			await connectWithin(client, config.connectTimeoutMs)
			signal.throwIfAborted()
		} catch (error) {
			await dispose()
			throw new RedisConnectionError(config.id, config.url, config.database, error)
		} finally {
			signal.removeEventListener('abort', abort)
		}
		this.states.set(config.id, { config, client })
	}

	private owner(): OwnerState {
		const context = this.ctx.caller ?? this.ctx
		const known = this.owners.get(context)
		if (known) {
			if (!known.active) throw new RedisNotRunningError()
			return known
		}
		const owner: OwnerState = { active: true, context, handles: new Map() }
		this.owners.set(context, owner)
		this.activeOwners.add(owner)
		try {
			context.effects.defer(() => this.releaseOwner(owner), {
				tag: 'ForumRedisConnections',
				phase: 'shutdown',
			})
		} catch {
			this.releaseOwner(owner)
			throw new RedisNotRunningError()
		}
		return owner
	}

	private assertRunning(): void {
		if (!this.active) throw new RedisNotRunningError()
	}

	private assertActive(owner: OwnerState, state: ConnectionState): void {
		if (
			!this.active ||
			!owner.active ||
			this.owners.get(owner.context) !== owner ||
			this.states.get(state.config.id) !== state ||
			!state.client.isOpen
		) {
			throw new RedisNotRunningError()
		}
	}

	private releaseOwner(owner: OwnerState): void {
		if (!owner.active) return
		owner.active = false
		owner.handles.clear()
		this.activeOwners.delete(owner)
		if (this.owners.get(owner.context) === owner) this.owners.delete(owner.context)
	}

	private deactivate(): void {
		if (!this.active) return
		this.active = false
		for (const owner of this.activeOwners) this.releaseOwner(owner)
	}
}

class ConnectionHandle implements RedisConnection {
	readonly scripts: RedisScripts

	constructor(
		readonly id: string,
		private readonly currentClient: () => RedisClient,
	) {
		this.scripts = new RedisScripts(currentClient)
	}

	get client(): RedisClient {
		return this.currentClient()
	}
}

/**
 * Same node-redis client, but the official `RedisClient` type is declared by the framework
 * checkout's copy of `redis`, whose `#private` members make the two declarations nominally
 * distinct. Narrow through a runtime guard instead of a blind assertion.
 */
function toOfficialClient(client: unknown): RedisClient {
	if (!isNodeRedisClient(client)) throw new TypeError('Expected a node-redis client')
	return client
}

function isNodeRedisClient(value: unknown): value is RedisClient {
	return (
		typeof value === 'object' &&
		value !== null &&
		'sendCommand' in value &&
		typeof value.sendCommand === 'function'
	)
}

function isCredentialFreeRedisUrl(value: string): boolean {
	const url = new URL(value)
	return (
		(url.protocol === 'redis:' || url.protocol === 'rediss:') &&
		url.username === '' &&
		url.password === '' &&
		(url.pathname === '' || url.pathname === '/') &&
		url.search === '' &&
		url.hash === ''
	)
}

async function connectWithin(client: RedisClientType, timeoutMs: number): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		await Promise.race([
			client.connect().then((): undefined => undefined),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => {
					reject(new Error(`Redis connection did not become ready within ${timeoutMs}ms.`))
				}, timeoutMs)
			}),
		])
	} finally {
		if (timer) clearTimeout(timer)
	}
}
