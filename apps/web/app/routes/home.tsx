import type { CategoryDto, RecentThreadDto } from '@pluxum/domain'
import { LayoutList, MessageSquare, MessagesSquare, Plus } from 'lucide-react'
import { useState } from 'react'
import {
	data,
	Form,
	redirect,
	useNavigation,
	useRouteLoaderData,
	useSearchParams,
} from 'react-router'

import type { Route } from './+types/home'
import { ThreadFlags } from '../components/forum/rows'
import { StageLink } from '../components/stage/stage'
import { Button, IconButton } from '../components/ui/button'
import {
	EmptyState,
	FormError,
	PageHeader,
	Panel,
	SectionLabel,
	Timestamp,
} from '../components/ui/display'
import { TextInputField } from '../components/ui/field'
import { forumApi, orThrow, textField } from '../lib/forum-api.server'
import { defineStage } from '../lib/stage'
import type { loader as rootLoader } from '../root'

export const handle = defineStage({ layer: 'page', wide: true })

export function meta(): Route.MetaDescriptors {
	return [{ title: 'Pluxum' }, { name: 'description', content: '万物皆插件的论坛' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	const [categoriesResult, recentResult] = await Promise.all([
		forumApi.categories(request),
		forumApi.recentThreads(request, 1, 12),
	])
	return {
		categories: orThrow(categoriesResult).items,
		recentThreads: orThrow(recentResult),
	}
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
	const { categories, recentThreads } = loaderData
	const root = useRouteLoaderData<typeof rootLoader>('root')
	const canManage = root?.meta?.viewer.can.manageCategories === true
	const [searchParams, setSearchParams] = useSearchParams()
	const requestedNew = searchParams.get('new') === '1'
	// Open while creating, via `?new=1`, or when the API rejected the last attempt.
	const [mobileTab, setMobileTab] = useState<'categories' | 'recent'>('categories')
	const [creating, setCreating] = useState(false)
	const showForm = canManage && (creating || requestedNew || actionData?.error !== undefined)

	const totalThreads = categories.reduce((sum, cat) => sum + cat.threadCount, 0)
	const totalPosts = categories.reduce((sum, cat) => sum + cat.postCount, 0)

	const closeForm = () => {
		setCreating(false)
		if (requestedNew) {
			const next = new URLSearchParams(searchParams)
			next.delete('new')
			setSearchParams(next, { replace: true })
		}
	}

	return (
		<>
			{/* Phones: two tabs instead of two columns; the page title would only repeat them. */}
			<div className="border-line -mx-4 flex items-center gap-5 border-b px-4 lg:hidden">
				<div role="tablist" aria-label="首页内容切换" className="flex items-center gap-5">
					<HomeTab
						selected={mobileTab === 'categories'}
						onSelect={() => setMobileTab('categories')}
					>
						版块
					</HomeTab>
					<HomeTab selected={mobileTab === 'recent'} onSelect={() => setMobileTab('recent')}>
						最新
					</HomeTab>
				</div>
				{canManage && !showForm && (
					<IconButton
						label="新建版块"
						className="ml-auto"
						onPress={() => {
							setMobileTab('categories')
							setCreating(true)
						}}
					>
						<Plus aria-hidden />
					</IconButton>
				)}
			</div>

			<div className="grid items-start gap-6 sm:max-lg:mt-4 lg:grid-cols-12">
				<div
					className={`min-w-0 lg:col-span-7 xl:col-span-8${mobileTab === 'categories' ? '' : ' max-lg:hidden'}`}
				>
					<div className="max-lg:hidden">
						<PageHeader
							title="版块"
							meta={
								<span className="tabular-nums">
									{categories.length} 版块 · {totalThreads} 主题 · {totalPosts} 帖子
								</span>
							}
							actions={
								canManage && !showForm ? (
									<Button size="sm" onPress={() => setCreating(true)}>
										新建版块
									</Button>
								) : undefined
							}
						/>
					</div>
					{showForm && (
						<NewCategory
							error={actionData?.error}
							nameMax={root?.meta?.limits.categoryNameMax}
							onCancel={closeForm}
						/>
					)}
					{categories.length === 0 ? (
						<EmptyState
							icon={LayoutList}
							title="还没有版块"
							hint={
								canManage
									? '新建第一个版块后，成员就可以在里面发布主题。'
									: '管理员还没有创建版块。'
							}
						/>
					) : (
						<ul className="max-sm:border-line max-sm:bg-panel max-sm:divide-line grid gap-3 max-sm:-mx-4 max-sm:gap-0 max-sm:divide-y max-sm:border-b sm:grid-cols-2">
							{categories.map((category) => (
								<CategoryCard key={category.id} category={category} />
							))}
						</ul>
					)}
				</div>

				<aside
					aria-label="最新活跃讨论"
					className={`min-w-0 lg:sticky lg:top-16 lg:col-span-5 xl:col-span-4${mobileTab === 'recent' ? '' : ' max-lg:hidden'}`}
				>
					<div className="max-lg:hidden">
						<SectionLabel>最新活跃讨论</SectionLabel>
					</div>
					{recentThreads.items.length === 0 ? (
						<EmptyState
							icon={MessagesSquare}
							title="还没有讨论"
							hint="版块内发布的主题与最新回复会在这里实时汇总。"
						/>
					) : (
						<Panel
							as="ul"
							className="divide-line divide-y max-sm:-mx-4 max-sm:rounded-none max-sm:border-x-0 max-sm:border-t-0"
						>
							{recentThreads.items.map((item) => (
								<RecentThreadItem key={item.id} item={item} />
							))}
						</Panel>
					)}
				</aside>
			</div>
		</>
	)
}

function HomeTab({
	selected,
	onSelect,
	children,
}: {
	selected: boolean
	onSelect: () => void
	children: React.ReactNode
}) {
	return (
		<button
			type="button"
			role="tab"
			aria-selected={selected}
			onClick={onSelect}
			className={`h-control -mb-px cursor-pointer border-b-2 text-ui transition-colors ${
				selected
					? 'border-accent text-ink-strong font-bold'
					: 'text-ink-weak hover:text-ink-strong border-transparent'
			}`}
		>
			{children}
		</button>
	)
}

/** A category: a card in the grid, a plain row of the edge-to-edge list on phones. */
function CategoryCard({ category }: { category: CategoryDto }) {
	return (
		<li className="flex">
			<StageLink
				to={`/c/${category.slug}`}
				prefetch="intent"
				className="sm:border-line sm:bg-panel hover:bg-hover active:bg-pressed flex w-full flex-col gap-1 px-4 py-3 transition-colors sm:rounded-[2px] sm:border sm:py-3.5"
			>
				<span className="flex items-baseline justify-between gap-3">
					<span className="text-ink-strong min-w-0 truncate text-title font-bold">
						{category.name}
					</span>
					<span className="text-ink-weak shrink-0 text-meta tabular-nums">
						{category.threadCount} 主题
						<span className="max-sm:hidden"> · {category.postCount} 帖子</span>
					</span>
				</span>
				{category.description !== '' && (
					<span className="text-ink-weak line-clamp-1 break-words sm:line-clamp-2">
						{category.description}
					</span>
				)}
			</StageLink>
		</li>
	)
}

function RecentThreadItem({ item }: { item: RecentThreadDto }) {
	return (
		<li className="hover:bg-hover relative flex flex-col gap-1.5 px-4 py-3 transition-colors">
			<div className="flex flex-wrap items-center gap-1.5">
				<StageLink
					to={`/c/${item.category.slug}`}
					prefetch="intent"
					className="bg-control text-ink-weak hover:text-ink-strong relative z-10 inline-flex h-5 shrink-0 items-center rounded-[2px] px-1.5 text-meta leading-none whitespace-nowrap"
				>
					{item.category.name}
				</StageLink>
				<ThreadFlags thread={item} />
			</div>
			<StageLink
				to={`/c/${item.category.slug}/t/${item.ref}`}
				prefetch="intent"
				className="text-ink-strong text-ui font-bold break-words after:absolute after:inset-0"
			>
				{item.title}
			</StageLink>
			<div className="text-ink-weak flex items-center justify-between gap-2 text-meta">
				<span className="flex min-w-0 items-center gap-1.5">
					<StageLink
						to={`/u/${item.author.handle}`}
						className="text-ink relative z-10 truncate hover:underline"
					>
						{item.author.displayName}
					</StageLink>
					<span aria-hidden>·</span>
					<Timestamp iso={item.lastPostAt} />
				</span>
				<span className="flex shrink-0 items-center gap-1 tabular-nums">
					<MessageSquare aria-hidden size={12} />
					{item.replyCount}
				</span>
			</div>
		</li>
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
			<h3 className="text-ink-strong mb-3 font-bold">新建版块</h3>
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
