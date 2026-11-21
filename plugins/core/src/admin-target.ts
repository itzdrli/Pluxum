import {
	BRAND_ASSET_KINDS,
	isAssignableRole,
	isBrandAssetKind,
	type BrandAssetKind,
	type Principal,
} from '@pluxum/domain'
import { assertWorkbenchDto } from '@pluxel/workbench/server'
import { RpcTarget } from 'capnweb'
import { BRAND_ASSET_RULES } from './brand'
import type { ForumCorePlugin } from './index'
import { BRAND_UPLOAD_CHUNK_BYTES } from './workbench'
import type {
	AdminBrandAsset,
	AdminCategory,
	AdminCategoryInput,
	AdminResult,
	AdminRoleChange,
	AdminUserPage,
	AdminUserQuery,
	ForumAdminApi,
} from './workbench'

/**
 * Who the Workbench admin page acts as. Workbench is an operator tool reachable only on the
 * internal network, so its operator holds the forum's admin role without being a forum account.
 */
export const WORKBENCH_OPERATOR: Principal = Object.freeze({
	userId: null,
	roles: Object.freeze(['admin'] as const),
})

const ID = /^[0-9a-f-]{36}$/i

/** Browser input is untyped at runtime, whatever the API's TypeScript signature says. */
function isId(value: unknown): value is string {
	return typeof value === 'string' && ID.test(value)
}

function text(value: unknown, max: number): string | null {
	return typeof value === 'string' && value.length <= max ? value : null
}

function failed(message: string): AdminResult {
	return { ok: false, message }
}

/** One open of the admin page. Inputs come from the browser, so every method checks them. */
export class ForumAdminTarget extends RpcTarget implements ForumAdminApi {
	/** The image being uploaded on this page, chunk by chunk. */
	private upload: { kind: BrandAssetKind; bytes: Uint8Array; received: number } | null = null

	constructor(private readonly core: ForumCorePlugin) {
		super()
	}

	async brandDto(): Promise<readonly AdminBrandAsset[]> {
		const site = this.core.site()
		const list = BRAND_ASSET_KINDS.map((kind) => {
			const meta = this.core.brandAssetMeta(kind)
			return {
				kind,
				url: site.brand[kind],
				type: meta?.type ?? null,
				size: meta?.size ?? null,
				accept: [...BRAND_ASSET_RULES[kind].types],
				maxBytes: BRAND_ASSET_RULES[kind].maxBytes,
			}
		})
		assertWorkbenchDto(list, 'Forum brand images')
		return list
	}

	async uploadBrandDto(
		kind: BrandAssetKind,
		total: number,
		offset: number,
		chunk: Uint8Array,
	): Promise<AdminResult> {
		if (!isBrandAssetKind(kind)) return failed('未知的图片位置。')
		if (!(chunk instanceof Uint8Array) || chunk.byteLength > BRAND_UPLOAD_CHUNK_BYTES)
			return failed('上传的数据不对，请重试。')
		const maxBytes = BRAND_ASSET_RULES[kind].maxBytes
		if (!Number.isSafeInteger(total) || total <= 0) return failed('文件是空的。')
		if (total > maxBytes) return failed(`文件太大，最多 ${Math.round(maxBytes / 1024)} KB。`)
		if (offset === 0) this.upload = { kind, bytes: new Uint8Array(total), received: 0 }
		const upload = this.upload
		if (
			!upload ||
			upload.kind !== kind ||
			upload.bytes.byteLength !== total ||
			offset !== upload.received ||
			offset + chunk.byteLength > total
		) {
			this.upload = null
			return failed('上传中断了，请重新选择文件。')
		}
		upload.bytes.set(chunk, offset)
		upload.received += chunk.byteLength
		if (upload.received < total) return { ok: true }
		this.upload = null
		const refused = await this.core.setBrandAsset(kind, upload.bytes)
		return refused ? failed(refused) : { ok: true }
	}

	async removeBrandDto(kind: BrandAssetKind): Promise<AdminResult> {
		if (!isBrandAssetKind(kind)) return failed('未知的图片位置。')
		await this.core.removeBrandAsset(kind)
		return { ok: true }
	}

