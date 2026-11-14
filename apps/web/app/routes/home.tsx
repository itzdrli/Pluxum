import { Button, Input, Label, TextField } from '@heroui/react'
import { data, Form, Link, redirect, useNavigation, useRouteLoaderData } from 'react-router'

import type { Route } from './+types/home'
import { FormError } from '../components/ui'
import { forumApi, orThrow, textField } from '../lib/forum-api.server'
import type { loader as rootLoader } from '../root'

export function meta(): Route.MetaDescriptors {
	return [{ title: 'Pluxel Forum' }, { name: 'description', content: '万物皆插件的论坛' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	return { categories: orThrow(await forumApi.categories(request)).items }
}

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
	return (
		<>
			<h1 className="mb-4 text-xl font-bold">版块</h1>
			{categories.length === 0 ? (
				<p className="border-border text-muted rounded-xl border px-5 py-10 text-center text-sm">
					还没有版块。{canManage ? '在下面创建第一个。' : ''}
				</p>
			) : (
				<ul className="border-border bg-surface divide-border divide-y rounded-xl border">
					{categories.map((category) => (
						<li key={category.id} className="flex items-center gap-4 px-5 py-4">
							<div className="min-w-0 flex-1">
								<Link
									to={`/c/${category.slug}`}
									className="hover:text-accent font-semibold break-words"
								>
									{category.name}
								</Link>
								{category.description !== '' && (
									<p className="text-muted mt-1 text-sm break-words">{category.description}</p>
								)}
							</div>
							<dl className="text-muted flex shrink-0 gap-5 text-right text-xs">
								<div>
									<dd className="text-foreground text-sm tabular-nums">{category.threadCount}</dd>
									<dt>主题</dt>
								</div>
								<div>
									<dd className="text-foreground text-sm tabular-nums">{category.postCount}</dd>
									<dt>帖子</dt>
								</div>
							</dl>
						</li>
					))}
				</ul>
			)}
			{canManage && (
				<NewCategory error={actionData?.error} nameMax={root?.meta?.limits.categoryNameMax} />
			)}
		</>
	)
}

function NewCategory({
	error,
	nameMax,
}: {
	error: string | undefined
	nameMax: number | undefined
}) {
	const submitting = useNavigation().state === 'submitting'
	return (
		<details className="border-border mt-6 rounded-xl border" open={error !== undefined}>
			<summary className="cursor-pointer px-5 py-3 text-sm font-semibold">新建版块</summary>
			<Form method="post" className="flex flex-col gap-4 px-5 pb-5">
				<FormError message={error} />
				<div className="grid gap-4 sm:grid-cols-2">
					<TextField name="name" isRequired maxLength={nameMax}>
						<Label>名称</Label>
						<Input placeholder="综合讨论" />
					</TextField>
					<TextField name="slug">
						<Label>标识（用在网址里）</Label>
						<Input placeholder="general" pattern="[a-z0-9]+(-[a-z0-9]+)*" />
					</TextField>
				</div>
				<TextField name="description">
					<Label>简介</Label>
					<Input />
				</TextField>
				<div>
					<Button type="submit" size="sm" isPending={submitting}>
						创建版块
					</Button>
				</div>
			</Form>
		</details>
	)
}
