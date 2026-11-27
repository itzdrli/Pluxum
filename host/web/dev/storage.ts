import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Script } from '@pluxel/agent-sdk/host'
import { ForumStoragePlugin } from '@pluxum/attachments'

// Vault namespaces belong to their owner, so the credential record must be written through the
// storage plugin's own Context. The plugin must be running (on any backend) to provision it.
//
// vp exec pluxel dev run host/web/dev/storage.ts                         → config and record status
// vp exec pluxel dev run host/web/dev/storage.ts --export setCredentials \
//   --input '{"accessKeyId":"...","secretAccessKey":"..."}'             → write the plugin's record
// vp exec pluxel dev run host/web/dev/storage.ts --export useRemote \
//   [--input '{"endpoint":"http://127.0.0.1:19000/pluxel-forum"}']      → switch to rustfs, restart
// vp exec pluxel dev run host/web/dev/storage.ts --export migrateLocal   → copy local objects to the
//   active bucket (idempotent; objects keep their keys)
// vp exec pluxel dev run host/web/dev/storage.ts --export useLocal       → back to the local backend

export const FORUM_STORAGE_VAULT_NAMESPACE = 'forum-storage'
const CREDENTIALS_KEY = 's3.credentials'
const DEFAULT_ENDPOINT = 'http://127.0.0.1:19000/pluxel-forum'
const LOCAL_ROOT = '.pluxel/s3'
const LOCAL_BUCKET = 'local'

function field(input: unknown, name: string): string | undefined {
	const value: unknown =
		typeof input === 'object' && input !== null ? Reflect.get(input, name) : undefined
	return typeof value === 'string' && value !== '' ? value : undefined
}

function required(input: unknown, name: string): string {
	const value = field(input, name)
	if (value === undefined) throw new Error(`--input needs a "${name}" string`)
	return value
}

export default (async (sdk) => {
	const node = sdk.plugin(ForumStoragePlugin.nodeAddress())
	const status = await node.status()
	const running = status?.lifecycleState === 'running'
	const { instance } = running ? await node.instance() : { instance: undefined }
	const record = running
		? await (
				await node.context()
			).vault
				.kv({ namespace: FORUM_STORAGE_VAULT_NAMESPACE })
				.get(CREDENTIALS_KEY)
		: undefined
	return {
		running,
		buckets: instance?.bucketIds(),
		config: await node.config.get(),
		credentialRecord: record ? { exists: record.exists, revision: record.revision } : 'unknown',
	}
}) satisfies Script

export const setCredentials = (async (sdk, run) => {
	const accessKeyId = required(run.input, 'accessKeyId')
	const secretAccessKey = required(run.input, 'secretAccessKey')
	const { vault } = await sdk.plugin(ForumStoragePlugin.nodeAddress()).context()
	await vault
		.kv({ namespace: FORUM_STORAGE_VAULT_NAMESPACE })
		.set(CREDENTIALS_KEY, { accessKeyId, secretAccessKey })
	await vault.flush()
	return { ok: true }
}) satisfies Script

async function switchTo(sdk: Parameters<Script>[0], buckets: unknown) {
	const node = sdk.plugin(ForumStoragePlugin.nodeAddress())
	const saved = await node.config.patch({ set: { buckets } })
	const restart = await node.restart()
	return { saved, restart, status: await node.status() }
}

export const useRemote = (async (sdk, run) =>
	switchTo(sdk, [
		{
			id: 'default',
			backend: {
				type: 'remote',
				endpoint: field(run.input, 'endpoint') ?? DEFAULT_ENDPOINT,
				region: 'us-east-1',
				credentials: { type: 'vault', namespace: FORUM_STORAGE_VAULT_NAMESPACE },
			},
		},
	])) satisfies Script

export const useLocal = (async (sdk) =>
	switchTo(sdk, [
		{
			id: 'default',
			backend: { type: 'local', rootDir: LOCAL_ROOT, bucketName: LOCAL_BUCKET, syncWrites: true },
		},
	])) satisfies Script

/** Copies every object of the local backend's directory into the active `default` bucket. */
export const migrateLocal = (async (sdk) => {
	const objectsDir = join(
		resolve(process.cwd(), LOCAL_ROOT),
		'forum-buckets',
		Buffer.from(LOCAL_BUCKET, 'utf8').toString('hex'),
	)
	const { instance } = await sdk.plugin(ForumStoragePlugin.nodeAddress()).instance()
	const client = instance.bucket('default').client
	const folders = await readdir(objectsDir).catch(() => [])
	const metas = (
		await Promise.all(
			folders.map(async (folder) =>
				(await readdir(join(objectsDir, folder)))
					.filter((name) => name.endsWith('.json'))
					.map((name) => join(objectsDir, folder, name)),
			),
		)
	).flat()
	const copied = await Promise.all(
		metas.map(async (metaPath) => {
			const meta: unknown = JSON.parse(await readFile(metaPath, 'utf8'))
			const key = required(meta, 'key')
			const bytes = await readFile(metaPath.replace(/\.json$/, '.bin'))
			await client.putAnyObject(key, new Uint8Array(bytes), field(meta, 'contentType'))
			return key
		}),
	)
	return { from: objectsDir, copied }
}) satisfies Script
