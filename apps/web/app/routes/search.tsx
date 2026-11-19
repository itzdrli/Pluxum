import { LIMITS, type CategoryDto, type SearchHitDto } from '@pluxum/domain'
import { msg } from '@lingui/core/macro'
import { Search, SearchX } from 'lucide-react'
import { Form, useNavigation, useRouteLoaderData } from 'react-router'
import { t as tm } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'

import type { Route } from './+types/search'
import type { loader as stageLoader } from './forum-stage'
import { UserAvatar } from '../components/forum/user-avatar'
import {
	FoldListButton,
	StageLink,
	StageSplit,
	useOpenThreadRef,
	useStageLinks,
} from '../components/stage/stage'
import { Button } from '../components/ui/button'
import {
	EmptyState,
	FormError,
	PageHeader,
	PaneBar,
	Panel,
	SectionLabel,
	Tag,
	Timestamp,
} from '../components/ui/display'
import { Pager } from '../components/ui/pager'
import { NativeSelect } from '../components/ui/field'
import { forumApi, orThrow } from '../lib/forum-api.server'
import { i18nOfRoot } from '../lib/i18n'
import { pageTitle } from '../lib/site'
import {
	defineStage,
	isDetailPath,
	LIST_PAGE_PARAM,
	listPageOf,
	listShouldRevalidate,
	type ResolvedStage,
	stageDetailHref,
} from '../lib/stage'

// The query and filters define the list, so they travel with every thread opened from it.
const SEARCH_CARRY = ['q', 'categoryId', 'authorId', 'threadsOnly'] as const

export const handle = defineStage({
	layer: 'list',
	nav: true,
	carry: SEARCH_CARRY,
	backLabel: msg`返回结果`,
})

export type ParsedSearchUrl = Readonly<{
	query: string
	categoryId: string
	authorId: string | undefined
	threadsOnly: boolean
}>

/** Extracts normalized search form state from a `/search` URL. */
export function parseSearchUrl(url: URL): ParsedSearchUrl {
	const query = (url.searchParams.get('q') ?? '').trim()
	const categoryId = (url.searchParams.get('categoryId') ?? '').trim()
	const rawAuthorId = (url.searchParams.get('authorId') ?? '').trim()
	const rawThreadsOnly = url.searchParams.get('threadsOnly')
	return {
		query,
		categoryId,
		authorId: rawAuthorId === '' ? undefined : rawAuthorId,
		threadsOnly: rawThreadsOnly === '1' || rawThreadsOnly === 'true',
	}
}

/** Opens a hit beside the results; a reply hit lands on its post floor (and page). */
export function buildSearchHitHref(
	hit: Pick<SearchHitDto, 'postId' | 'threadId' | 'opening'> &
		Partial<Pick<SearchHitDto, 'postNumber' | 'threadRef'>>,
	stage: Pick<ResolvedStage, 'listPath' | 'listHref'>,
): string {
	const threadTarget = hit.threadRef ?? hit.threadId
	if (hit.opening) return stageDetailHref(stage, threadTarget)
	const postTarget = hit.postNumber ?? hit.postId
	return stageDetailHref(stage, threadTarget, postTarget)
}

export function meta({ loaderData, matches }: Route.MetaArgs): Route.MetaDescriptors {
	const query = loaderData?.query ?? ''
	const i18n = i18nOfRoot(matches[0].loaderData)
	return [
		{ title: pageTitle(matches[0].loaderData, query ? tm(i18n)`搜索“${query}”` : tm(i18n)`搜索`) },
	]
}

export async function loader({ request }: Route.LoaderArgs) {
	const forumMeta = orThrow(await forumApi.meta(request))
	const url = new URL(request.url)
	const parsed = parseSearchUrl(url)
	const page = listPageOf(url, isDetailPath(url.pathname))

	if (!forumMeta.search.available) {
		return {
			available: false as const,
			...parsed,
			results: null,
			error: undefined,
		}
	}

	if (parsed.query === '') {
		return {
			available: true as const,
			...parsed,
			results: null,
			error: undefined,
		}
	}

	const searchResult = await forumApi.search(request, {
		query: parsed.query,
		categoryId: parsed.categoryId === '' ? undefined : parsed.categoryId,
		authorId: parsed.authorId,
		threadsOnly: parsed.threadsOnly,
		page,
	})

	if (!searchResult.ok) {
		if (searchResult.error.code === 'unavailable') {
			return {
				available: false as const,
				...parsed,
				results: null,
				error: undefined,
			}
		}
		if (searchResult.error.code === 'invalid' || searchResult.error.code === 'not_found') {
			return {
				available: true as const,
				...parsed,
				results: null,
				error: searchResult.error.message,
			}
		}
		orThrow(searchResult)
	}

	return {
		available: true as const,
		...parsed,
		results: searchResult.ok ? searchResult.value : null,
		error: undefined,
	}
}

