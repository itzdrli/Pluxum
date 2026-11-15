import { FolderPlus, LayoutList, Plus } from 'lucide-react'
import { useState } from 'react'
import { data, Form, redirect, useNavigation, useRouteLoaderData } from 'react-router'

import type { Route } from './+types/home'
import { CategoryRow } from '../components/forum/rows'
import { Button } from '../components/ui/button'
import { EmptyState, FormError, PageHeader, Panel, SectionLabel } from '../components/ui/display'
import { TextInputField } from '../components/ui/field'
import { forumApi, orThrow, textField } from '../lib/forum-api.server'
import { keepOnThemeChange } from '../lib/revalidate'
import type { loader as rootLoader } from '../root'

export function meta(): Route.MetaDescriptors {
	return [{ title: 'Pluxel Forum' }, { name: 'description', content: '万物皆插件的论坛' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	return { categories: orThrow(await forumApi.categories(request)).items }
}

export const shouldRevalidate = keepOnThemeChange

// Creates a category; the API decides whether the visitor may.
export async function action({ request }: Route.ActionArgs) {
	const form = await request.formData()
	const slug = textField(form, 'slug').trim()
	const result = await forumApi.createCategory(request, {
		name: textField(form, 'name'),
		// Left empty, the API derives the slug from the name.
		slug: slug === '' ? undefined : slug,
		description: textField(form, 'description'),
	})
	if (!result.ok) return data({ error: result.error.message }, { status: result.status })
	return redirect(`/c/${result.value.slug}`)
}

export default function Home({ loaderData, actionData }: Route.ComponentProps) {
	const { categories } = loaderData
	const root = useRouteLoaderData<typeof rootLoader>('root')
	const canManage = root?.meta?.viewer.can.manageCategories === true
	// Open while creating, and again when the API rejected the last attempt.
	const [creating, setCreating] = useState(false)
	const showForm = canManage && (creating || actionData?.error !== undefined)
	return (
		<>
			<PageHeader title="版块" description="按话题分区浏览，或进入一个版块发起讨论。" />
			<SectionLabel
				actions={
					canManage &&
					!showForm && (
						<Button tone="ghost" size="sm" onPress={() => setCreating(true)}>
							<Plus aria-hidden />
							新建版块
						</Button>
					)
				}
			>
				全部版块 · {categories.length}
			</SectionLabel>
			{showForm && (
				<NewCategory
					error={actionData?.error}
					nameMax={root?.meta?.limits.categoryNameMax}
					onCancel={() => setCreating(false)}
				/>
			)}
			{categories.length === 0 ? (
				<EmptyState
					icon={LayoutList}
					title="还没有版块"
					hint={
						canManage ? '新建第一个版块后，成员就可以在里面发布主题。' : '管理员还没有创建版块。'
					}
				/>
			) : (
				<Panel as="ul" className="divide-line divide-y">
					{categories.map((category) => (
						<CategoryRow key={category.id} category={category} />
					))}
				</Panel>
			)}
		</>
	)
}

function NewCategory({
	error,
	nameMax,
	onCancel,
}: {
	error: string | undefined
	nameMax: number | undefined
	onCancel: () => void
}) {
	const submitting = useNavigation().state === 'submitting'
	return (
		<Panel as="section" className="mb-4 p-4">
			<h3 className="text-ink-strong mb-3 flex items-center gap-2 font-bold">
				<FolderPlus aria-hidden size={16} className="text-ink-weak" />
				新建版块
			</h3>
			<Form method="post" className="flex flex-col gap-3">
				<FormError message={error} />
				<div className="grid gap-3 sm:grid-cols-2">
					<TextInputField
						name="name"
						label="名称"
						required
						maxLength={nameMax}
						placeholder="综合讨论"
						autoFocus
					/>
					<TextInputField
						name="slug"
						label="标识"
						hint="用在网址里，小写字母、数字和连字符；留空则按名称生成。"
						placeholder="general"
						pattern="[a-z0-9]+(-[a-z0-9]+)*"
					/>
				</div>
				<TextInputField name="description" label="简介" />
				<div className="flex justify-end gap-2">
					<Button tone="ghost" onPress={onCancel}>
						取消
					</Button>
					<Button tone="primary" type="submit" isPending={submitting}>
						创建版块
					</Button>
				</div>
			</Form>
		</Panel>
	)
}
