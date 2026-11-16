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
import { UserAvatar } from '../components/forum/user-avatar'
import { StageLink } from '../components/stage/stage'
import { Button, IconButton } from '../components/ui/button'
import {
	EmptyState,
	FormError,
	Panel,
	SectionLabel,
	Tag,
	Timestamp,
} from '../components/ui/display'
import { TextInputField } from '../components/ui/field'
import { forumApi, orThrow, textField } from '../lib/forum-api.server'
import { defineStage } from '../lib/stage'
import type { loader as rootLoader } from '../root'
import { siteOf } from '../lib/site'

export const handle = defineStage({ layer: 'page', nav: true })

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	const site = siteOf(matches[0].loaderData)
	return [{ title: site.name }, { name: 'description', content: site.description }]
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
	const [mobileTab, setMobileTab] = useState<'categories' | 'recent'>('recent')
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
					<HomeTab selected={mobileTab === 'recent'} onSelect={() => setMobileTab('recent')}>
						最新
					</HomeTab>
					<HomeTab
						selected={mobileTab === 'categories'}
						onSelect={() => setMobileTab('categories')}
					>
						版块
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

			{showForm && (
				<div className="lg:mx-auto lg:max-w-[880px]">
					<NewCategory
						error={actionData?.error}
						nameMax={root?.meta?.limits.categoryNameMax}
						onCancel={closeForm}
					/>
				</div>
			)}

			{/* Wide screens: one feed; the categories are the column beside it. Phones have no such
			    column, so the categories are the second tab. */}
			<div className="sm:max-lg:mt-4 lg:mx-auto lg:max-w-[880px]">
				<section
					aria-label="最新活跃讨论"
					className={mobileTab === 'recent' ? '' : 'max-lg:hidden'}
				>
					<div className="max-lg:hidden">
						<SectionLabel
							actions={
								<span className="text-ink-weak text-meta tabular-nums">
									{categories.length} 版块 · {totalThreads} 主题 · {totalPosts} 帖子
								</span>
							}
						>
							最新活跃讨论
						</SectionLabel>
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
				</section>

				<section aria-label="版块" className={mobileTab === 'categories' ? 'lg:hidden' : 'hidden'}>
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
						<Panel
							as="ul"
							className="divide-line divide-y max-sm:-mx-4 max-sm:rounded-none max-sm:border-x-0 max-sm:border-t-0"
						>
							{categories.map((category) => (
								<CategoryItem key={category.id} category={category} />
							))}
						</Panel>
					)}
				</section>
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

/** A category in the phone tab: tile, name with its one-line description, and its thread count. */
function CategoryItem({ category }: { category: CategoryDto }) {
	return (
		<li>
			<StageLink
				to={`/c/${category.slug}`}
				prefetch="intent"
				title={`${category.threadCount} 主题 · ${category.postCount} 帖子`}
				className="hover:bg-hover active:bg-pressed flex items-center gap-3 px-3 py-2.5 transition-colors"
			>
				{/* The name's first character on the control tone: told apart at a glance, no extra hue. */}
				<span
					aria-hidden
					className="bg-control text-ink-strong flex size-8 shrink-0 items-center justify-center rounded-[2px] font-bold select-none"
				>
					{Array.from(category.name)[0] ?? '#'}
				</span>
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="text-ink-strong truncate font-bold">{category.name}</span>
					{category.description !== '' && (
						<span className="text-ink-weak truncate text-meta">{category.description}</span>
					)}
				</span>
				<span className="text-ink-weak flex shrink-0 items-center gap-1 text-meta tabular-nums">
					<MessagesSquare aria-hidden size={12} />
					{category.threadCount}
					<span className="sr-only"> 主题</span>
				</span>
			</StageLink>
		</li>
	)
}

function RecentThreadItem({ item }: { item: RecentThreadDto }) {
	return (
		<li className="hover:bg-hover relative flex items-start gap-3 px-4 py-3 transition-colors">
			<span className="mt-0.5 shrink-0">
				<UserAvatar user={item.author} />
			</span>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
					<ThreadFlags thread={item} />
					<StageLink
						to={`/c/${item.category.slug}/t/${item.ref}`}
						prefetch="intent"
						className="text-ink-strong text-ui font-bold break-words after:absolute after:inset-0"
					>
						{item.title}
					</StageLink>
				</div>
				<div className="text-ink-weak flex min-w-0 items-center gap-1.5 text-meta">
					<StageLink
						to={`/u/${item.author.handle}`}
						className="text-ink relative z-10 truncate hover:underline"
					>
						{item.author.displayName}
					</StageLink>
					<span aria-hidden>·</span>
					<Timestamp iso={item.lastPostAt} />
				</div>
			</div>
			{/* Chips: the category (its own link, above the row's) and the reply count. */}
			<div className="flex shrink-0 flex-col items-end gap-1">
				<StageLink
					to={`/c/${item.category.slug}`}
					prefetch="intent"
					className="relative z-10 max-w-28"
				>
					<Tag>
						<span className="truncate">{item.category.name}</span>
					</Tag>
				</StageLink>
				<Tag tone={item.replyCount > 0 ? 'accent' : 'neutral'} icon={MessageSquare}>
					<span className="tabular-nums">{item.replyCount}</span>
					<span className="sr-only"> 回复</span>
				</Tag>
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
				<div className="grid gap-3">
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
