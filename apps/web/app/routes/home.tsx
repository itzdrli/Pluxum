import type { CategoryDto, CommunityDto, UserDto } from '@pluxum/domain'
import { Dropdown } from '@heroui/react'
import { LayoutList, MessagesSquare, NotebookPen, Plus, UserRoundPlus } from 'lucide-react'
import { useCallback, useState } from 'react'
import {
	data,
	Form,
	redirect,
	useNavigation,
	useRouteLoaderData,
	useSearchParams,
} from 'react-router'
import { Trans, useLingui } from '@lingui/react/macro'
import { t as tm } from '@lingui/core/macro'

import type { Route } from './+types/home'
import { NoteCard, NoteComposer } from '../components/forum/note-card'
import { ThreadRow } from '../components/forum/rows'
import { UserAvatar } from '../components/forum/user-avatar'
import { StageLink, useStageNavigate } from '../components/stage/stage'
import { Button, IconButton } from '../components/ui/button'
import { EmptyState, FormError, Panel, TabIndicator } from '../components/ui/display'
import { Pager } from '../components/ui/pager'
import { TextInputField } from '../components/ui/field'
import { forumApi, orThrow, pageParam, textField } from '../lib/forum-api.server'
import { i18nFromRequest } from '../lib/i18n.server'
import {
	feedQuery,
	HOME_PAGE_SIZE,
	HOME_TABS,
	homeFeedHref,
	homeFeedOf,
	LATEST_ORDERS,
	type HomeFeed,
} from '../lib/home'
import { defineStage } from '../lib/stage'
import { withViewTransition } from '../lib/view-transition'
import type { loader as rootLoader } from '../root'
import { siteOf } from '../lib/site'
import { STREAM_LABEL } from '../lib/stream'

export const handle = defineStage({ layer: 'page', nav: true, wide: true })

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	const site = siteOf(matches[0].loaderData)
	return [{ title: site.name }, { name: 'description', content: site.description }]
}

export async function loader({ request }: Route.LoaderArgs) {
	// `/meta` is cached per session, so asking it here again costs nothing.
	const viewer = await forumApi.meta(request)
	const feed = homeFeedOf(
		new URL(request.url),
		viewer.ok ? viewer.value.viewer.following : undefined,
	)
	const [categoriesResult, recentResult, communityResult] = await Promise.all([
		forumApi.categories(request),
		forumApi.recentThreads(request, pageParam(request), HOME_PAGE_SIZE, feedQuery(feed)),
		forumApi.community(request),
	])
	return {
		categories: orThrow(categoriesResult).items,
		recentThreads: orThrow(recentResult),
		// A side panel: the feed is served without it when it cannot be had.
		community: communityResult.ok ? communityResult.value : null,
		feed,
	}
}

