import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { Plugin, type Context } from '@pluxel/core'
import { Vault } from '@pluxel/services/vault'
import {
	S3,
	S3BucketNotFoundError,
	S3CredentialsError,
	S3NotRunningError,
	S3UnsupportedOperationError,
	type S3AccessKeyCredentials,
	type S3Bucket,
	type S3Client,
} from '@pluxel/plugin-storage'
import { S3mini, sanitizeETag } from 's3mini'
import * as v from 'valibot'

const MEBIBYTE = 1024 * 1024

const BucketId = v.pipe(
	v.string(),
	v.regex(
		/^[a-z][a-z0-9._-]{0,63}$/,
		'Bucket ID must start with a lowercase letter and contain at most 64 lowercase letters, digits, dots, underscores, or hyphens',
	),
)

function isCredentialFreeEndpoint(value: string): boolean {
	try {
		const url = new URL(value)
		return (
			(url.protocol === 'http:' || url.protocol === 'https:') &&
			!url.username &&
			!url.password &&
			!url.search &&
			!url.hash
		)
	} catch {
		return false
	}
}

const LocalBackendConfig = v.object({
	type: v.literal('local'),
	rootDir: v.optional(v.pipe(v.string(), v.minLength(1)), '.pluxel/s3'),
	bucketName: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(255))),
	syncWrites: v.optional(v.boolean(), true),
})

const RemoteCredentialsConfig = v.variant('type', [
	v.object({ type: v.literal('anonymous') }),
	v.object({
		type: v.literal('vault'),
		key: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(256))),
		namespace: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(256))),
	}),
])

const RemoteBackendConfig = v.object({
	type: v.literal('remote'),
	endpoint: v.pipe(
		v.string(),
		v.url(),
		v.check(
			isCredentialFreeEndpoint,
			'S3 endpoint must use http:// or https:// without credentials, query, or hash',
		),
	),
	region: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(128)), 'auto'),
	credentials: RemoteCredentialsConfig,
	requestSizeInBytes: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 8 * MEBIBYTE),
	requestAbortTimeout: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 30_000),
	minPartSize: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(5 * MEBIBYTE), v.maxValue(5 * 1024 * MEBIBYTE)),
		8 * MEBIBYTE,
	),
})

const BucketConfig = v.object({
	id: BucketId,
	backend: v.variant('type', [LocalBackendConfig, RemoteBackendConfig]),
})

export const ForumStorageConfig = v.object({
	buckets: v.optional(
		v.pipe(
			v.array(BucketConfig),
			v.minLength(1),
			v.maxLength(64),
			v.check(
				(buckets) => new Set(buckets.map((b) => b.id)).size === buckets.length,
				'S3 bucket IDs must be unique',
			),
		),
		[
			{
				id: 'default',
				backend: {
					type: 'local',
					rootDir: '.pluxel/s3',
					bucketName: 'local',
					syncWrites: true,
				},
			},
		],
	),
})

export type ForumStorageBucketConfig = v.InferOutput<typeof BucketConfig>

type BucketState = {
	readonly config: ForumStorageBucketConfig
	client: S3Client
	credentialError?: Error
}

type OwnerState = {
	active: boolean
	readonly context: Context
	readonly handles: Map<string, S3Bucket>
}

/**
 * Forum-owned provider of the official `S3` capability (`@pluxel/plugin-storage`).
 *
 * Like `ForumRedisPlugin`, it avoids the official `S3Plugin`'s Markdown Workbench Content page
 * (which does not compile when consumed across workspaces in dev), while keeping the same bucket
 * catalog contract, Vault-backed S3 credentials and s3mini client surface for `rustfs` and local
 * storage.
 */
@Plugin(S3, { displayName: 'Forum Storage' })
export class ForumStoragePlugin extends S3 {
	private readonly config = this.configs.use(ForumStorageConfig)
	private ids: readonly string[] = Object.freeze([])
	private readonly states = new Map<string, BucketState>()
	private readonly owners = new WeakMap<Context, OwnerState>()
	private readonly activeOwners = new Set<OwnerState>()
	private active = false

