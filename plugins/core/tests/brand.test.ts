import { mkdtemp, rm } from 'node:fs/promises'
import * as fsp from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FsPromises } from '@pluxel/core/fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BrandAssetStore, sniffBrandImage } from '../src/brand'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const ICO = new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16])
const SVG = new TextEncoder().encode(
	'<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>',
)
const HTML = new TextEncoder().encode('<html><script>alert(1)</script></html>')

/** Node's fs rooted at a temporary directory, standing in for the plugin's `ctx.fs()`. */
function rootedFs(root: string): FsPromises {
	const at = (path: string) => join(root, path)
	// oxlint-disable-next-line no-unsafe-type-assertion -- only the methods the store calls exist
	return {
		mkdir: (path: string, options?: object) => fsp.mkdir(at(path), options),
		open: (path: string, flags?: string, mode?: number) => fsp.open(at(path), flags, mode),
		rename: (from: string, to: string) => fsp.rename(at(from), at(to)),
		unlink: (path: string) => fsp.unlink(at(path)),
		rm: (path: string, options?: object) => fsp.rm(at(path), options),
		readFile: (path: string, encoding?: BufferEncoding) =>
			encoding ? fsp.readFile(at(path), encoding) : fsp.readFile(at(path)),
	} as unknown as FsPromises
}

describe('brand images', () => {
	let root: string
	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'pluxum-brand-'))
	})
	afterEach(async () => {
		await rm(root, { recursive: true, force: true })
	})

	it('sniffs types by content, never by name', () => {
		expect(sniffBrandImage(PNG)).toBe('image/png')
		expect(sniffBrandImage(ICO)).toBe('image/x-icon')
		expect(sniffBrandImage(SVG)).toBe('image/svg+xml')
		expect(sniffBrandImage(HTML)).toBeNull()
	})

	it('stores an image, versions its URL and survives a restart', async () => {
		const store = await BrandAssetStore.open(rootedFs(root))
		expect(store.url('logo')).toBeNull()
		expect(await store.write('logo', PNG)).toBeNull()
		const url = store.url('logo')
		expect(url).toMatch(/^\/api\/forum\/brand\/logo\?v=[0-9a-f]{12}$/)

		const reopened = await BrandAssetStore.open(rootedFs(root))
		expect(reopened.url('logo')).toBe(url)
		const asset = await reopened.read('logo')
		expect(asset?.type).toBe('image/png')
		expect([...(asset?.bytes ?? [])]).toEqual([...PNG])

		await reopened.remove('logo')
		expect(reopened.url('logo')).toBeNull()
		expect(await reopened.read('logo')).toBeNull()
		expect((await BrandAssetStore.open(rootedFs(root))).url('logo')).toBeNull()
	})

	it('refuses types a slot does not take, disguised files and oversized ones', async () => {
		const store = await BrandAssetStore.open(rootedFs(root))
		expect(await store.write('social', SVG)).toMatch(/不支持/)
		expect(await store.write('logo', ICO)).toMatch(/不支持/)
		expect(await store.write('icon', HTML)).toMatch(/不支持/)
		expect(await store.write('icon', new Uint8Array(256 * 1024 + 1))).toMatch(/太大/)
		expect(await store.write('icon', ICO)).toBeNull()
		expect(store.url('social')).toBeNull()
	})
})
