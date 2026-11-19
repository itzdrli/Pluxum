import type { CategoryDto, CommunityDto, UserDto } from '@pluxum/domain'
import { Dropdown } from '@heroui/react'
import { LayoutList, MessagesSquare, Plus } from 'lucide-react'
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
import { NoteCard, NoteComposer } from '../components/forum/note-card'
import { ThreadRow } from '../components/forum/rows'
import { UserAvatar } from '../components/forum/user-avatar'
import { useDock } from '../components/dock/composer-dock'
import { StageLink } from '../components/stage/stage'
import { Button, IconButton } from '../components/ui/button'
import { EmptyState, FormError, Panel, TabIndicator } from '../components/ui/display'
import { Pager } from '../components/ui/pager'
import { TextInputField } from '../components/ui/field'
import { forumApi, orThrow, pageParam, textField } from '../lib/forum-api.server'
import { HOME_PAGE_SIZE, HOME_SORTS, homeSortOf, type HomeSort } from '../lib/home'
import { defineStage } from '../lib/stage'
import { withViewTransition } from '../lib/view-transition'
import type { loader as rootLoader } from '../root'
import { siteOf } from '../lib/site'

export const handle = defineStage({ layer: 'page', nav: true, wide: true })

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	const site = siteOf(matches[0].loaderData)
	return [{ title: site.name }, { name: 'description', content: site.description }]
}

export async function loader({ request }: Route.LoaderArgs) {
	const sort = homeSortOf(new URL(request.url))
	const [categoriesResult, recentResult, communityResult] = await Promise.all([
		forumApi.categories(request),
		forumApi.recentThreads(request, pageParam(request), HOME_PAGE_SIZE, sort),
		forumApi.community(request),
	])
	return {
		categories: orThrow(categoriesResult).items,
		recentThreads: orThrow(recentResult),
		// A side panel: the feed is served without it when it cannot be had.
		community: communityResult.ok ? communityResult.value : null,
		sort,
	}
}

