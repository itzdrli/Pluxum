import { Alert, buttonVariants, type ButtonVariants } from '@heroui/react'
import { Link } from 'react-router'

import { formatDateTime, pageCount } from '../lib/format'

/** A navigation link that looks like a button. */
export function ButtonLink({
	to,
	variant = 'primary',
	size = 'sm',
	children,
}: {
	to: string
	variant?: ButtonVariants['variant']
	size?: ButtonVariants['size']
	children: React.ReactNode
}) {
	return (
		<Link to={to} className={buttonVariants({ variant, size })}>
			{children}
		</Link>
	)
}

export function Timestamp({ iso }: { iso: string }) {
	return (
		<time dateTime={iso} className="tabular-nums">
			{formatDateTime(iso)}
		</time>
	)
}

export function Crumbs({ items }: { items: ReadonlyArray<{ label: string; to?: string }> }) {
	return (
		<nav aria-label="位置" className="text-muted mb-4 flex flex-wrap items-center gap-2 text-sm">
			{items.map((item, index) => (
				<span key={item.to ?? item.label} className="flex items-center gap-2">
					{index > 0 && <span aria-hidden="true">/</span>}
					{item.to === undefined ? (
						<span className="text-foreground">{item.label}</span>
					) : (
						<Link to={item.to} className="hover:text-foreground">
							{item.label}
						</Link>
					)}
				</span>
			))}
		</nav>
	)
}

export function FormError({ message }: { message: string | undefined }) {
	if (message === undefined) return null
	return (
		<Alert status="danger" role="alert">
			<Alert.Indicator />
			<Alert.Content>
				<Alert.Title>{message}</Alert.Title>
			</Alert.Content>
		</Alert>
	)
}

function pageHref(page: number): string {
	return page > 1 ? `?page=${page}` : '?'
}

/** Previous / next links for a `?page=` list. Renders nothing when everything fits on one page. */
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
		<nav aria-label="分页" className="mt-4 flex items-center justify-between text-sm">
			{page > 1 ? (
				<ButtonLink to={pageHref(page - 1)} variant="secondary">
					上一页
				</ButtonLink>
			) : (
				<span />
			)}
			<span className="text-muted tabular-nums">
				第 {page} / {pages} 页
			</span>
			{page < pages ? (
				<ButtonLink to={pageHref(page + 1)} variant="secondary">
					下一页
				</ButtonLink>
			) : (
				<span />
			)}
		</nav>
	)
}
