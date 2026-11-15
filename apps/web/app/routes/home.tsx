import type { CategoryDto, RecentThreadDto } from '@pluxum/domain'
import { FolderPlus, Hash, LayoutList, MessageSquare, MessagesSquare, Plus } from 'lucide-react'
import { useState } from 'react'
import {
	data,
	Form,
	Link,
	redirect,
	useNavigation,
	useRouteLoaderData,
	useSearchParams,
} from 'react-router'

import type { Route } from './+types/home'
import { ThreadFlags } from '../components/forum/rows'
import { Button } from '../components/ui/button'
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
import { keepOnThemeChange } from '../lib/revalidate'
import type { loader as rootLoader } from '../root'

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
			<div
				role="tablist"
				aria-label="首页内容切换"
				className="border-line bg-panel mb-4 grid grid-cols-2 gap-1 rounded-[2px] border p-1 lg:hidden"
			>
				<button
					type="button"
					role="tab"
					aria-selected={mobileTab === 'categories'}
					onClick={() => setMobileTab('categories')}
					className={`h-8 cursor-pointer truncate rounded-[2px] px-2 text-[13px] transition-colors ${
						mobileTab === 'categories'
							? 'bg-selected text-ink-strong font-bold'
							: 'text-ink-weak hover:bg-hover hover:text-ink-strong'
					}`}
				>
					版块分区 ({categories.length})
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={mobileTab === 'recent'}
					onClick={() => setMobileTab('recent')}
					className={`h-8 cursor-pointer truncate rounded-[2px] px-2 text-[13px] transition-colors ${
						mobileTab === 'recent'
							? 'bg-selected text-ink-strong font-bold'
							: 'text-ink-weak hover:bg-hover hover:text-ink-strong'
					}`}
				>
					最新讨论 ({recentThreads.items.length})
				</button>
			</div>

			<div className="grid items-start gap-6 lg:grid-cols-12">
				<div
					className={`min-w-0 lg:col-span-7 xl:col-span-8${mobileTab === 'categories' ? '' : ' max-lg:hidden'}`}
				>
					<PageHeader
						title="版块"
						description="按话题分区浏览，或进入一个版块发起讨论。"
						meta={
							<>
								<span className="tabular-nums">{categories.length} 版块</span>
								<span aria-hidden>·</span>
								<span className="tabular-nums">{totalThreads} 主题</span>
								<span aria-hidden>·</span>
								<span className="tabular-nums">{totalPosts} 帖子</span>
							</>
						}
						actions={
							canManage && !showForm ? (
								<Button tone="secondary" size="sm" onPress={() => setCreating(true)}>
									<Plus aria-hidden />
									新建版块
								</Button>
							) : undefined
						}
					/>
					<SectionLabel>全部版块 · {categories.length}</SectionLabel>
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
						<ul className="grid gap-3 sm:grid-cols-2">
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
					<SectionLabel>最新活跃讨论</SectionLabel>
					{recentThreads.items.length === 0 ? (
						<EmptyState
							icon={MessagesSquare}
							title="还没有讨论"
							hint="版块内发布的主题与最新回复会在这里实时汇总。"
						/>
					) : (
						<Panel as="ul" className="divide-line divide-y">
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

function CategoryCard({ category }: { category: CategoryDto }) {
	return (
		<li className="flex">
			<Panel className="hover:bg-hover active:bg-pressed flex w-full flex-col transition-colors">
				<Link
					to={`/c/${category.slug}`}
					prefetch="intent"
					className="flex flex-1 flex-col justify-between gap-3 p-4"
				>
					<div className="flex flex-col gap-2">
						<div className="flex items-center gap-2.5">
							<span
								aria-hidden
								className="bg-control text-ink-weak flex size-8 shrink-0 items-center justify-center rounded-[2px]"
							>
								<Hash size={15} />
							</span>
							<span className="text-ink-strong min-w-0 flex-1 truncate text-[14px] font-bold">
								{category.name}
							</span>
						</div>
						{category.description !== '' ? (
							<p className="text-ink-weak line-clamp-2 break-words">{category.description}</p>
						) : (
							<p className="text-ink-weak text-[12px]">进入版块浏览讨论与发布新主题</p>
						)}
					</div>
					<div className="border-line text-ink-weak flex items-center justify-between border-t pt-2.5 text-[12px] tabular-nums">
						<span>
							{category.threadCount} 主题 · {category.postCount} 帖子
						</span>
						<span className="text-ink">进入 →</span>
					</div>
				</Link>
			</Panel>
		</li>
	)
}

function RecentThreadItem({ item }: { item: RecentThreadDto }) {
	return (
		<li className="hover:bg-hover relative flex flex-col gap-1.5 px-4 py-3 transition-colors">
			<div className="flex flex-wrap items-center gap-1.5">
				<Link
					to={`/c/${item.category.slug}`}
					prefetch="intent"
					className="bg-control text-ink-weak hover:text-ink-strong relative z-10 inline-flex h-5 shrink-0 items-center gap-1 rounded-[2px] px-1.5 text-[12px] leading-none whitespace-nowrap"
				>
					<Hash aria-hidden size={11} />
					{item.category.name}
				</Link>
				<ThreadFlags thread={item} />
			</div>
			<Link
				to={`/c/${item.category.slug}/t/${item.id}`}
				prefetch="intent"
				className="text-ink-strong text-[13px] font-bold break-words after:absolute after:inset-0"
			>
				{item.title}
			</Link>
			<div className="text-ink-weak flex items-center justify-between gap-2 text-[12px]">
				<span className="flex min-w-0 items-center gap-1.5">
					<Link
						to={`/u/${item.author.id}`}
						className="text-ink relative z-10 truncate hover:underline"
					>
						{item.author.displayName}
					</Link>
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