	override bucket(bucketId = 'default'): S3Bucket {
		this.assertRunning()
		const state = this.states.get(bucketId)
		if (!state) throw new S3BucketNotFoundError(bucketId)
		const owner = this.owner()
		const existing = owner.handles.get(bucketId)
		if (existing) return existing
		const handle = new BucketHandle(bucketId, () => {
			this.assertActive(owner, state)
			if (state.credentialError) throw state.credentialError
			return state.client
		})
		owner.handles.set(bucketId, handle)
		return handle
	}

	override bucketIds(): readonly string[] {
		this.assertRunning()
		return this.ids
	}

	protected override async init(signal: AbortSignal): Promise<void> {
		this.ids = Object.freeze(this.config.buckets.map((bucket) => bucket.id))
		const startup = new AbortController()
		const startupSignal = AbortSignal.any([signal, startup.signal])
		const results = await Promise.allSettled(
			this.config.buckets.map(async (bucket) => {
				try {
					await this.startBucket(bucket, startupSignal)
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
			tag: 'ForumStorageCatalog',
			phase: 'shutdown',
		})
	}

	private async startBucket(config: ForumStorageBucketConfig, signal: AbortSignal): Promise<void> {
		signal.throwIfAborted()
		if (config.backend.type === 'local') {
			const client = new SimpleLocalS3Client(
				resolve(process.cwd(), config.backend.rootDir),
				config.backend.bucketName ?? config.id,
			)
			await client.createBucket()
			this.states.set(config.id, { config, client: toS3Client(client) })
			this.ctx.effects.defer(
				() => {
					client.dispose()
					this.states.delete(config.id)
				},
				{ tag: `ForumLocalS3:${config.id}` },
			)
			return
		}

		const backend = config.backend
		const makeClient = (credentials?: S3AccessKeyCredentials): S3Client =>
			new S3mini({
				accessKeyId: credentials?.accessKeyId ?? '',
				secretAccessKey: credentials?.secretAccessKey ?? '',
				endpoint: backend.endpoint,
				region: backend.region,
				requestSizeInBytes: backend.requestSizeInBytes,
				requestAbortTimeout: backend.requestAbortTimeout,
				minPartSize: backend.minPartSize,
			})

		let disposeWatch: (() => void) | undefined
		try {
			let credentials: S3AccessKeyCredentials | undefined
			let state: BucketState | undefined
			if (backend.credentials.type === 'vault') {
				const ref = backend.credentials
				const key =
					ref.key ?? (config.id === 'default' ? 's3.credentials' : `s3.${config.id}.credentials`)
				const vault = this.requireVault(config.id, key)
				const parseSnapshot = (snapshot: {
					exists: boolean
					value: unknown
				}): S3AccessKeyCredentials => {
					if (!snapshot.exists) throw new S3CredentialsError('missing', config.id, key)
					try {
						return parseCredentials(snapshot.value)
					} catch (cause) {
						throw new S3CredentialsError('invalid', config.id, key, cause)
					}
				}
				const watched = await vault
					.kv(ref.namespace ? { namespace: ref.namespace } : undefined)
					.watch(key, (snapshot) => {
						if (!state) return
						try {
							state.client = makeClient(parseSnapshot(snapshot))
							state.credentialError = undefined
						} catch (error) {
							state.credentialError =
								error instanceof Error ? error : new Error('Invalid S3 credentials')
						}
					})
				disposeWatch = watched.dispose
				credentials = parseSnapshot(watched.snapshot)
			}

			const client = makeClient(credentials)
			// Ensure the remote bucket exists and credentials work before declaring the plugin ready.
			if (backend.credentials.type === 'vault') {
				const exists = await client.bucketExists()
				if (!exists) await client.createBucket()
			}
			signal.throwIfAborted()
			state = { config, client }
			this.states.set(config.id, state)
			this.ctx.effects.defer(
				() => {
					disposeWatch?.()
					this.states.delete(config.id)
				},
				{ tag: `ForumRemoteS3:${config.id}` },
			)
		} catch (error) {
			disposeWatch?.()
			throw error
		}
	}

	private requireVault(bucketId: string, key: string) {
		try {
			return this.ctx.require(Vault)
		} catch (cause) {
			throw new S3CredentialsError('unavailable', bucketId, key, cause)
		}
	}

	private owner(): OwnerState {
		const context = this.ctx.caller ?? this.ctx
		const known = this.owners.get(context)
		if (known) {
			if (!known.active) throw new S3NotRunningError()
			return known
		}
		const owner: OwnerState = { active: true, context, handles: new Map() }
		this.owners.set(context, owner)
		this.activeOwners.add(owner)
		try {
			context.effects.defer(() => this.releaseOwner(owner), {
				tag: 'ForumStorageBuckets',
				phase: 'shutdown',
			})
		} catch {
			this.releaseOwner(owner)
			throw new S3NotRunningError()
		}
		return owner
	}

	private assertRunning(): void {
		if (!this.active) throw new S3NotRunningError()
	}

	private assertActive(owner: OwnerState, state: BucketState): void {
		this.assertRunning()
		if (
			!owner.active ||
			this.owners.get(owner.context) !== owner ||
			this.states.get(state.config.id) !== state
		) {
			throw new S3NotRunningError()
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

class BucketHandle implements S3Bucket {
	constructor(
		readonly id: string,
		private readonly resolveClient: () => S3Client,
	) {}

	get client(): S3Client {
		return this.resolveClient()
	}
}

function toS3Client(client: unknown): S3Client {
	if (!isS3Client(client)) throw new TypeError('Expected an S3Client')
	return client
}

function isS3Client(value: unknown): value is S3Client {
	return (
		typeof value === 'object' &&
		value !== null &&
		'putAnyObject' in value &&
		typeof value.putAnyObject === 'function'
	)
}

function parseCredentials(value: unknown): S3AccessKeyCredentials {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Expected an S3 credential object')
	}
	const accessKeyId: unknown = Reflect.get(value, 'accessKeyId')
	const secretAccessKey: unknown = Reflect.get(value, 'secretAccessKey')
	if (
		typeof accessKeyId !== 'string' ||
		!accessKeyId.trim() ||
		accessKeyId.length > 256 ||
		/[\r\n]/.test(accessKeyId) ||
		typeof secretAccessKey !== 'string' ||
		!secretAccessKey.trim() ||
		secretAccessKey.length > 4096 ||
		/[\r\n]/.test(secretAccessKey)
	) {
		throw new TypeError('Invalid S3 access-key credentials')
	}
	return Object.freeze({ accessKeyId, secretAccessKey })
}

type LocalMeta = Readonly<{
	key: string
	contentType: string
	etag: string
	size: number
	lastModified: string
}>

class SimpleLocalS3Client {
	private disposed = false
	private readonly objectsDir: string

	constructor(rootDir: string, bucketName: string) {
		const safeBucket = Buffer.from(bucketName, 'utf8').toString('hex')
		this.objectsDir = join(rootDir, 'forum-buckets', safeBucket)
	}

	dispose(): void {
		this.disposed = true
	}

	private check(): void {
		if (this.disposed) throw new S3NotRunningError()
	}

	private paths(key: string): { dataPath: string; metaPath: string } {
		if (typeof key !== 'string' || !key.trim()) {
			throw new TypeError('[s3mini] key must be a non-empty string')
		}
		const digest = createHash('sha256').update(key, 'utf8').digest('hex')
		const folder = join(this.objectsDir, digest.slice(0, 2))
		return {
			dataPath: join(folder, `${digest}.bin`),
			metaPath: join(folder, `${digest}.json`),
		}
	}

	sanitizeETag(etag: string): string {
		return sanitizeETag(etag)
	}

	async createBucket(): Promise<boolean> {
		this.check()
		await mkdir(this.objectsDir, { recursive: true })
		return true
	}

	async bucketExists(): Promise<boolean> {
		this.check()
		return true
	}

	async putObject(
		key: string,
		data: string | Uint8Array | ArrayBuffer | Blob | ReadableStream<Uint8Array>,
		contentType = 'application/octet-stream',
	): Promise<Response> {
		return this.putAnyObject(key, data, contentType)
	}

	async putAnyObject(
		key: string,
		data: string | Uint8Array | ArrayBuffer | Blob | ReadableStream<Uint8Array>,
		contentType = 'application/octet-stream',
	): Promise<Response> {
		this.check()
		const bytes = await toBytes(data)
		const etag = createHash('sha256').update(bytes).digest('hex')
		const { dataPath, metaPath } = this.paths(key)
		await mkdir(dirname(dataPath), { recursive: true })
		const meta: LocalMeta = {
			key,
			contentType,
			etag,
			size: bytes.byteLength,
			lastModified: new Date().toISOString(),
		}
		await writeFile(dataPath, bytes)
		await writeFile(metaPath, JSON.stringify(meta), 'utf8')
		return new Response(null, { status: 200, headers: { etag: `"${etag}"` } })
	}

	private async readStored(key: string): Promise<{ bytes: Buffer; meta: LocalMeta } | null> {
		this.check()
		const { dataPath, metaPath } = this.paths(key)
		try {
			const [bytes, rawMeta] = await Promise.all([readFile(dataPath), readFile(metaPath, 'utf8')])
			const parsed: unknown = JSON.parse(rawMeta)
			if (!isLocalMeta(parsed)) throw new Error('Corrupt local S3 metadata')
			return { bytes, meta: parsed }
		} catch (error) {
			if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
				return null
			}
			throw error
		}
	}

	async getObject(key: string): Promise<string | null> {
		const stored = await this.readStored(key)
		return stored ? stored.bytes.toString('utf8') : null
	}

	async getObjectArrayBuffer(key: string): Promise<ArrayBuffer | null> {
		const stored = await this.readStored(key)
		if (!stored) return null
		return copyToArrayBuffer(stored.bytes)
	}

	async getObjectResponse(key: string): Promise<Response | null> {
		const stored = await this.readStored(key)
		if (!stored) return null
		return new Response(copyToArrayBuffer(stored.bytes), {
			status: 200,
			headers: {
				'content-type': stored.meta.contentType,
				'content-length': String(stored.meta.size),
				etag: `"${stored.meta.etag}"`,
			},
		})
	}

	async getObjectWithETag(key: string): Promise<{ etag: string | null; data: ArrayBuffer | null }> {
		const stored = await this.readStored(key)
		if (!stored) return { etag: null, data: null }
		return {
			etag: stored.meta.etag,
			data: copyToArrayBuffer(stored.bytes),
		}
	}

	async objectExists(key: string): Promise<boolean | null> {
		const stored = await this.readStored(key)
		return Boolean(stored)
	}

	async deleteObject(key: string): Promise<boolean> {
		this.check()
		const { dataPath, metaPath } = this.paths(key)
		await Promise.all([rm(dataPath, { force: true }), rm(metaPath, { force: true })])
		return true
	}

	getPresignedUrl(): Promise<string> {
		return Promise.reject(new S3UnsupportedOperationError('pre-signed URLs'))
	}
}

function isLocalMeta(value: unknown): value is LocalMeta {
	return (
		typeof value === 'object' &&
		value !== null &&
		'key' in value &&
		typeof value.key === 'string' &&
		'contentType' in value &&
		typeof value.contentType === 'string' &&
		'etag' in value &&
		typeof value.etag === 'string' &&
		'size' in value &&
		typeof value.size === 'number' &&
		'lastModified' in value &&
		typeof value.lastModified === 'string'
	)
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const out = new ArrayBuffer(bytes.byteLength)
	new Uint8Array(out).set(bytes)
	return out
}

async function toBytes(
	data: string | Uint8Array | ArrayBuffer | Blob | ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
	if (typeof data === 'string') return new TextEncoder().encode(data)
	if (data instanceof Uint8Array) return data
	if (data instanceof ArrayBuffer) return new Uint8Array(data)
	if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer())
	return new Uint8Array(await new Response(data).arrayBuffer())
}
