import type { BrandAssetKind, CategoryAccess } from '@pluxum/domain'
import type { RpcTarget } from 'capnweb'
import { workbench } from '@pluxel/workbench'

/** A category as the admin page lists it. */
export type AdminCategory = Readonly<{
	id: string
	slug: string
	name: string
	description: string
	position: number
	access: CategoryAccess
	threadCount: number
	postCount: number
}>

export type AdminCategoryInput = Readonly<{
	name: string
	/** Empty: derived from the name. */
	slug: string
	description: string
	access: CategoryAccess
}>

export type AdminRole = 'moderator' | 'admin'

export type AdminUser = Readonly<{
	id: string
	number: number
	handle: string
	displayName: string
	createdAt: string
	roles: readonly AdminRole[]
}>

export type AdminUserPage = Readonly<{
	items: readonly AdminUser[]
	total: number
	page: number
	pageSize: number
}>

export type AdminUserQuery = Readonly<{ query: string; page: number }>

export type AdminRoleChange = Readonly<{ userId: string; role: AdminRole; granted: boolean }>

/** What a change answers: done, or why not (shown to the operator as is). */
export type AdminResult = Readonly<{ ok: true }> | Readonly<{ ok: false; message: string }>

/** One brand image slot on the admin page: what is uploaded there, if anything. */
export type AdminBrandAsset = Readonly<{
	kind: BrandAssetKind
	/** Forum-relative URL of the uploaded image; null shows the built-in one. */
	url: string | null
	type: string | null
	size: number | null
	/** Accepted types and size, for the file picker and its hint. */
	accept: readonly string[]
	maxBytes: number
}>

/** The forum admin page's API; every method acts as a forum admin. */
export interface ForumAdminApi extends RpcTarget {
	categoriesDto(): Promise<readonly AdminCategory[]>
	createCategoryDto(input: AdminCategoryInput): Promise<AdminResult>
	updateCategoryDto(categoryId: string, input: AdminCategoryInput): Promise<AdminResult>
	deleteCategoryDto(categoryId: string): Promise<AdminResult>
	moveCategoryDto(categoryId: string, direction: 'up' | 'down'): Promise<AdminResult>
	usersDto(input: AdminUserQuery): Promise<AdminUserPage>
	setRoleDto(input: AdminRoleChange): Promise<AdminResult>
	brandDto(): Promise<readonly AdminBrandAsset[]>
	/**
	 * Sends one chunk of an image of `total` bytes, in order from offset 0. The last chunk
	 * stores the image; an earlier one answers ok once it is held.
	 */
	uploadBrandDto(
		kind: BrandAssetKind,
		total: number,
		offset: number,
		chunk: Uint8Array,
	): Promise<AdminResult>
	removeBrandDto(kind: BrandAssetKind): Promise<AdminResult>
}

export const ForumCoreWorkbench = workbench.define(import.meta.url, {
	admin: workbench.view<ForumAdminApi>({
		renderer: './ui/admin.tsx',
		placement: {
			kind: 'route',
			path: '/forum',
			title: '论坛管理',
			icon: 'users',
			navigation: { label: '论坛管理' },
			order: 10,
		},
	}),
})