export const shouldRevalidate = listShouldRevalidate(SEARCH_CARRY)

export default function SearchRoute({ loaderData }: Route.ComponentProps) {
	const { t } = useLingui()
	const { available, query, categoryId, authorId, threadsOnly, results, error } = loaderData
	const categories = useRouteLoaderData<typeof stageLoader>('routes/forum-stage')?.categories ?? []
	const navigation = useNavigation()
	const isSearching =
		navigation.state === 'loading' && navigation.location?.pathname.startsWith('/search')
	const openRef = useOpenThreadRef()
	const { stage } = useStageLinks()

	if (!available) {
		return (
			<StageSplit label={t`搜索`}>
				{() => (
					<>
						<PageHeader title={t`搜索`} />
						<EmptyState icon={SearchX} title={t`搜索功能未启用`} />
					</>
				)}
			</StageSplit>
		)
	}

	const categoriesById = new Map<string, CategoryDto>(
		categories.map((category) => [category.id, category]),
	)
	const hiddenFilters = (
		<>
			{authorId !== undefined && <input type="hidden" name="authorId" value={authorId} />}
			{categoryId !== '' && <input type="hidden" name="categoryId" value={categoryId} />}
			{threadsOnly && <input type="hidden" name="threadsOnly" value="1" />}
		</>
	)

	return (
		<StageSplit label={t`搜索结果`} short={t`搜索`}>
			{(detailOpen) => (
				<>
					{detailOpen ? (
						// The list's head beside a detail: the query, and the way to fold the list away.
						<PaneBar className="gap-1!">
							<Form method="get" action="/search" role="search" className="min-w-0 flex-1">
								{hiddenFilters}
								<SearchInput query={query} size="sm" />
							</Form>
							<FoldListButton />
						</PaneBar>
					) : (
						<>
							<PageHeader title={t`搜索`} />
							<Panel className="mb-6 p-3 sm:p-4">
								<Form method="get" action="/search" role="search" className="flex flex-col gap-3">
									{authorId !== undefined && (
										<input type="hidden" name="authorId" value={authorId} />
									)}
									<div className="flex items-center gap-2">
										<SearchInput query={query} size="md" autoFocus={query === ''} />
										<Button tone="primary" size="md" type="submit" isPending={isSearching}>
											<Trans>搜索</Trans>
										</Button>
									</div>

									<div className="flex flex-wrap items-center gap-2">
										<NativeSelect
											key={categoryId}
											name="categoryId"
											defaultValue={categoryId}
											aria-label={t`按版块筛选`}
											className="max-w-full"
										>
											<option value="">{t`全部版块`}</option>
											{categories.map((category) => (
												<option key={category.id} value={category.id}>
													{category.name}
												</option>
											))}
										</NativeSelect>

										<label className="border-line bg-page text-ink hover:border-ink-weak flex h-control cursor-pointer items-center gap-2 rounded-[2px] border px-2.5 text-ui select-none">
											<input
												key={String(threadsOnly)}
												type="checkbox"
												name="threadsOnly"
												value="1"
												defaultChecked={threadsOnly}
												className="size-3.5 accent-[var(--c-accent)]"
											/>
											<span>
												<Trans>仅看主题</Trans>
											</span>
										</label>
									</div>
								</Form>
							</Panel>
						</>
					)}

					{error !== undefined && (
						<div className="mb-6">
							<FormError message={error} />
						</div>
					)}

					{results === null ? (
						error === undefined && <EmptyState icon={Search} title={t`输入关键词开始搜索`} />
					) : results.items.length === 0 ? (
						<EmptyState icon={SearchX} title={t`没有找到匹配的内容`} />
					) : (
						<section>
							<SectionLabel>
								{t`搜索结果`} · {results.total}
							</SectionLabel>
							<Panel as="ol" className="divide-line divide-y">
								{results.items.map((hit) => (
									<SearchHitRow
										key={hit.postId}
										hit={hit}
										href={buildSearchHitHref(hit, stage)}
										isActive={hit.threadRef === openRef || hit.threadId === openRef}
										category={categoriesById.get(hit.categoryId)}
									/>
								))}
							</Panel>
							<Pager
								page={results.page}
								pageSize={results.pageSize}
								total={results.total}
								paramName={LIST_PAGE_PARAM}
							/>
						</section>
					)}
				</>
			)}
		</StageSplit>
	)
}

