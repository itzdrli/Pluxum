import { ChevronRight, CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'

import { formatDateTime, formatHumanTime } from '../../lib/format'
import { StageLink } from '../stage/stage'

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
			className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-[2px] px-1.5 text-meta leading-none whitespace-nowrap ${TAG_TONES[tone]}`}
		>
			{Icon !== undefined && <Icon aria-hidden size={12} strokeWidth={2} />}
			{children}
		</span>
	)
}

const AVATAR_SIZES = {
	sm: 'size-5 text-micro',
	md: 'size-7 text-ui',
	lg: 'size-9 text-heading',
	xl: 'size-16 text-[26px]',
}

/**
 * A user's picture when there is one (`src`), otherwise a monogram: the first character of the
 * name on the control colour, no extra hue. A picture that fails to load falls back to the monogram.
 */
export function Avatar({
	name,
	src,
	size = 'md',
}: {
	name: string
	src?: string
	size?: keyof typeof AVATAR_SIZES
}) {
	const [failed, setFailed] = useState<string | null>(null)
	const box = `border-line inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[2px] border select-none ${AVATAR_SIZES[size]}`
	if (src !== undefined && failed !== src) {
		return (
			<span aria-hidden className={`bg-control ${box}`}>
				<img
					src={src}
					alt=""
					loading="lazy"
					decoding="async"
					className="size-full object-cover"
					// An error before hydration is missed by onError; check once mounted.
					ref={(image) => {
						if (image?.complete === true && image.naturalWidth === 0) setFailed(src)
					}}
					onError={() => setFailed(src)}
				/>
			</span>
		)
	}
	const initial = Array.from(name.trim())[0]?.toUpperCase() ?? '?'
	return (
		<span aria-hidden className={`bg-control text-ink-strong font-bold ${box}`}>
			{initial}
		</span>
	)
}

// One clock for every timestamp on the page: a single interval re-renders them together, and only
// while some timestamp is mounted.
let clock = Date.now()
const clockListeners = new Set<() => void>()
let clockTimer: ReturnType<typeof setInterval> | undefined

function subscribeToClock(listener: () => void) {
	if (clockListeners.size === 0) {
		clock = Date.now()
		clockTimer = setInterval(() => {
			clock = Date.now()
			for (const notify of clockListeners) notify()
		}, 10_000)
	}
	clockListeners.add(listener)
	// The first listener of a page was rendered from the server's clock: catch up at once.
	listener()
	return () => {
		clockListeners.delete(listener)
		if (clockListeners.size === 0) clearInterval(clockTimer)
	}
}

/** A moment as people say it (`3分钟前`, `3月2日`); hover for the exact minute. */
export function Timestamp({ iso, className }: { iso: string; className?: string }) {
	const now = useSyncExternalStore(subscribeToClock, () => clock, Date.now)
	return (
		// The server and the browser read the clock at different moments, so their words may differ.
		<time
			dateTime={iso}
			title={formatDateTime(iso)}
			suppressHydrationWarning
			className={`tabular-nums ${className ?? ''}`}
		>
			{formatHumanTime(iso, now)}
		</time>
	)
}

export function Crumbs({ items }: { items: ReadonlyArray<{ label: string; to?: string }> }) {
	return (
		<nav
			aria-label="位置"
			className="text-ink-weak mb-4 flex min-w-0 items-center gap-1.5 text-meta"
		>
			{items.map((item, index) => (
				<span key={item.to ?? item.label} className="flex min-w-0 items-center gap-1">
					{index > 0 && <ChevronRight aria-hidden size={12} className="shrink-0" />}
					{item.to === undefined ? (
						<span className="text-ink truncate" aria-current="page">
							{item.label}
						</span>
					) : (
						<StageLink to={item.to} className="hover:text-ink-strong shrink-0">
							{item.label}
						</StageLink>
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
		<header className="mb-6 flex flex-wrap items-start justify-between gap-4">
			<div className="min-w-0 flex-1 basis-64">
				<h1 className="text-ink-strong text-[20px] leading-snug font-bold break-words">{title}</h1>
				{description !== undefined && description !== '' && (
					<p className="text-ink-weak mt-1 break-words">{description}</p>
				)}
				{meta !== undefined && (
					<div className="text-ink-weak mt-2.5 flex flex-wrap items-center gap-2.5 text-meta">
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
	return <Element className={`bg-panel rounded-[4px] ${className ?? ''}`}>{children}</Element>
}

export function SectionLabel({
	children,
	actions,
}: {
	children: React.ReactNode
	actions?: React.ReactNode
}) {
	return (
		<div className="mb-3 flex min-h-7 items-center justify-between gap-3">
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
		<div className="border-line flex flex-col items-center gap-2 rounded-[2px] border border-dashed px-6 py-14 text-center">
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
			className={`flex items-start gap-2.5 rounded-[2px] border px-4 py-3 ${toneClass} ${className ?? ''}`}
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
