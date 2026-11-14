import { Button, Input, Label, TextArea, TextField } from '@heroui/react'
import { data, Form, redirect, useNavigation, useRouteLoaderData } from 'react-router'

import type { Route } from './+types/thread-new'
import { ButtonLink, Crumbs, FormError } from '../components/ui'
import { forumApi, orThrow, textField } from '../lib/forum-api.server'
import type { loader as rootLoader } from '../root'

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: `发布主题${loaderData ? ` · ${loaderData.category.name}` : ''} · Pluxel Forum` }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const { category, can } = orThrow(await forumApi.categoryThreads(request, params.slug))
	if (!can.createThread) throw data('你没有在这个版块发布主题的权限。', { status: 403 })
	return { category }
}

export async function action({ request, params }: Route.ActionArgs) {
	const form = await request.formData()
	const title = textField(form, 'title')
	const body = textField(form, 'body')
	// The category comes from the URL, not from the form.
	const { category } = orThrow(await forumApi.categoryThreads(request, params.slug))
	const result = await forumApi.createThread(request, { categoryId: category.id, title, body })
	if (!result.ok) return data({ error: result.error.message }, { status: result.status })
	return redirect(`/t/${result.value.id}`)
}

export default function ThreadNew({ loaderData, actionData }: Route.ComponentProps) {
	const { category } = loaderData
	const limits = useRouteLoaderData<typeof rootLoader>('root')?.meta?.limits
	const submitting = useNavigation().state === 'submitting'
	return (
		<>
			<Crumbs
				items={[
					{ label: '版块', to: '/' },
					{ label: category.name, to: `/c/${category.slug}` },
					{ label: '发布主题' },
				]}
			/>
			<h1 className="mb-4 text-xl font-bold">发布主题</h1>
			<Form method="post" className="flex flex-col gap-4">
				<FormError message={actionData?.error} />
				<TextField name="title" isRequired maxLength={limits?.threadTitleMax} fullWidth>
					<Label>标题</Label>
					<Input autoFocus />
				</TextField>
				<TextField name="body" isRequired maxLength={limits?.postBodyMax} fullWidth>
					<Label>内容</Label>
					<TextArea rows={12} />
				</TextField>
				<div className="flex gap-3">
					<Button type="submit" isPending={submitting}>
						发布
					</Button>
					<ButtonLink to={`/c/${category.slug}`} variant="tertiary" size="md">
						取消
					</ButtonLink>
				</div>
			</Form>
		</>
	)
}
