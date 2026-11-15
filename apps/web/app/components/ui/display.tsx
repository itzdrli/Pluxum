import { ChevronRight, CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Link } from 'react-router'

import { formatDateTime } from '../../lib/format'

/** Small inline label. `accent` marks the one thing worth noticing (pinned, own role). */
export type TagTone = 'neutral' | 'accent' | 'warning' | 'danger' | 'success'

const TAG_TONES: Record<TagTone, string> = {
	neutral: 'bg-control text-ink-weak',
	accent: 'bg-accent-soft text-accent',
	warning: 'bg-warning-soft text-warning',
	danger: 'bg-danger-soft text-danger',
	success: 'bg-success-soft text-success',
}

export function Tag({
	tone = 'neutral',
	icon: Icon,
	children,
}: {
	tone?: TagTone
	icon?: LucideIcon
	children: React.ReactNode
}) {
	return (
		<span
			className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-[2px] px-1.5 text-[12px] leading-none whitespace-nowrap ${TAG_TONES[tone]}`}
		>
			{Icon !== undefined && <Icon aria-hidden size={12} strokeWidth={2} />}
			{children}
		</span>
	)
}

const AVATAR_SIZES = {
	sm: 'size-5 text-[11px]',
	md: 'size-7 text-[13px]',
	lg: 'size-9 text-[15px]',
}

/** Monogram avatar: the first character of the name on the control colour, no extra hue. */
export function Avatar({ name, size = 'md' }: { name: string; size?: keyof typeof AVATAR_SIZES }) {
	const initial = Array.from(name.trim())[0]?.toUpperCase() ?? '?'
	return (
		<span
			aria-hidden
			className={`bg-control text-ink-strong border-line inline-flex shrink-0 items-center justify-center rounded-[2px] border font-bold select-none ${AVATAR_SIZES[size]}`}
		>
			{initial}
		</span>
	)
}

export function Timestamp({ iso, className }: { iso: string; className?: string }) {
	return (
		<time dateTime={iso} className={`tabular-nums ${className ?? ''}`}>
			{formatDateTime(iso)}
		</time>
	)
}

export function Crumbs({ items }: { items: ReadonlyArray<{ label: string; to?: string }> }) {
	return (
		<nav
			aria-label="位置"
			className="text-ink-weak mb-3 flex min-w-0 items-center gap-1 text-[12px]"
		>
			{items.map((item, index) => (
				<span key={item.to ?? item.label} className="flex min-w-0 items-center gap-1">
					{index > 0 && <ChevronRight aria-hidden size={12} className="shrink-0" />}
					{item.to === undefined ? (
						<span className="text-ink truncate" aria-current="page">
							{item.label}
						</span>
					) : (
						<Link to={item.to} className="hover:text-ink-strong shrink-0">
							{item.label}
						</Link>
					)}
				</span>
			))}
		</nav>
	)
}

/** Title row of a page: heading, optional description and meta, actions on the right. */
export function PageHeader({
	title,
	description,
	meta,
	actions,
}: {
	title: React.ReactNode
	description?: string
	meta?: React.ReactNode
	actions?: React.ReactNode
}) {
	return (
		<header className="mb-4 flex flex-wrap items-start justify-between gap-3">
			<div className="min-w-0 flex-1 basis-64">
				<h1 className="text-ink-strong text-[20px] leading-snug font-bold break-words">{title}</h1>
				{description !== undefined && description !== '' && (
					<p className="text-ink-weak mt-1 break-words">{description}</p>
				)}
				{meta !== undefined && (
					<div className="text-ink-weak mt-2 flex flex-wrap items-center gap-2 text-[12px]">
						{meta}
					</div>
				)}
			</div>
			{actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
		</header>
	)
}

/** A raised panel; lists inside get dividers from `divide-line`. */
export function Panel({
	as: Element = 'div',
	className,
	children,
}: {
	as?: 'div' | 'ul' | 'ol' | 'section' | 'article'
	className?: string
	children: React.ReactNode
}) {
	return (
		<Element className={`border-line bg-panel rounded-[2px] border ${className ?? ''}`}>
			{children}
		</Element>
	)
}

export function SectionLabel({
	children,
	actions,
}: {
	children: React.ReactNode
	actions?: React.ReactNode
}) {
	return (
		<div className="mb-2 flex min-h-7 items-center justify-between gap-3">
			<h2 className="section-label">{children}</h2>
			{actions}
		</div>
	)
}

export function EmptyState({
	icon: Icon,
	title,
	hint,
	action,
}: {
	icon: LucideIcon
	title: string
	hint?: string
	action?: React.ReactNode
}) {
	return (
		<div className="border-line flex flex-col items-center gap-2 rounded-[2px] border border-dashed px-6 py-12 text-center">
			<Icon aria-hidden size={20} className="text-ink-weak" strokeWidth={1.75} />
			<p className="text-ink-strong font-bold">{title}</p>
			{hint !== undefined && <p className="text-ink-weak max-w-sm">{hint}</p>}
			{action !== undefined && <div className="mt-2">{action}</div>}
		</div>
	)
}

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger'

const NOTICE: Record<NoticeTone, { icon: LucideIcon; className: string }> = {
	info: { icon: Info, className: 'border-line bg-panel text-ink' },
	success: { icon: CircleCheck, className: 'border-success/40 bg-success-soft text-success' },
	warning: { icon: TriangleAlert, className: 'border-warning/40 bg-warning-soft text-warning' },
	danger: { icon: CircleAlert, className: 'border-danger/40 bg-danger-soft text-danger' },
}

/** An inline message. Danger and warning notices are announced to assistive technology. */
export function Notice({
	tone = 'info',
	icon,
	children,
	className,
}: {
	tone?: NoticeTone
	/** Replaces the tone's default icon. */
	icon?: LucideIcon
	children: React.ReactNode
	className?: string
}) {
	const { icon: toneIcon, className: toneClass } = NOTICE[tone]
	const Icon = icon ?? toneIcon
	return (
		<div
			role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
			className={`flex items-start gap-2 rounded-[2px] border px-3 py-2 ${toneClass} ${className ?? ''}`}
		>
			<Icon aria-hidden size={16} className="mt-px shrink-0" />
			<div className="min-w-0 flex-1">{children}</div>
		</div>
	)
}

/** The API's message for a failed form submission, if there is one. */
export function FormError({ message }: { message: string | undefined }) {
	if (message === undefined) return null
	return <Notice tone="danger">{message}</Notice>
}
