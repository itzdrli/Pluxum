import { ChevronRight, CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
import { useLingui } from '@lingui/react/macro'

import { formatDateTime, formatHumanTime } from '../../lib/format'
import { useTimeZone } from '../../lib/timezone'
import { StageLink } from '../stage/stage'

/** Small inline label. `accent` marks the one thing worth noticing (pinned, own role). */
export type TagTone = 'neutral' | 'accent' | 'warning' | 'danger' | 'success'

// A tone's text sits on a tint of the same tone, which costs contrast (Nord's accent on its own
// tint is under 4:1); blending the text toward the strong ink keeps the hue and reads at 4.5:1.
const TAG_TONES: Record<TagTone, string> = {
	neutral: 'bg-control text-ink-weak',
	accent: 'bg-accent-soft text-[color-mix(in_srgb,var(--c-accent)_65%,var(--c-text-strong))]',
	warning: 'bg-warning-soft text-[color-mix(in_srgb,var(--c-warning)_65%,var(--c-text-strong))]',
	danger: 'bg-danger-soft text-[color-mix(in_srgb,var(--c-danger)_55%,var(--c-text-strong))]',
	success: 'bg-success-soft text-[color-mix(in_srgb,var(--c-success)_65%,var(--c-text-strong))]',
}

export function Tag({
	tone = 'neutral',
	icon: Icon,
	className,
	children,
}: {
	tone?: TagTone
	icon?: LucideIcon
	className?: string
	children: React.ReactNode
}) {
	return (
		<span
			className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-[2px] px-1.5 text-meta leading-none whitespace-nowrap ${TAG_TONES[tone]} ${className ?? ''}`}
		>
			{Icon !== undefined && <Icon aria-hidden size={12} strokeWidth={2} />}
			{children}
		</span>
	)
}

// Single-stroke characters read as punctuation on their own (「一」 looks like a minus sign), so a
// name that starts with one shows its next character instead.
const STROKE_CHARACTERS = new Set(['一', '丨', '丶', '丿', '乙', '亅', '乚', '乛'])

function monogramOf(name: string): string {
	const characters = Array.from(name.trim())
	const first = characters[0]
	if (first === undefined) return '?'
	const next = characters[1]
	if (STROKE_CHARACTERS.has(first) && next !== undefined && next.trim() !== '')
		return next.toUpperCase()
	return first.toUpperCase()
}

const AVATAR_SIZES = {
	sm: 'size-5 text-micro',
	md: 'size-7 text-ui',
	lg: 'size-9 text-heading',
	xl: 'size-16 text-[26px]',
}

/**
 * A user's picture when there is one (`src`), otherwise `art`, otherwise a monogram: the first
 * character of the name on the control colour. A picture that fails to load falls back the same way.
 */
export function Avatar({
	name,
	src,
	art,
	size = 'md',
}: {
	name: string
	src?: string
	/** A drawing in place of the monogram, filling the box. */
	art?: React.ReactNode
	size?: keyof typeof AVATAR_SIZES
}) {
	const [failed, setFailed] = useState<string | null>(null)
	const box = `border-line inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[2px] border select-none ${AVATAR_SIZES[size]}`
	if (src === undefined || failed === src) {
		if (art === undefined) {
			return (
				<span aria-hidden className={`bg-control text-ink-strong font-bold ${box}`}>
					{monogramOf(name)}
				</span>
			)
		}
		return (
			<span aria-hidden className={`bg-control ${box}`}>
				{art}
			</span>
		)
	}
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
	const { i18n } = useLingui()
	const timeZone = useTimeZone()
	const now = useSyncExternalStore(subscribeToClock, () => clock, Date.now)
	return (
		// The server and the browser read the clock at different moments, so their words may differ.
		<time
			dateTime={iso}
			title={formatDateTime(iso, i18n.locale, timeZone)}
			suppressHydrationWarning
			className={`tabular-nums ${className ?? ''}`}
		>
			{formatHumanTime(iso, now, i18n, timeZone)}
		</time>
	)
}

export function Crumbs({
	items,
	className = 'mb-4',
}: {
	items: ReadonlyArray<{ label: string; to?: string }>
	/** Placement; the default leaves room under a breadcrumb that opens a page. */
	className?: string
}) {
	const { t } = useLingui()
	return (
		<nav
			aria-label={t`位置`}
			className={`text-ink-weak flex min-w-0 items-center gap-1.5 text-meta ${className}`}
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

/**
 * Title row of a page: heading, optional description and meta, actions on the right.
 *
 * On wide screens it is the pane's head (`pane-bar`): the title at heading size with the actions
 * beside it, sticky at the top of the pane, and the description moves just under it. Phones lay
 * it out as a page title under the top bar. `bar={false}` keeps the page-title layout at every
 * width, for a page whose pane head holds something else (a thread: breadcrumb and actions).
 */
export function PageHeader({
	title,
	description,
	meta,
	actions,
	bar = true,
}: {
	title: React.ReactNode
	description?: string
	meta?: React.ReactNode
	actions?: React.ReactNode
	bar?: boolean
}) {
	const hasDescription = description !== undefined && description !== ''
	return (
		<>
			<header
				className={`mb-6 flex flex-wrap items-start justify-between gap-4 ${
					bar ? 'lg:pane-bar lg:flex-nowrap lg:items-center lg:justify-start' : ''
				}`}
			>
				<div className={`min-w-0 flex-1 basis-64 ${bar ? 'lg:basis-auto' : ''}`}>
					<h1
						className={`text-ink-strong text-[20px] leading-snug font-bold break-words ${
							bar ? 'lg:truncate lg:text-heading' : ''
						}`}
					>
						{title}
					</h1>
					{hasDescription && (
						<p className={`text-ink-weak mt-1 break-words ${bar ? 'lg:hidden' : ''}`}>
							{description}
						</p>
					)}
					{meta !== undefined && (
						<div className="text-ink-weak mt-2.5 flex flex-wrap items-center gap-2.5 text-meta">
							{meta}
						</div>
					)}
				</div>
				{actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
			</header>
			{bar && hasDescription && (
				<p className="text-ink-weak -mt-1 mb-5 break-words max-lg:hidden">{description}</p>
			)}
		</>
	)
}

/** A pane head on wide screens only (see `PageHeader`): for panes whose head is not a page title. */
export function PaneBar({
	className,
	children,
}: {
	className?: string
	children: React.ReactNode
}) {
	return <div className={`lg:pane-bar max-lg:hidden ${className ?? ''}`}>{children}</div>
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
	return <Element className={`bg-panel rounded-[2px] ${className ?? ''}`}>{children}</Element>
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
			className={`animate-notice-in flex items-start gap-2.5 rounded-[2px] border px-4 py-3 ${toneClass} ${className ?? ''}`}
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

/**
 * The underline of the selected tab. Its view-transition name (unique per tab row) makes a switch
 * slide it from the old tab to the new one; every indicator shares the `indicator` class, which
 * app.css animates. The parent needs `relative`.
 */
export function TabIndicator({ name, className }: { name: string; className?: string }) {
	return (
		<span
			aria-hidden
			style={{ viewTransitionName: name, viewTransitionClass: 'indicator' }}
			className={`bg-accent absolute inset-x-0 bottom-0 h-0.5 ${className ?? ''}`}
		/>
	)
}