	async categoriesDto(): Promise<readonly AdminCategory[]> {
		const list = (await this.core.listCategories(WORKBENCH_OPERATOR)).map((category) => ({
			id: category.id,
			slug: category.slug,
			name: category.name,
			description: category.description,
			position: category.position,
			threadCount: category.threadCount,
			postCount: category.postCount,
		}))
		assertWorkbenchDto(list, 'Forum categories')
		return list
	}

	async createCategoryDto(input: AdminCategoryInput): Promise<AdminResult> {
		const fields = this.categoryInput(input)
		if (fields === null) return failed('输入无效')
		const existing = await this.core.listCategories(WORKBENCH_OPERATOR)
		const position = Math.max(0, ...existing.map((category) => category.position)) + 10
		const created = await this.core.createCategory(WORKBENCH_OPERATOR, {
			name: fields.name,
			...(fields.slug === '' ? {} : { slug: fields.slug }),
			description: fields.description,
			position,
		})
		return created.isOk() ? { ok: true } : failed(created.error.message)
	}

	async updateCategoryDto(categoryId: string, input: AdminCategoryInput): Promise<AdminResult> {
		const fields = this.categoryInput(input)
		if (fields === null || !isId(categoryId)) return failed('输入无效')
		const updated = await this.core.updateCategory(WORKBENCH_OPERATOR, categoryId, {
			name: fields.name,
			...(fields.slug === '' ? {} : { slug: fields.slug }),
			description: fields.description,
		})
		return updated.isOk() ? { ok: true } : failed(updated.error.message)
	}

	async deleteCategoryDto(categoryId: string): Promise<AdminResult> {
		if (!isId(categoryId)) return failed('输入无效')
		const removed = await this.core.deleteCategory(WORKBENCH_OPERATOR, categoryId)
		return removed.isOk() ? { ok: true } : failed(removed.error.message)
	}

	/** Swaps a category with its neighbour, then renumbers every position 10, 20, 30, ... */
	async moveCategoryDto(categoryId: string, direction: 'up' | 'down'): Promise<AdminResult> {
		if (!isId(categoryId) || (direction !== 'up' && direction !== 'down')) {
			return failed('输入无效')
		}
		const order = [...(await this.core.listCategories(WORKBENCH_OPERATOR))]
		const index = order.findIndex((category) => category.id === categoryId)
		if (index === -1) return failed('版块不存在')
		const target = direction === 'up' ? index - 1 : index + 1
		if (target < 0 || target >= order.length) return { ok: true }
		const moved = order[index]
		order[index] = order[target]!
		order[target] = moved
		const results = await Promise.all(
			order.flatMap((category, i) => {
				const position = (i + 1) * 10
				return category.position === position
					? []
					: [this.core.updateCategory(WORKBENCH_OPERATOR, category.id, { position })]
			}),
		)
		const error = results.find((result) => result.isErr())
		return error?.isErr() ? failed(error.error.message) : { ok: true }
	}

	async usersDto(input: AdminUserQuery): Promise<AdminUserPage> {
		const query = text(input?.query, 64) ?? ''
		const page = Number.isSafeInteger(input?.page) && input.page >= 1 ? input.page : 1
		const result = await this.core.listUsers({ query, page, pageSize: 20 })
		const dto: AdminUserPage = {
			items: result.items.map((user) => ({ ...user, roles: [...user.roles] })),
			total: result.total,
			page: result.page,
			pageSize: result.pageSize,
		}
		assertWorkbenchDto(dto, 'Forum users')
		return dto
	}

	async setRoleDto(input: AdminRoleChange): Promise<AdminResult> {
		const userId = text(input?.userId, 64)
		if (userId === null || !isId(userId) || !isAssignableRole(input.role)) {
			return failed('输入无效')
		}
		const result = input.granted
			? await this.core.grantRole(userId, input.role)
			: await this.core.revokeRole(userId, input.role)
		return result.isOk() ? { ok: true } : failed(result.error.message)
	}

	private categoryInput(input: AdminCategoryInput): AdminCategoryInput | null {
		const name = text(input?.name, 200)
		const slug = text(input?.slug, 200)
		const description = text(input?.description, 2000)
		if (name === null || slug === null || description === null) return null
		return { name, slug: slug.trim(), description }
	}
}
