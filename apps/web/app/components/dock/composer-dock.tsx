import { useFormatForDisplay } from '@tanstack/react-hotkeys'
import { Maximize2, Minimize2, Minus, PenSquare, X } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useFetcher, useRouteLoaderData } from 'react-router'
import { useLingui } from '@lingui/react/macro'

import { droppedLink, toggledSize, type DockSize } from '../../lib/dock'
import type { loader as rootLoader } from '../../root'
import type { InsertAttachment } from '../../slots/slots'
import { Composer } from '../composer/composer'
import { Button, IconButton } from '../ui/button'
import { FormError } from '../ui/display'

/** The reply the dock is writing: to which thread, and the route that takes the post. */
type DockTarget = Readonly<{ threadId: string; title: string; action: string }>

type DockState = Readonly<{ target: DockTarget; size: DockSize; serial: number }>

/** How other parts of the page open the dock. */
type DockControl = Readonly<{
	/** Starts a reply. `action` is the thread route's own path (with its query) that takes the post. */
	openReply: (target: { threadId: string; title: string; action: string }) => void
	/** Whether a draft is on screen. */
	isOpen: boolean
}>

const DockContext = createContext<DockControl>({
	openReply: () => {},
	isOpen: false,
})

export function useDock(): DockControl {
	return useContext(DockContext)
}

/**
 * The non-modal reply drawer: it floats at the bottom right, never covers the page with a
 * backdrop and never changes the route, so the visitor reads other threads (or drags one in to
 * quote it) while replying. It keeps its draft when minimised or when the page underneath moves.
 * A new thread is written on its own page (`/c/:slug/new`), not here.
 */
export function DockProvider({ children }: { children: React.ReactNode }) {
	const [state, setState] = useState<DockState | null>(null)
	const openReply = useCallback((target: DockTarget) => {
		setState((current) =>
			current?.target.threadId === target.threadId
				? { ...current, size: current.size === 'min' ? 'half' : current.size }
				: { target, size: 'half', serial: (current?.serial ?? 0) + 1 },
		)
	}, [])
	const control = useMemo<DockControl>(
		() => ({ openReply, isOpen: state !== null }),
		[openReply, state],
	)
	return (
		<DockContext.Provider value={control}>
			{children}
			{state !== null && (
				<Dock
					// A different target is a different draft: start it fresh.
					key={state.serial}
					target={state.target}
					size={state.size}
					onSize={(size) => setState((current) => (current === null ? null : { ...current, size }))}
					onClose={() => setState(null)}
				/>
			)}
		</DockContext.Provider>
	)
}

const SIZE_CLASS: Record<DockSize, string> = {
	min: 'w-[min(360px,calc(100vw-2rem))]',
	half: 'h-[min(600px,calc(100dvh-5rem))] w-[min(520px,calc(100vw-2rem))]',
	full: 'h-[calc(100dvh-5rem)] w-[min(960px,calc(100vw-2rem))]',
}

function Dock({
	target,
	size,
	onSize,
	onClose,
}: {
	target: DockTarget
	size: DockSize
	onSize: (size: DockSize) => void
	onClose: () => void
}) {
	const { t } = useLingui()
	// ⌘ Enter on Apple platforms, Ctrl+Enter elsewhere.
	const sendKeys = useFormatForDisplay()('Mod+Enter')
	const root = useRouteLoaderData<typeof rootLoader>('root')
	const limits = root?.meta?.limits
	const fetcher = useFetcher<{ error?: string }>()
	const [dragging, setDragging] = useState(false)
	const insertRef = useRef<InsertAttachment | null>(null)
	const busy = fetcher.state !== 'idle'
	const error = fetcher.state === 'idle' ? fetcher.data?.error : undefined

	// A post that went through leaves the dock: the redirect has moved the page to it.
	const submitted = useRef(false)
	useEffect(() => {
		if (fetcher.state !== 'idle') {
			submitted.current = true
		} else if (submitted.current) {
			submitted.current = false
			if (fetcher.data?.error === undefined) onClose()
		}
	}, [fetcher.state, fetcher.data, onClose])

	const replyTo = target.title
	const title = t`回复 · ${replyTo}`

	return (
		<aside
			aria-label={t`创作抽屉`}
			className={`border-line bg-panel shadow-overlay animate-dock-in fixed right-4 transition-[width,height] duration-300 ease-[var(--stage-ease)] [interpolate-size:allow-keywords] bottom-0 z-40 flex flex-col overflow-hidden rounded-t-[2px] border border-b-0 max-sm:right-0 max-sm:left-0 max-sm:w-auto ${SIZE_CLASS[size]} ${
				dragging ? 'outline-accent outline-2 -outline-offset-2' : ''
			}`}
			onDragOver={(event) => {
				if (size === 'min') return
				if (
					event.dataTransfer.types.includes('text/uri-list') ||
					event.dataTransfer.types.includes('text/plain')
				) {
					event.preventDefault()
					setDragging(true)
				}
			}}
			onDragLeave={(event) => {
				const next = event.relatedTarget
				if (!(next instanceof Node) || !event.currentTarget.contains(next)) setDragging(false)
			}}
			onDrop={(event) => {
				setDragging(false)
				const link = droppedLink(
					{
						uriList: event.dataTransfer.getData('text/uri-list'),
						plain: event.dataTransfer.getData('text/plain'),
						html: event.dataTransfer.getData('text/html'),
					},
					window.location.origin,
				)
				if (link === null) return
				event.preventDefault()
				insertRef.current?.({ kind: 'link', ...link })
			}}
		>
			<header className="border-line-soft flex h-10 shrink-0 items-center gap-1 border-b pr-1 pl-3">
				<PenSquare aria-hidden size={14} className="text-ink-weak shrink-0" />
				<button
					type="button"
					className="text-ink-strong min-w-0 flex-1 cursor-pointer truncate text-left font-bold"
					onClick={() => onSize(size === 'min' ? 'half' : 'min')}
					aria-expanded={size !== 'min'}
				>
					{title}
				</button>
				<IconButton
					label={size === 'min' ? t`展开` : t`最小化`}
					size="sm"
					onPress={() => onSize(size === 'min' ? 'half' : 'min')}
				>
					<Minus aria-hidden />
				</IconButton>
				<IconButton
					label={size === 'full' ? t`半屏` : t`全屏`}
					size="sm"
					className="max-sm:hidden"
					onPress={() => onSize(toggledSize(size))}
				>
					{size === 'full' ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
				</IconButton>
				<IconButton label={t`关闭`} size="sm" onPress={onClose}>
					<X aria-hidden />
				</IconButton>
			</header>
			{/* Hidden, not unmounted, while minimised, so the draft stays in the editor. */}
			<fetcher.Form
				method="post"
				action={target.action}
				className={`min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 ${size === 'min' ? 'hidden' : 'flex'}`}
			>
				<input type="hidden" name="intent" value="reply" />
				<FormError message={error} />
				<Composer
					label={t`回复内容`}
					hideLabel
					required
					maxLength={limits?.postBodyMax}
					rows={size === 'full' ? 18 : 8}
					autoFocus
					insertRef={insertRef}
					fill
					draftKey={`reply:${target.threadId}`}
				/>
				<div className="flex shrink-0 items-center justify-between gap-2">
					<span className="text-ink-weak text-meta max-sm:hidden">{t`${sendKeys} 回复`}</span>
					<Button tone="primary" type="submit" isPending={busy} className="ml-auto">
						{t({ message: '回复', context: 'verb' })}
					</Button>
				</div>
			</fetcher.Form>
		</aside>
	)
}
