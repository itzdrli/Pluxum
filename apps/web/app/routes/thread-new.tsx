import { Send, X } from 'lucide-react'
import { data, Form, redirect, useNavigation, useRouteLoaderData } from 'react-router'

import type { Route } from './+types/thread-new'
import { Composer } from '../components/composer/composer'
import { Button, ButtonLink } from '../components/ui/button'
import { Crumbs, FormError, PageHeader, Panel } from '../components/ui/display'
import { TextInputField } from '../components/ui/field'
import { forumApi, orThrow, textField } from '../lib/forum-api.server'
import { keepOnThemeChange } from '../lib/revalidate'
import type { loader as rootLoader } from '../root'

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: `发布主题${loaderData ? ` · ${loaderData.category.name}` : ''} · Pluxum` }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const { category, can } = orThrow(await forumApi.categoryThreads(request, params.slug))
	if (!can.createThread) throw data('你没有在这个版块发布主题的权限。', { status: 403 })
	return { category }
}

export const shouldRevalidate = keepOnThemeChange

export async function action({ request, params }: Route.ActionArgs) {
	const form = await request.formData()
	const title = textField(form, 'title')
	const body = textField(form, 'body')
	// The category comes from the URL, not from the form.
	const { category } = orThrow(await forumApi.categoryThreads(request, params.slug))
	const result = await forumApi.createThread(request, { categoryId: category.id, title, body })
	if (!result.ok) return data({ error: result.error.message }, { status: result.status })
	return redirect(`/c/${category.slug}/t/${result.value.id}`)
}

export default function ThreadNew({ loaderData, actionData }: Route.ComponentProps) {
	const { category } = loaderData
	const limits = useRouteLoaderData<typeof rootLoader>('root')?.meta?.limits
	const submitting = useNavigation().state === 'submitting'
	return (
		<div className="mx-auto max-w-[860px]">
			<Crumbs
				items={[
					{ label: '版块', to: '/' },
					{ label: category.name, to: `/c/${category.slug}` },
					{ label: '发布主题' },
				]}
			/>
			<PageHeader
				title="发布主题"
				description={`发布到「${category.name}」`}
				actions={
					<ButtonLink
						to={`/c/${category.slug}`}
						tone="ghost"
						size="sm"
						aria-label="关闭发布主题"
						title="关闭发布主题"
						className="button--icon-only"
					>
						<X aria-hidden />
					</ButtonLink>
				}
			/>
			<Panel as="section" className="p-4">
				<Form method="post" className="flex flex-col gap-4">
					<FormError message={actionData?.error} />
					<TextInputField
						name="title"
						label="标题"
						required
						maxLength={limits?.threadTitleMax}
						placeholder="一句话说清楚要讨论什么"
						autoFocus
					/>
					<Composer label="内容" required maxLength={limits?.postBodyMax} rows={12} />
					<div className="flex justify-end gap-2">
						<ButtonLink to={`/c/${category.slug}`} tone="ghost">
							取消
						</ButtonLink>
						<Button type="submit" tone="primary" isPending={submitting}>
							<Send aria-hidden />
							发布
						</Button>
					</div>
				</Form>
			</Panel>
		</div>
	)
}