// Posts a note (`intent=note`, from the note box on any page, by a fetcher) or creates a category;
// the API decides whether the visitor may.
export async function action({ request }: Route.ActionArgs) {
	const i18n = await i18nFromRequest(request)
	const form = await request.formData()
	if (textField(form, 'intent') === 'note') {
		const stream = orThrow(await forumApi.meta(request)).stream
		if (stream === null) return data({ noteError: tm(i18n)`动态暂时不可用。` }, { status: 404 })
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
	const { t } = useLingui()
	const { categories, recentThreads, community, feed } = loaderData
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
	const stream = root?.meta?.stream ?? null
	const followingAvailable = root?.meta?.viewer.following.available === true
	const navigate = useStageNavigate()
	// The note just posted from the box, lit up in the list. A feed that would not show it at the
	// top (「热门」, 「关注」, a later page) gives way to 「最新」, where it does.
	const [fresh, setFresh] = useState<string | null>(null)
	const onPosted = useCallback(
		(id: string) => {
			setFresh(id)
			if (feed.tab !== 'latest' || searchParams.has('page')) {
				void navigate(homeFeedHref({ tab: 'latest', order: 'active' }))
			}
		},
		[feed.tab, navigate, searchParams],
	)

	const categoryCount = categories.length
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
				<div role="tablist" aria-label={t`首页内容切换`} className="flex items-center gap-5">
					{/* Not 「最新」: that is also one of the feed's orderings right below. */}
					<HomeTab
						selected={mobileTab === 'recent'}
						onSelect={() => withViewTransition(() => setMobileTab('recent'))}
					>
						<Trans>讨论</Trans>
					</HomeTab>
					<HomeTab
						selected={mobileTab === 'categories'}
						onSelect={() => withViewTransition(() => setMobileTab('categories'))}
					>
						<Trans>版块</Trans>
					</HomeTab>
				</div>
				{/* Only beside the categories, so it is never mistaken for 「发布主题」 under the feed tab. */}
				{canManage && !showForm && mobileTab === 'categories' && (
					<IconButton
						label={t`新建版块`}
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
						<h1 className="text-ink-strong mr-4 text-heading font-bold max-lg:hidden">
							<Trans>概览</Trans>
						</h1>
						<FeedTabs feed={feed} following={followingAvailable} />
						<div className="flex items-center gap-3 lg:ml-auto">
							<span className="text-ink-weak text-meta tabular-nums max-lg:hidden xl:hidden">
								{t`${categoryCount} 版块`} · {t`${totalThreads} 主题`} · {t`${totalPosts} 帖子`}
							</span>
							{/* With the note box, the way to a topic sits beside it: one place to write from. */}
							{signedIn && !canPostNote && <NewThreadMenu categories={categories} />}
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
						aria-label={t`最新活跃讨论`}
						className={mobileTab === 'recent' ? '' : 'max-lg:hidden'}
					>
						{!signedIn && <GuestWelcome root={root} />}
						{canPostNote && (
							<NoteComposer
								max={root?.meta?.limits.noteBodyMax}
								onPosted={onPosted}
								aside={<NewThreadMenu categories={categories} tone="secondary" />}
							/>
						)}
						{feed.tab === 'latest' && <LatestOrderToggle feed={feed} />}
						{recentThreads.items.length === 0 ? (
							feed.tab === 'following' ? (
								<EmptyState
									icon={UserRoundPlus}
									title={t`还没有关注的内容`}
									hint={t`在用户主页或版块页点「关注」，就能在这里看到那里的新帖。`}
								/>
							) : (
								<EmptyState icon={MessagesSquare} title={t`还没有讨论`} />
							)
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
												fresh={item.id === fresh}
											/>
										) : (
											<ThreadRow
												key={item.id}
												thread={item}
												href={`/c/${item.category.slug}/t/${item.ref}`}
												category={item.category}
												time={feed.tab === 'latest' && feed.order === 'new' ? 'created' : 'last'}
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
						aria-label={t`版块`}
						className={mobileTab === 'categories' ? 'lg:hidden' : 'hidden'}
					>
						{categories.length === 0 && stream === null ? (
							<EmptyState icon={LayoutList} title={t`还没有版块`} />
						) : (
							<Panel
								as="ul"
								className="divide-line divide-y max-sm:-mx-4 max-sm:rounded-none max-sm:border-x-0 max-sm:border-t-0"
							>
								{stream !== null && <StreamItem stream={stream} />}
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
	const { t } = useLingui()
	const days = community.days
	return (
		// Above the feed's pane head, whose band runs under this column: the heading sits in that band.
		<aside aria-label={t`社区`} className="min-w-0 max-xl:hidden xl:sticky xl:top-0 xl:z-20">
			<h2 className="section-label mb-5 flex h-[var(--h-pane-bar)] items-center">
				<Trans>社区</Trans>
			</h2>
			<Panel className="flex flex-col divide-y divide-line">
				<dl className="grid grid-cols-3 gap-2 px-4 py-4 text-center">
					{[
						[t`成员`, community.members],
						[t({ message: '主题', context: 'thread' }), threads],
						[t`帖子`, posts],
					].map(([label, value]) => (
						<div key={label}>
							<dd className="text-ink-strong text-heading font-bold tabular-nums">{value}</dd>
							<dt className="text-ink-weak text-meta">{label}</dt>
						</div>
					))}
				</dl>
				{community.activeMembers.length > 0 && (
					<MemberList title={t`近 ${days} 天活跃`}>
						{community.activeMembers.map(({ user, posts: total }) => (
							<MemberRow key={user.id} user={user} note={t`${total} 帖`} />
						))}
					</MemberList>
				)}
				{community.newMembers.length > 0 && (
					<MemberList title={t`新加入`}>
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

/**
 * The feed's tabs: links, so each is a URL of its own. 「关注」 is there only while a follow
 * plugin runs and the reader is signed in.
 */
function FeedTabs({ feed, following }: { feed: HomeFeed; following: boolean }) {
	const { t, i18n } = useLingui()
	return (
		<nav aria-label={t`信息流`} className="flex items-center gap-4">
			{HOME_TABS.filter((tab) => tab.id !== 'following' || following).map((tab) => (
				<StageLink
					key={tab.id}
					to={homeFeedHref({ tab: tab.id, order: 'active' })}
					replace
					aria-current={tab.id === feed.tab ? 'page' : undefined}
					className={`h-control relative -mb-px inline-flex items-center text-ui transition-colors max-lg:-mx-1 max-lg:px-1 lg:h-[var(--h-pane-bar)] ${
						tab.id === feed.tab
							? 'text-ink-strong font-bold'
							: 'text-ink-weak hover:text-ink-strong'
					}`}
				>
					{i18n._(tab.label)}
					{tab.id === feed.tab && <TabIndicator name="sort-tab" />}
				</StageLink>
			))}
		</nav>
	)
}

/** 「最新」's second choice, above its list: by latest reply (the default) or by start. */
function LatestOrderToggle({ feed }: { feed: HomeFeed }) {
	const { t, i18n } = useLingui()
	return (
		<nav aria-label={t`排序`} className="text-meta mb-3 flex items-center gap-1">
			{LATEST_ORDERS.map((order) => (
				<StageLink
					key={order.id}
					to={homeFeedHref({ tab: 'latest', order: order.id })}
					replace
					aria-current={order.id === feed.order ? 'page' : undefined}
					className={`rounded-[2px] px-2 py-1 transition-colors ${
						order.id === feed.order
							? 'bg-control text-ink-strong font-bold'
							: 'text-ink-weak hover:text-ink-strong'
					}`}
				>
					{i18n._(order.label)}
				</StageLink>
			))}
		</nav>
	)
}

/** "发布主题" from the overview: pick the category, then write on its new-thread page. */
function NewThreadMenu({
	categories,
	tone = 'primary',
}: {
	categories: readonly CategoryDto[]
	tone?: 'primary' | 'secondary'
}) {
	const { t } = useLingui()
	const navigate = useStageNavigate()
	if (categories.length === 0) return null
	return (
		<Dropdown>
			<Dropdown.Trigger
				className={`button button--${tone} ${tone === 'primary' ? 'button--sm' : ''} shrink-0`}
			>
				<Plus aria-hidden />
				<Trans>发布主题</Trans>
			</Dropdown.Trigger>
			<Dropdown.Popover placement="bottom end" className="min-w-40">
				<Dropdown.Menu
					aria-label={t`选择版块`}
					onAction={(key) => {
						const slug = categories.find((category) => category.id === key)?.slug
						if (slug !== undefined) void navigate(`/c/${slug}/new`)
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
	const { t } = useLingui()
	const site = siteOf(root)
	const siteName = site.name
	if (site.tagline === '') return null
	return (
		<Panel as="section" className="mb-4 p-4">
			<p className="text-ink-strong text-title font-bold">{t`欢迎来到 ${siteName}`}</p>
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

/** The stream in the phone tab, above the categories: where every note is, on a page of its own. */
function StreamItem({ stream }: { stream: { slug: string } }) {
	const { i18n } = useLingui()
	return (
		<li>
			<StageLink
				to={`/c/${stream.slug}`}
				prefetch="intent"
				className="hover:bg-hover active:bg-pressed flex items-center gap-3 px-3 py-2.5 transition-colors"
			>
				<span
					aria-hidden
					className="bg-control text-ink-strong flex size-8 shrink-0 items-center justify-center rounded-[2px]"
				>
					<NotebookPen size={16} />
				</span>
				<span className="text-ink-strong min-w-0 flex-1 truncate font-bold">
					{i18n._(STREAM_LABEL)}
				</span>
			</StageLink>
		</li>
	)
}

/** A category in the phone tab: tile, name with its one-line description, and its thread count. */
function CategoryItem({ category }: { category: CategoryDto }) {
	const { t } = useLingui()
	const threadCount = category.threadCount
	const postCount = category.postCount
	return (
		<li>
			<StageLink
				to={`/c/${category.slug}`}
				prefetch="intent"
				title={`${t`${threadCount} 主题`} · ${t`${postCount} 帖子`}`}
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
					<span className="sr-only">
						{' '}
						<Trans context="thread">主题</Trans>
					</span>
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
	const { t } = useLingui()
	const submitting = useNavigation().state === 'submitting'
	return (
		<Panel as="section" className="mb-4 p-4">
			<h3 className="text-ink-strong mb-3 font-bold">
				<Trans>新建版块</Trans>
			</h3>
			<Form method="post" className="flex flex-col gap-3">
				<FormError message={error} />
				<div className="grid gap-3">
					<TextInputField
						name="name"
						label={t`名称`}
						required
						maxLength={nameMax}
						placeholder={t`综合讨论`}
						autoFocus
					/>
					<TextInputField
						name="slug"
						label={t`标识`}
						hint={t`留空则按名称生成`}
						placeholder="general"
						pattern="[a-z0-9]+(-[a-z0-9]+)*"
					/>
				</div>
				<TextInputField name="description" label={t`简介`} />
				<div className="flex justify-end gap-2">
					<Button tone="ghost" onPress={onCancel}>
						<Trans>取消</Trans>
					</Button>
					<Button tone="primary" type="submit" isPending={submitting}>
						<Trans>创建版块</Trans>
					</Button>
				</div>
			</Form>
		</Panel>
	)
}