// Posts a note (`intent=note`) or creates a category; the API decides whether the visitor may.
export async function action({ request }: Route.ActionArgs) {
	const form = await request.formData()
	if (textField(form, 'intent') === 'note') {
		const stream = orThrow(await forumApi.meta(request)).stream
		if (stream === null) return data({ noteError: '动态暂时不可用。' }, { status: 404 })
		const result = await forumApi.createThread(request, {
			categoryId: stream.id,
			title: '',
			body: textField(form, 'body'),
		})
		if (!result.ok) return data({ noteError: result.error.message }, { status: result.status })
		return { posted: result.value.id }
	}
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
	const { categories, recentThreads, community, sort } = loaderData
	const root = useRouteLoaderData<typeof rootLoader>('root')
	const canManage = root?.meta?.viewer.can.manageCategories === true
	const signedIn = root?.meta?.viewer.user != null
	const [searchParams, setSearchParams] = useSearchParams()
	const requestedNew = searchParams.get('new') === '1'
	// Open while creating, via `?new=1`, or when the API rejected the last attempt.
	const [mobileTab, setMobileTab] = useState<'categories' | 'recent'>('recent')
	const [creating, setCreating] = useState(false)
	const categoryError =
		actionData !== undefined && 'error' in actionData ? actionData.error : undefined
	const showForm = canManage && (creating || requestedNew || categoryError !== undefined)
	const canPostNote = root?.meta?.viewer.can.postNote === true

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
					{/* Not 「最新」: that is also one of the feed's orderings right below. */}
					<HomeTab
						selected={mobileTab === 'recent'}
						onSelect={() => withViewTransition(() => setMobileTab('recent'))}
					>
						讨论
					</HomeTab>
					<HomeTab
						selected={mobileTab === 'categories'}
						onSelect={() => withViewTransition(() => setMobileTab('categories'))}
					>
						版块
					</HomeTab>
				</div>
				{/* Only beside the categories, so it is never mistaken for 「发布主题」 under the feed tab. */}
				{canManage && !showForm && mobileTab === 'categories' && (
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

			{/* Wide screens: one feed; the categories are the column beside it. Phones have no such
			    column, so the categories are the second tab. */}
			<div className="max-lg:mt-3 lg:mx-auto lg:max-w-[880px] xl:grid xl:max-w-none xl:grid-cols-[minmax(0,1fr)_280px] xl:items-start xl:gap-6 2xl:grid-cols-[minmax(0,1fr)_320px] 2xl:gap-8">
				<div className="min-w-0">
					{/* Wide screens: the pane's head, with the overview's title; phones: the feed's sort row.
					    Above both sections so the new-category form opens under it, not above it. */}
					<div
						className={`mb-5 flex items-center justify-between gap-3 lg:pane-bar ${
							mobileTab === 'recent' ? '' : 'max-lg:hidden'
						}`}
					>
						<h1 className="text-ink-strong mr-4 text-heading font-bold max-lg:hidden">概览</h1>
						<SortTabs sort={sort} />
						<div className="flex items-center gap-3 lg:ml-auto">
							<span className="text-ink-weak text-meta tabular-nums max-lg:hidden xl:hidden">
								{categories.length} 版块 · {totalThreads} 主题 · {totalPosts} 帖子
							</span>
							{signedIn && <NewThreadMenu categories={categories} />}
						</div>
					</div>
					{showForm && (
						<NewCategory
							error={categoryError}
							nameMax={root?.meta?.limits.categoryNameMax}
							onCancel={closeForm}
						/>
					)}
					<section
						aria-label="最新活跃讨论"
						className={mobileTab === 'recent' ? '' : 'max-lg:hidden'}
					>
						{!signedIn && <GuestWelcome root={root} />}
						{canPostNote && (
							<NoteComposer
								max={root?.meta?.limits.noteBodyMax}
								error={
									actionData !== undefined && 'noteError' in actionData
										? actionData.noteError
										: undefined
								}
								resetKey={
									actionData !== undefined && 'posted' in actionData ? actionData.posted : ''
								}
							/>
						)}
						{recentThreads.items.length === 0 ? (
							<EmptyState icon={MessagesSquare} title="还没有讨论" />
						) : (
							// The same rows as a category's list; the overview's mix of categories shows each row's.
							<div className="@container/threads">
								<Panel
									as="ul"
									className="divide-line divide-y max-sm:-mx-4 max-sm:rounded-none max-sm:border-x-0 max-sm:border-t-0"
								>
									{recentThreads.items.map((item) =>
										item.kind === 'note' ? (
											<NoteCard
												key={item.id}
												thread={item}
												href={`/c/${item.category.slug}/t/${item.ref}`}
											/>
										) : (
											<ThreadRow
												key={item.id}
												thread={item}
												href={`/c/${item.category.slug}/t/${item.ref}`}
												category={item.category}
												time={sort === 'new' ? 'created' : 'last'}
											/>
										),
									)}
								</Panel>
							</div>
						)}
						<Pager
							page={recentThreads.page}
							pageSize={recentThreads.pageSize}
							total={recentThreads.total}
						/>
					</section>

					<section
						aria-label="版块"
						className={mobileTab === 'categories' ? 'lg:hidden' : 'hidden'}
					>
						{categories.length === 0 ? (
							<EmptyState icon={LayoutList} title="还没有版块" />
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
				{community !== null && (
					<CommunityPanel community={community} threads={totalThreads} posts={totalPosts} />
				)}
			</div>
		</>
	)
}

/**
 * Who is around, beside the feed on wide screens: the numbers, the most active members of the
 * last days and the newest ones. Phones and narrow windows do without it.
 */
function CommunityPanel({
	community,
	threads,
	posts,
}: {
	community: CommunityDto
	threads: number
	posts: number
}) {
	return (
		// Above the feed's pane head, whose band runs under this column: the heading sits in that band.
		<aside aria-label="社区" className="min-w-0 max-xl:hidden xl:sticky xl:top-0 xl:z-20">
			<h2 className="section-label mb-5 flex h-[var(--h-pane-bar)] items-center">社区</h2>
			<Panel className="flex flex-col divide-y divide-line">
				<dl className="grid grid-cols-3 gap-2 px-4 py-4 text-center">
					{[
						['成员', community.members],
						['主题', threads],
						['帖子', posts],
					].map(([label, value]) => (
						<div key={label}>
							<dd className="text-ink-strong text-heading font-bold tabular-nums">{value}</dd>
							<dt className="text-ink-weak text-meta">{label}</dt>
						</div>
					))}
				</dl>
				{community.activeMembers.length > 0 && (
					<MemberList title={`近 ${community.days} 天活跃`}>
						{community.activeMembers.map(({ user, posts: total }) => (
							<MemberRow key={user.id} user={user} note={`${total} 帖`} />
						))}
					</MemberList>
				)}
				{community.newMembers.length > 0 && (
					<MemberList title="新加入">
						{community.newMembers.map((user) => (
							<MemberRow key={user.id} user={user} />
						))}
					</MemberList>
				)}
			</Panel>
		</aside>
	)
}

function MemberList({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<section className="px-3 py-3">
			<h3 className="text-ink-weak px-2 pb-1 text-meta">{title}</h3>
			<ul>{children}</ul>
		</section>
	)
}

function MemberRow({ user, note }: { user: UserDto; note?: string }) {
	return (
		<li>
			<StageLink
				to={`/u/${user.handle}`}
				prefetch="intent"
				className="hover:bg-hover flex items-center gap-3 rounded-[2px] px-2 py-2"
			>
				<UserAvatar user={user} size="sm" />
				<span className="text-ink min-w-0 flex-1 truncate">{user.displayName}</span>
				{note !== undefined && (
					<span className="text-ink-weak shrink-0 text-meta tabular-nums">{note}</span>
				)}
			</StageLink>
		</li>
	)
}

/** The feed's orderings: links, so each is a URL of its own. `active` is the bare page. */
function SortTabs({ sort }: { sort: HomeSort }) {
	return (
		<nav aria-label="排序" className="flex items-center gap-4">
			{HOME_SORTS.map((item) => (
				<StageLink
					key={item.id}
					to={item.id === 'active' ? '/' : `/?sort=${item.id}`}
					replace
					aria-current={item.id === sort ? 'page' : undefined}
					className={`h-control relative -mb-px inline-flex items-center text-ui transition-colors max-lg:-mx-1 max-lg:px-1 lg:h-[var(--h-pane-bar)] ${
						item.id === sort ? 'text-ink-strong font-bold' : 'text-ink-weak hover:text-ink-strong'
					}`}
				>
					{item.label}
					{item.id === sort && <TabIndicator name="sort-tab" />}
				</StageLink>
			))}
		</nav>
	)
}

/** "发布主题" from the overview: pick the category, then write in its new-thread pane. */
function NewThreadMenu({ categories }: { categories: readonly CategoryDto[] }) {
	const dock = useDock()
	if (categories.length === 0) return null
	return (
		<Dropdown>
			<Dropdown.Trigger className="button button--primary button--sm">
				<Plus aria-hidden />
				发布主题
			</Dropdown.Trigger>
			<Dropdown.Popover placement="bottom end" className="min-w-40">
				<Dropdown.Menu
					aria-label="选择版块"
					onAction={(key) => {
						const slug = categories.find((category) => category.id === key)?.slug
						if (slug !== undefined) dock.openThread(slug)
					}}
				>
					{categories.map((category) => (
						<Dropdown.Item key={category.id} id={category.id} textValue={category.name}>
							{category.name}
						</Dropdown.Item>
					))}
				</Dropdown.Menu>
			</Dropdown.Popover>
		</Dropdown>
	)
}

/**
 * What a visitor who has not signed in sees first: the site's one-line pitch. The way in is the
 * top bar's 「登录」, so the card carries no second login button.
 */
function GuestWelcome({
	root,
}: {
	root: ReturnType<typeof useRouteLoaderData<typeof rootLoader>>
}) {
	const site = siteOf(root)
	if (site.tagline === '') return null
	return (
		<Panel as="section" className="mb-4 p-4">
			<p className="text-ink-strong text-title font-bold">欢迎来到 {site.name}</p>
			<p className="text-ink-weak mt-0.5 break-words">{site.tagline}</p>
		</Panel>
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
			className={`h-control relative -mx-1 -mb-px cursor-pointer px-1 text-ui transition-colors ${
				selected ? 'text-ink-strong font-bold' : 'text-ink-weak hover:text-ink-strong'
			}`}
		>
			{children}
			{selected && <TabIndicator name="home-tab" />}
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
						hint="留空则按名称生成"
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
