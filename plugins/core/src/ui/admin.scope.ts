import { createWorkbenchRenderer } from '@pluxel/workbench/react'
import { BRAND_UPLOAD_CHUNK_BYTES, type BrandAssetKind } from '@pluxum/domain'
import { ForumCoreWorkbench } from '../workbench.ts'
import type {
	AdminCategoryInput,
	AdminResult,
	AdminRoleChange,
	AdminUserQuery,
} from '../workbench.ts'

export const adminScope = createWorkbenchRenderer(ForumCoreWorkbench.admin)

export const categoriesQuery = adminScope.query(({ api }) => ({
	queryKey: ['forum', 'categories'] as const,
	queryFn: () => api.categoriesDto(),
}))

export const createCategory = adminScope.mutation(({ api }) => ({
	mutationFn: (input: AdminCategoryInput) => api.createCategoryDto(input),
	workbench: { invalidates: [categoriesQuery] },
}))

export const updateCategory = adminScope.mutation(({ api }) => ({
	mutationFn: ({ id, input }: { id: string; input: AdminCategoryInput }) =>
		api.updateCategoryDto(id, input),
	workbench: { invalidates: [categoriesQuery] },
}))

export const deleteCategory = adminScope.mutation(({ api }) => ({
	mutationFn: (id: string) => api.deleteCategoryDto(id),
	workbench: { invalidates: [categoriesQuery] },
}))

export const moveCategory = adminScope.mutation(({ api }) => ({
	mutationFn: ({ id, direction }: { id: string; direction: 'up' | 'down' }) =>
		api.moveCategoryDto(id, direction),
	workbench: { invalidates: [categoriesQuery] },
}))

export const usersQuery = adminScope.queryFamily(({ api }, input: AdminUserQuery) => ({
	queryKey: ['forum', 'users', input.query, input.page] as const,
	queryFn: () => api.usersDto(input),
}))

export const setRole = adminScope.mutation(({ api }) => ({
	mutationFn: (input: AdminRoleChange) => api.setRoleDto(input),
	workbench: { invalidates: [usersQuery.all()] },
}))

export const brandQuery = adminScope.query(({ api }) => ({
	queryKey: ['forum', 'brand'] as const,
	queryFn: () => api.brandDto(),
}))

/** Sends the file in order, chunk by chunk; the last chunk stores it. */
export const uploadBrand = adminScope.mutation(({ api }) => ({
	mutationFn: async ({
		kind,
		file,
	}: {
		kind: BrandAssetKind
		file: File
	}): Promise<AdminResult> => {
		const bytes = new Uint8Array(await file.arrayBuffer())
		if (bytes.byteLength === 0) return { ok: false, message: '文件是空的。' }
		// Each chunk must arrive after the one before it, so they are sent one at a time.
		const sendFrom = async (offset: number): Promise<AdminResult> => {
			if (offset >= bytes.byteLength) return { ok: true }
			const chunk = bytes.slice(offset, offset + BRAND_UPLOAD_CHUNK_BYTES)
			const result = await api.uploadBrandDto(kind, bytes.byteLength, offset, chunk)
			return result.ok ? sendFrom(offset + chunk.byteLength) : result
		}
		return sendFrom(0)
	},
	workbench: { invalidates: [brandQuery] },
}))

export const removeBrand = adminScope.mutation(({ api }) => ({
	mutationFn: (kind: BrandAssetKind) => api.removeBrandDto(kind),
	workbench: { invalidates: [brandQuery] },
}))
