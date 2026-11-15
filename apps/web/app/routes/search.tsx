import { LIMITS, type CategoryDto, type SearchHitDto } from '@forum/domain'
import { Search, SearchX } from 'lucide-react'
import { Form, Link, useNavigation } from 'react-router'

import type { Route } from './+types/search'
import { UserAvatar } from '../components/forum/user-avatar'
import { Button } from '../components/ui/button'
import {
	EmptyState,
	FormError,
	PageHeader,
	Panel,
	SectionLabel,
	Tag,
	Timestamp,
} from '../components/ui/display'
import { Pager } from '../components/ui/pager'
import { forumApi, orThrow, pageParam } from '../lib/forum-api.server'
import { keepOnThemeChange } from '../lib/revalidate'

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

export function buildSearchHitHref(
	hit: Pick<SearchHitDto, 'postId' | 'threadId' | 'opening'>,
	categorySlug: string | undefined,
): string {
	const base =
		categorySlug !== undefined ? `/c/${categorySlug}/t/${hit.threadId}` : `/t/${hit.threadId}`
	return hit.opening ? base : `${base}#post-${hit.postId}`
}

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
	const query = loaderData?.query
	return [{ title: `${query ? `搜索“${query}” · ` : '搜索 · '}Pluxel Forum` }]
}

export async function loader({ request }: Route.LoaderArgs) {
	const [metaResult, categoriesResult] = await Promise.all([
		forumApi.meta(request),
		forumApi.categories(request),
	])
	const forumMeta = orThrow(metaResult)
	const categories = orThrow(categoriesResult).items
	const parsed = parseSearchUrl(new URL(request.url))
	const page = pageParam(request)

	if (!forumMeta.search.available) {
		return {
			available: false as const,
			...parsed,
			categories,
			results: null,
			error: undefined,
		}
	}

	if (parsed.query === '') {
		return {
			available: true as const,
			...parsed,
			categories,
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
				categories,
				results: null,
				error: undefined,
			}
		}
		if (searchResult.error.code === 'invalid' || searchResult.error.code === 'not_found') {
			return {
				available: true as const,
				...parsed,
				categories,
				results: null,
				error: searchResult.error.message,
			}
		}
		orThrow(searchResult)
	}

	return {
		available: true as const,
		...parsed,
		categories,
		results: searchResult.ok ? searchResult.value : null,
		error: undefined,
	}
}

export const shouldRevalidate = keepOnThemeChange

export default function SearchRoute({ loaderData }: Route.ComponentProps) {
	const { available, query, categoryId, authorId, threadsOnly, categories, results, error } =
		loaderData
	const navigation = useNavigation()
	const isSearching = navigation.state === 'loading' && navigation.location?.pathname === '/search'

	if (!available) {
		return (
			<>
				<PageHeader title="搜索" description="检索论坛中的主题与回复。" />
				<EmptyState
					icon={SearchX}
					title="搜索功能未启用"
					hint="全文检索插件当前处于停用状态，请稍后再试。"
				/>
			</>
		)
	}

	const categoriesById = new Map<string, CategoryDto>(
		categories.map((category) => [category.id, category]),
	)

	return (
		<>
			<PageHeader title="搜索" description="支持中英文分词检索，可按版块或主题范围筛选。" />

			<Panel className="mb-6 p-3 sm:p-4">
				<Form method="get" action="/search" role="search" className="flex flex-col gap-3">
					{authorId !== undefined && <input type="hidden" name="authorId" value={authorId} />}
					<div className="flex items-center gap-2">
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
								placeholder="输入关键词搜索主题或帖子…"
								aria-label="搜索关键词"
								autoFocus={query === ''}
								className="border-line bg-page text-ink-strong placeholder:text-ink-weak/60 hover:border-ink-weak focus:border-accent h-8 w-full rounded-[2px] border pr-3 pl-8 text-[13px] outline-none"
							/>
						</div>
						<Button tone="primary" size="md" type="submit" isPending={isSearching}>
							搜索
						</Button>
					</div>

					<div className="flex flex-wrap items-center gap-2">
						<select
							key={categoryId}
							name="categoryId"
							defaultValue={categoryId}
							aria-label="按版块筛选"
							className="border-line bg-page text-ink-strong hover:border-ink-weak focus:border-accent h-8 max-w-full rounded-[2px] border px-2.5 text-[13px] outline-none"
						>
							<option value="">全部版块</option>
							{categories.map((category) => (
								<option key={category.id} value={category.id}>
									{category.name}
								</option>
							))}
						</select>

						<label className="border-line bg-page text-ink hover:border-ink-weak flex h-8 cursor-pointer items-center gap-2 rounded-[2px] border px-2.5 text-[13px] select-none">
							<input
								key={String(threadsOnly)}
								type="checkbox"
								name="threadsOnly"
								value="1"
								defaultChecked={threadsOnly}
								className="size-3.5 accent-[var(--c-accent)]"
							/>
							<span>仅看主题</span>
						</label>
					</div>
				</Form>
			</Panel>

			{error !== undefined && (
				<div className="mb-6">
					<FormError message={error} />
				</div>
			)}

			{results === null ? (
				error === undefined && (
					<EmptyState
						icon={Search}
						title="输入关键词开始搜索"
						hint="支持中文词语切分与英文搜索，结果按相关度与发布时间排序。"
					/>
				)
			) : results.items.length === 0 ? (
				<EmptyState
					icon={SearchX}
					title="没有找到匹配的内容"
					hint="试试缩短关键词、换个说法，或放宽版块与主题筛选条件。"
				/>
			) : (
				<section>
					<SectionLabel>搜索结果 · {results.total}</SectionLabel>
					<Panel as="ol" className="divide-line divide-y">
						{results.items.map((hit) => (
							<SearchHitRow
								key={hit.postId}
								hit={hit}
								category={categoriesById.get(hit.categoryId)}
							/>
						))}
					</Panel>
					<Pager page={results.page} pageSize={results.pageSize} total={results.total} />
				</section>
			)}
		</>
	)
}

function SearchHitRow({ hit, category }: { hit: SearchHitDto; category: CategoryDto | undefined }) {
	const href = buildSearchHitHref(hit, category?.slug)
	return (
		<li className="hover:bg-hover flex items-start gap-3 px-4 py-3 transition-colors">
			<Link
				to={`/u/${hit.author.id}`}
				tabIndex={-1}
				aria-hidden
				className="hidden shrink-0 sm:block"
			>
				<UserAvatar user={hit.author} />
			</Link>
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
					<Tag tone={hit.opening ? 'accent' : 'neutral'}>{hit.opening ? '主题' : '回复'}</Tag>
					{category !== undefined && <Tag>{category.name}</Tag>}
					<Link
						to={href}
						prefetch="intent"
						className="text-ink-strong text-[14px] font-bold break-words hover:underline"
					>
						{hit.title}
					</Link>
				</div>

				{hit.snippetHtml !== '' && (
					// Sanitized by forum-core (`sanitizeSearchSnippet` allows `<mark>` with no attributes).
					<p
						className="search-snippet text-ink mt-1.5 line-clamp-3 text-[13px] leading-relaxed break-words"
						dangerouslySetInnerHTML={{ __html: hit.snippetHtml }}
					/>
				)}

				<div className="text-ink-weak mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px]">
					<Link to={`/u/${hit.author.id}`} className="text-ink truncate hover:underline">
						{hit.author.displayName}
					</Link>
					<span aria-hidden>·</span>
					<Timestamp iso={hit.createdAt} />
				</div>
			</div>
		</li>
	)
}
