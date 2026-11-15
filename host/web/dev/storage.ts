import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { defineDevConsole } from '@pluxel/host-vite/console'
import { Vault } from '@pluxel/services/vault'
import { ForumStoragePlugin } from '@forum/forum-attachments'

// Vault namespaces belong to their owner, so the credential record must be written through the
// storage plugin's own Context; a record written by this console lands in the console's namespace
// and the plugin never sees it. The plugin must be running (on any backend) to provision it.
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

export default defineDevConsole(async (dev) => {
	const storage = dev.plugins.isRunning(ForumStoragePlugin)
		? dev.plugins.require(ForumStoragePlugin)
		: undefined
	const record = storage
		? await storage.ctx
				.require(Vault)
				.kv({ namespace: FORUM_STORAGE_VAULT_NAMESPACE })
				.get(CREDENTIALS_KEY)
		: undefined
	return {
		running: storage !== undefined,
		buckets: storage?.bucketIds(),
		config: await dev.config.get(ForumStoragePlugin),
		credentialRecord: record ? { exists: record.exists, revision: record.revision } : 'unknown',
	}
})

export const setCredentials = defineDevConsole(async (dev) => {
	const accessKeyId = required(dev.input, 'accessKeyId')
	const secretAccessKey = required(dev.input, 'secretAccessKey')
	const vault = dev.plugins.require(ForumStoragePlugin).ctx.require(Vault)
	await vault
		.kv({ namespace: FORUM_STORAGE_VAULT_NAMESPACE })
		.set(CREDENTIALS_KEY, { accessKeyId, secretAccessKey })
	await vault.flush()
	// Remove a copy an earlier version of this script left in the console's own namespace.
	const consoleVault = dev.ctx.require(Vault)
	const stray = consoleVault.kv({ namespace: FORUM_STORAGE_VAULT_NAMESPACE })
	const removedConsoleCopy = (await stray.get(CREDENTIALS_KEY)).exists
	if (removedConsoleCopy) {
		await stray.delete(CREDENTIALS_KEY)
		await consoleVault.flush()
	}
	return { ok: true, removedConsoleCopy }
})

async function switchTo(
	dev: Parameters<Parameters<typeof defineDevConsole>[0]>[0],
	buckets: unknown,
) {
	const saved = await dev.config.patch(ForumStoragePlugin, { buckets })
	if (!saved.ok) return { saved }
	const restart = await dev.plugins.restart(ForumStoragePlugin)
	return { saved: saved.ok, restart, status: await dev.plugins.status(ForumStoragePlugin) }
}

export const useRemote = defineDevConsole(async (dev) =>
	switchTo(dev, [
		{
			id: 'default',
			backend: {
				type: 'remote',
				endpoint: field(dev.input, 'endpoint') ?? DEFAULT_ENDPOINT,
				region: 'us-east-1',
				credentials: { type: 'vault', namespace: FORUM_STORAGE_VAULT_NAMESPACE },
			},
		},
	]),
)

export const useLocal = defineDevConsole(async (dev) =>
	switchTo(dev, [
		{
			id: 'default',
			backend: { type: 'local', rootDir: LOCAL_ROOT, bucketName: LOCAL_BUCKET, syncWrites: true },
		},
	]),
)

/** Copies every object of the local backend's directory into the active `default` bucket. */
export const migrateLocal = defineDevConsole(async (dev) => {
	const objectsDir = join(
		resolve(process.cwd(), LOCAL_ROOT),
		'forum-buckets',
		Buffer.from(LOCAL_BUCKET, 'utf8').toString('hex'),
	)
	const client = dev.plugins.require(ForumStoragePlugin).bucket('default').client
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
})
