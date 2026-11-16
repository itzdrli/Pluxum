import type { RpcTarget } from 'capnweb'
import { workbench } from '@pluxel/workbench'

/** A category as the admin page lists it. */
export type AdminCategory = Readonly<{
	id: string
	slug: string
	name: string
	description: string
	position: number
	threadCount: number
	postCount: number
}>

export type AdminCategoryInput = Readonly<{
	name: string
	/** Empty: derived from the name. */
	slug: string
	description: string
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

/** The forum admin page's API; every method acts as a forum admin. */
export interface ForumAdminApi extends RpcTarget {
	categoriesDto(): Promise<readonly AdminCategory[]>
	createCategoryDto(input: AdminCategoryInput): Promise<AdminResult>
	updateCategoryDto(categoryId: string, input: AdminCategoryInput): Promise<AdminResult>
	deleteCategoryDto(categoryId: string): Promise<AdminResult>
	moveCategoryDto(categoryId: string, direction: 'up' | 'down'): Promise<AdminResult>
	usersDto(input: AdminUserQuery): Promise<AdminUserPage>
	setRoleDto(input: AdminRoleChange): Promise<AdminResult>
}

export const ForumCoreWorkbench = workbench.define({
	admin: workbench.view<ForumAdminApi>({
		renderer: workbench.entry(import.meta.url, './ui/admin.tsx'),
		placement: workbench.route('/forum', {
			title: '论坛管理',
			icon: workbench.icons.Users,
			navigation: { label: '论坛管理' },
			order: 10,
		}),
	}),
})