function SearchInput({
	query,
	size,
	autoFocus,
}: {
	query: string
	size: 'sm' | 'md'
	autoFocus?: boolean
}) {
	const { t } = useLingui()
	return (
		<div className="relative flex min-w-0 flex-1 items-center">
			<Search
				aria-hidden
				size={14}
				className="text-ink-weak pointer-events-none absolute left-2.5"
			/>
			<input
				key={query}
				type="search"
				name="q"
				defaultValue={query}
				maxLength={LIMITS.searchQueryMax}
				placeholder={t`搜索主题或回复…`}
				aria-label={t`搜索关键词`}
				autoFocus={autoFocus}
				className={`border-line bg-page text-ink-strong placeholder:text-ink-weak/60 hover:border-ink-weak focus:border-accent w-full rounded-[2px] border pr-3 pl-8 text-ui outline-none ${size === 'sm' ? 'h-control-sm' : 'h-control'}`}
			/>
		</div>
	)
}

function SearchHitRow({
	hit,
	href,
	isActive,
	category,
}: {
	hit: SearchHitDto
	href: string
	isActive: boolean
	category: CategoryDto | undefined
}) {
	const { t } = useLingui()
	const hitAuthor = hit.author.displayName
	return (
		<li
			className={`hover:bg-hover relative flex items-start gap-4 border-l-2 px-5 py-4 transition-colors ${
				isActive ? 'border-l-accent bg-selected' : 'border-l-transparent'
			}`}
		>
			<StageLink
				to={`/u/${hit.author.handle}`}
				tabIndex={-1}
				aria-hidden
				className="relative z-10 hidden shrink-0 @lg/threads:block"
			>
				<UserAvatar user={hit.author} />
			</StageLink>
			<div className="min-w-0 flex-1">
				{/* Kind tag and title share one line of text, like the rows of every other list. */}
				<p className="[overflow-wrap:anywhere]">
					<Tag tone={hit.opening ? 'accent' : 'neutral'} className="mr-2 align-[1px]">
						{/* Only notes have no title. */}
						{hit.opening
							? hit.title === ''
								? t({ message: '动态', context: 'tab: notes' })
								: t({ message: '主题', context: 'thread' })
							: t({ message: '回复', context: 'noun' })}
					</Tag>
					{/* The link's box covers the row, so the whole row opens the hit. */}
					<StageLink
						to={href}
						prefetch="intent"
						data-thread-link
						aria-current={isActive ? 'page' : undefined}
						className="text-ink-strong text-ui font-bold after:absolute after:inset-0 hover:underline @lg/threads:text-title"
					>
						{hit.title === '' ? t`${hitAuthor} 的动态` : hit.title}
					</StageLink>
				</p>

				{hit.snippetHtml !== '' && (
					// Sanitized by forum-core (`sanitizeSearchSnippet` allows `<mark>` with no attributes).
					<p
						className="search-snippet text-ink mt-1.5 line-clamp-2 @lg/threads:line-clamp-3 text-ui leading-relaxed [overflow-wrap:anywhere]"
						dangerouslySetInnerHTML={{ __html: hit.snippetHtml }}
					/>
				)}

				<div className="text-ink-weak mt-1.5 flex min-w-0 items-center gap-x-2 text-meta">
					<StageLink
						to={`/u/${hit.author.handle}`}
						className="text-ink relative z-10 min-w-0 truncate hover:underline"
					>
						{hit.author.displayName}
					</StageLink>
					{category !== undefined && (
						<>
							<span aria-hidden className="shrink-0">
								·
							</span>
							<StageLink
								to={`/c/${category.slug}`}
								prefetch="intent"
								className="hover:text-ink-strong relative z-10 max-w-32 shrink-0 truncate hover:underline"
							>
								{category.name}
							</StageLink>
						</>
					)}
					<span aria-hidden className="shrink-0">
						·
					</span>
					<Timestamp iso={hit.createdAt} className="shrink-0 whitespace-nowrap" />
				</div>
			</div>
		</li>
	)
}
