// The overview page's feed ordering. The values are the API's `sort` parameter.

export const HOME_SORTS = [
	{ id: 'active', label: '活跃' },
	{ id: 'new', label: '最新' },
	{ id: 'hot', label: '热门' },
] as const

export type HomeSort = (typeof HOME_SORTS)[number]['id']

/** The `?sort=` of a URL; anything unknown is the default, `active`. */
export function homeSortOf(url: URL): HomeSort {
	const raw = url.searchParams.get('sort')
	return HOME_SORTS.find((sort) => sort.id === raw)?.id ?? 'active'
}

/** Page size of the overview feed. */
export const HOME_PAGE_SIZE = 20
