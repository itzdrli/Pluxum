import { buttonVariants } from '@heroui/react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Link } from 'react-router'

import { pageCount } from '../../lib/format'

function pageHref(page: number): string {
	return page > 1 ? `?page=${page}` : '?'
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

/** Pages of a `?page=` list. Renders nothing when everything fits on one page. */
export function Pager({
	page,
	pageSize,
	total,
}: {
	page: number
	pageSize: number
	total: number
}) {
	const pages = pageCount(total, pageSize)
	if (pages <= 1) return null
	return (
		<nav aria-label="分页" className="mt-4 flex items-center justify-center gap-1">
			{page > 1 ? (
				<Link to={pageHref(page - 1)} className={STEP} aria-label="上一页" rel="prev">
					<ChevronLeft aria-hidden />
				</Link>
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
					<Link
						key={item}
						to={pageHref(item)}
						aria-current={item === page ? 'page' : undefined}
						className={`${STEP} hidden min-w-7 tabular-nums sm:inline-flex ${item === page ? 'bg-selected! text-accent!' : ''}`}
					>
						{item}
					</Link>
				),
			)}
			{page < pages ? (
				<Link to={pageHref(page + 1)} className={STEP} aria-label="下一页" rel="next">
					<ChevronRight aria-hidden />
				</Link>
			) : (
				<span className={`${STEP} opacity-40`} aria-hidden>
					<ChevronRight />
				</span>
			)}
		</nav>
	)
}
