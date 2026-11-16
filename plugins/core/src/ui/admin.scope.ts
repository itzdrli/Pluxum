import { createWorkbenchRenderer } from '@pluxel/workbench/react'
import { ForumCoreWorkbench } from '../workbench.ts'
import type { AdminCategoryInput, AdminRoleChange, AdminUserQuery } from '../workbench.ts'

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
