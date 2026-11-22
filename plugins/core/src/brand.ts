import { createHash } from 'node:crypto'
import * as v from 'valibot'
import { writeFileAtomic, type FsPromises } from '@pluxel/core/fs'
import { BRAND_ASSET_KINDS, type BrandAssetKind } from '@pluxum/domain'

/** The plugin's file handle, as `ctx.fs({ durable: true, writable: true })` returns it. */
type BrandFiles = FsPromises

export type BrandImageType =
	| 'image/png'
	| 'image/jpeg'
	| 'image/webp'
	| 'image/gif'
	| 'image/svg+xml'
	| 'image/x-icon'

/** Which image types each kind accepts and how large it may be. */
export const BRAND_ASSET_RULES: Readonly<
	Record<BrandAssetKind, Readonly<{ types: readonly BrandImageType[]; maxBytes: number }>>
> = {
	logo: {
		types: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'],
		maxBytes: 512 * 1024,
	},
	icon: {
		types: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'image/x-icon'],
		maxBytes: 256 * 1024,
	},
	// Link previews (Open Graph) only take raster images.
	social: { types: ['image/png', 'image/jpeg', 'image/webp'], maxBytes: 2 * 1024 * 1024 },
}

export type BrandAssetMeta = Readonly<{ type: BrandImageType; version: string; size: number }>
export type BrandAsset = BrandAssetMeta & Readonly<{ bytes: Uint8Array<ArrayBuffer> }>

const startsWith = (bytes: Uint8Array, prefix: readonly number[], offset = 0) =>
	bytes.byteLength >= offset + prefix.length &&
	prefix.every((value, index) => bytes[offset + index] === value)

/**
 * The image type by its magic bytes, never by a name or a claimed type. SVG is recognised by
 * its root element; it is served with a sandboxing CSP, so scripts inside it never run.
 */
export function sniffBrandImage(bytes: Uint8Array): BrandImageType | null {
	if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
	if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
	if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif'
	if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
		return 'image/webp'
	if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) return 'image/x-icon'
	const head = new TextDecoder('utf-8', { fatal: false })
		.decode(bytes.subarray(0, 1024))
		.replace(/^﻿/, '')
		.trimStart()
	if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head))
		return 'image/svg+xml'
	return null
}

/**
 * Brand images uploaded in Workbench, kept in Pluxum Core's own durable files: `brand/<kind>`
 * holds the bytes and `brand/<kind>.json` the sniffed type and a content version for cache
 * busting. Metadata is held in memory so building `SiteDto` never touches the disk.
 */
export class BrandAssetStore {
	private readonly meta = new Map<BrandAssetKind, BrandAssetMeta>()

	private constructor(private readonly files: BrandFiles) {}

	static async open(files: BrandFiles): Promise<BrandAssetStore> {
		const store = new BrandAssetStore(files)
		const metas = await Promise.all(BRAND_ASSET_KINDS.map((kind) => store.readMeta(kind)))
		BRAND_ASSET_KINDS.forEach((kind, index) => {
			const meta = metas[index]
			if (meta) store.meta.set(kind, meta)
		})
		return store
	}

	/** The forum-relative URL of an uploaded image, or null for the built-in one. */
	url(kind: BrandAssetKind): string | null {
		const meta = this.meta.get(kind)
		return meta ? `/api/forum/brand/${kind}?v=${meta.version}` : null
	}

	describe(kind: BrandAssetKind): BrandAssetMeta | null {
		return this.meta.get(kind) ?? null
	}

	async read(kind: BrandAssetKind): Promise<BrandAsset | null> {
		const meta = this.meta.get(kind)
		if (!meta) return null
		try {
			const bytes = await this.files.readFile(`brand/${kind}`)
			return { ...meta, bytes: new Uint8Array(bytes) }
		} catch (error) {
			if (isNotFound(error)) return null
			throw error
		}
	}

	/** Stores an image, or says in plain words why it was refused. */
	async write(kind: BrandAssetKind, bytes: Uint8Array): Promise<string | null> {
		const rules = BRAND_ASSET_RULES[kind]
		if (bytes.byteLength === 0) return '文件是空的。'
		if (bytes.byteLength > rules.maxBytes)
			return `文件太大，最多 ${Math.round(rules.maxBytes / 1024)} KB。`
		const type = sniffBrandImage(bytes)
		if (!type || !rules.types.includes(type))
			return `不支持这种文件，可以用 ${describeTypes(rules.types)}。`
		const version = createHash('sha256').update(bytes).digest('hex').slice(0, 12)
		const meta: BrandAssetMeta = { type, version, size: bytes.byteLength }
		await writeFileAtomic(this.files, `brand/${kind}`, bytes)
		await writeFileAtomic(this.files, `brand/${kind}.json`, JSON.stringify(meta))
		this.meta.set(kind, meta)
		return null
	}

	async remove(kind: BrandAssetKind): Promise<void> {
		this.meta.delete(kind)
		await this.files.rm(`brand/${kind}.json`, { force: true })
		await this.files.rm(`brand/${kind}`, { force: true })
	}

	private async readMeta(kind: BrandAssetKind): Promise<BrandAssetMeta | null> {
		let text: string
		try {
			text = await this.files.readFile(`brand/${kind}.json`, 'utf8')
		} catch (error) {
			if (isNotFound(error)) return null
			throw error
		}
		let parsed: unknown
		try {
			parsed = JSON.parse(text)
		} catch {
			return null
		}
		const meta = v.safeParse(
			v.object({
				type: v.picklist(BRAND_ASSET_RULES[kind].types),
				version: v.pipe(v.string(), v.regex(/^[0-9a-f]{12}$/)),
				size: v.pipe(v.number(), v.integer(), v.minValue(1)),
			}),
			parsed,
		)
		return meta.success ? meta.output : null
	}
}

function isNotFound(error: unknown): boolean {
	return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

const TYPE_NAMES: Readonly<Record<BrandImageType, string>> = {
	'image/png': 'PNG',
	'image/jpeg': 'JPEG',
	'image/webp': 'WebP',
	'image/gif': 'GIF',
	'image/svg+xml': 'SVG',
	'image/x-icon': 'ICO',
}

function describeTypes(types: readonly BrandImageType[]): string {
	return types.map((type) => TYPE_NAMES[type]).join('、')
}
