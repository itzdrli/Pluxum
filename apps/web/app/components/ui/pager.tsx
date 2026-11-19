import { buttonVariants } from '@heroui/react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useLocation } from 'react-router'
import { useLingui } from '@lingui/react/macro'

import { pageCount } from '../../lib/format'
import { isDetailPath, LIST_PAGE_PARAM } from '../../lib/stage'
import { StageLink } from '../stage/stage'

/** Builds a pagination href preserving `pathname` and orthogonal query parameters. */
export function buildPageHref(
	pathname: string,
	search: string,
	targetPage: number,
	paramName = 'page',
): string {
	const params = new URLSearchParams(search)
	// A list on its own may still carry the legacy `?page=`; its own pager replaces it.
	if (paramName === LIST_PAGE_PARAM && !isDetailPath(pathname)) {
		params.delete('page')
	}
	if (targetPage > 1) {
		params.set(paramName, String(targetPage))
	} else {
		params.delete(paramName)
	}
	const query = params.toString()
	return query === '' ? pathname : `${pathname}?${query}`
}

/** Page numbers to show: the first, the last, and two either side of the current one. */
export function pageWindow(page: number, pages: number): Array<number | 'gap'> {
	const shown = new Set([1, pages])
	for (let near = page - 2; near <= page + 2; near += 1) {
		if (near >= 1 && near <= pages) shown.add(near)
	}
	const sorted = [...shown].toSorted((a, b) => a - b)
	const result: Array<number | 'gap'> = []
	for (const [index, value] of sorted.entries()) {
		const previous = sorted[index - 1]
		if (previous !== undefined && value - previous > 1) result.push('gap')
		result.push(value)
	}
	return result
}

const STEP = buttonVariants({ variant: 'ghost', size: 'sm' })

/** Pages of a `?page=` or `?cpage=` list. Renders nothing when everything fits on one page. */
export function Pager({
	page,
	pageSize,
	total,
	paramName = 'page',
}: {
	page: number
	pageSize: number
	total: number
	paramName?: string
}) {
	const { t } = useLingui()
	const location = useLocation()
	const pages = pageCount(total, pageSize)
	if (pages <= 1) return null
	const pageHref = (targetPage: number) =>
		buildPageHref(location.pathname, location.search, targetPage, paramName)
	return (
		<nav aria-label={t`分页`} className="mt-4 flex items-center justify-center gap-1">
			{page > 1 ? (
				<StageLink to={pageHref(page - 1)} className={STEP} aria-label={t`上一页`} rel="prev">
					<ChevronLeft aria-hidden />
				</StageLink>
			) : (
				<span className={`${STEP} opacity-40`} aria-hidden>
					<ChevronLeft />
				</span>
			)}
			{/* Narrow screens show only "x / y"; the numbered links need room. */}
			<span className="text-ink-weak px-2 tabular-nums sm:hidden">
				{page} / {pages}
			</span>
			{pageWindow(page, pages).map((item, index) =>
				item === 'gap' ? (
					// oxlint-disable-next-line react/no-array-index-key -- gaps have no identity of their own.
					<span key={`gap-${index}`} className="text-ink-weak hidden px-1 sm:inline">
						…
					</span>
				) : (
					<StageLink
						key={item}
						to={pageHref(item)}
						aria-current={item === page ? 'page' : undefined}
						className={`${STEP} hidden min-w-7 tabular-nums sm:inline-flex ${item === page ? 'bg-selected! text-accent!' : ''}`}
					>
						{item}
					</StageLink>
				),
			)}
			{page < pages ? (
				<StageLink to={pageHref(page + 1)} className={STEP} aria-label={t`下一页`} rel="next">
					<ChevronRight aria-hidden />
				</StageLink>
			) : (
				<span className={`${STEP} opacity-40`} aria-hidden>
					<ChevronRight />
				</span>
			)}
		</nav>
	)
}
