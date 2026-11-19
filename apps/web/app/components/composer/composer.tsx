import type { PreviewDto } from '@pluxum/domain'
import { Label, TextArea, TextField } from '@heroui/react'
import { Code, Type } from 'lucide-react'
import type { Extensions } from '@tiptap/core'
import { useEffect, useRef, useState } from 'react'
import { useRouteLoaderData } from 'react-router'
import { useLingui } from '@lingui/react/macro'

import type { loader as rootLoader } from '../../root'
import {
	ComposerToolbarSlots,
	useComposerEditorExtensions,
	type InsertAttachment,
} from '../../slots/slots'

type RichModule = typeof import('./rich-editor')

type Mode = 'source' | 'rich'

// Remembers a visitor who prefers writing Markdown by hand.
const MODE_KEY = 'forum_composer_mode'

function preferredMode(): Mode | null {
	try {
		const stored = window.localStorage.getItem(MODE_KEY)
		return stored === 'source' || stored === 'rich' ? stored : null
	} catch {
		return null
	}
}

function rememberMode(mode: Mode): void {
	try {
		window.localStorage.setItem(MODE_KEY, mode)
	} catch {
		// Storage can be unavailable (private windows); the choice then lasts for this box only.
	}
}

// The editor module once it has been loaded, so that boxes mounted later (the next reply, an
// edit) can start in rich mode at once instead of showing the textarea for a moment first.
let loadedRich: RichModule | null = null

/** Pure check for whether a composer box should start directly in rich mode on mount. */
export function shouldStartRich({
	format,
	hasRichModule,
	sourcePreferred,
	deferRich,
}: {
	format: string
	source?: string
	hasRichModule: boolean
	sourcePreferred: boolean
	deferRich: boolean
}): boolean {
	return !deferRich && hasRichModule && format === 'markdown' && !sourcePreferred
}

/** The mode a box can start in without waiting. Before the editor is loaded (or when deferred) that is the source. */
function initialMode(format: string, source: string, deferRich: boolean): Mode {
	const currentRich = loadedRich
	if (
		currentRich === null ||
		!shouldStartRich({
			format,
			source,
			hasRichModule: true,
			sourcePreferred: preferredMode() === 'source',
			deferRich,
		})
	) {
		return 'source'
	}
	if (source.trim() === '') return 'rich'
	try {
		return currentRich.roundTrip(source) === source ? 'rich' : 'source'
	} catch {
		return 'source'
	}
}

/** The forum's rendering of a body that is not saved yet, or null when it cannot be had. */
async function renderedHtmlOf(body: string, signal: AbortSignal): Promise<string | null> {
	try {
		const response = await fetch('/api/forum/preview', {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json' },
			body: JSON.stringify({ body }),
			signal,
		})
		if (!response.ok) return null
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- forum-api validates this response against the schema PreviewDto mirrors.
		const preview = (await response.json()) as PreviewDto
		return preview.bodyHtml
	} catch {
		return null
	}
}

/**
 * Whether the rich editor can take over this source without changing how the post looks. The
 * editor rewrites Markdown in its own style, which is fine while the rendered HTML stays the
 * same; syntax it does not know (tables, images, raw HTML) would be lost, and such a post is
 * better edited as source.
 */
async function fitsRichEditor(
	rich: RichModule,
	extra: Extensions,
	source: string,
	renderedHtml: string | undefined,
	signal: AbortSignal,
): Promise<boolean> {
	if (source.trim() === '') return true
	let rewritten: string
	try {
		rewritten = rich.roundTrip(source, extra)
	} catch {
		return false
	}
	if (rewritten === source) return true
	if (renderedHtml === undefined) return false
	return (await renderedHtmlOf(rewritten, signal)) === renderedHtml
}

/**
 * The text box for a post body. The server renders a plain textarea, so posting works without
 * JavaScript. In the browser, while posts are rendered as Markdown, a rich-text editor is loaded
 * on demand and takes the textarea's place; it writes Markdown into the same form field. The
 * visitor can switch between the editor and the Markdown source at any time.
 */
export function Composer({
	name = 'body',
	label,
	hideLabel = false,
	required,
	maxLength,
	defaultValue = '',
	renderedHtml,
	rows = 6,
	placeholder,
	autoFocus = false,
	deferRich = false,
	insertRef,
	fill = false,
}: {
	name?: string
	label: string
	hideLabel?: boolean
	required?: boolean
	maxLength?: number
	/** The saved source when editing an existing post. */
	defaultValue?: string
	/** How the forum renders `defaultValue`, to tell whether the rich editor would change it. */
	renderedHtml?: string
	rows?: number
	placeholder?: string
	autoFocus?: boolean
	/** Defer Tiptap instantiation to idle / focus so rapid route switches stay instant. */
	deferRich?: boolean
	/** Receives the box's insert function, so something outside it (a drop) can put a link in. */
	insertRef?: React.RefObject<InsertAttachment | null>
	/** Grow the writing area into the height of a flex column around it (the dock). */
	fill?: boolean
}) {
	const { t } = useLingui()
	const format = useRouteLoaderData<typeof rootLoader>('root')?.meta?.content.format ?? 'plain'
	const [value, setValue] = useState(defaultValue)
	// On the first page load (or when deferred) nothing is mounted as rich yet.
	const [mode, setMode] = useState<Mode>(() => initialMode(format, defaultValue, deferRich))
	const [rich, setRich] = useState<RichModule | null>(loadedRich)
	const editorExtensions = useComposerEditorExtensions()
	// What running extensions add to the editor, once loaded together with it.
	const [extra, setExtra] = useState<Readonly<{ key: string; extensions: Extensions }> | null>(null)
	// False once the rich editor is known to change how the saved source renders.
	const [fits, setFits] = useState(true)
	const [focusOnUpgrade, setFocusOnUpgrade] = useState(false)
	const root = useRef<HTMLDivElement>(null)
	const triggerUpgradeRef = useRef<(() => void) | null>(null)
	const latest = useRef(value)
	useEffect(() => {
		latest.current = value
	}, [value])

	useEffect(() => {
		// Formatting exists only while posts are rendered as Markdown.
		if (format !== 'markdown') return undefined
		const abort = new AbortController()
		let started = false
		let cancelIdle: (() => void) | null = null

		const runUpgrade = () => {
			if (started || abort.signal.aborted) return
			started = true
			cancelIdle?.()
			cancelIdle = null
			void (async () => {
				let loaded: RichModule
				let extensions: Extensions
				try {
					;[loaded, extensions] = await Promise.all([
						loadedRich ?? import('./rich-editor'),
						editorExtensions.load(),
					])
				} catch {
					// Without the editor the textarea simply stays.
					return
				}
				loadedRich = loaded
				if (abort.signal.aborted) return
				setExtra({ key: editorExtensions.key, extensions })
				setRich(loaded)
				const suits = await fitsRichEditor(
					loaded,
					extensions,
					defaultValue,
					renderedHtml,
					abort.signal,
				)
				if (abort.signal.aborted) return
				setFits(suits)
				// Take over only a box the visitor has not started typing in.
				if (suits && preferredMode() !== 'source' && latest.current === defaultValue) {
					setMode('rich')
				}
			})()
		}

		triggerUpgradeRef.current = runUpgrade

		if (!deferRich) {
			runUpgrade()
		} else if (typeof window.requestIdleCallback === 'function') {
			const handle = window.requestIdleCallback(() => runUpgrade())
			cancelIdle = () => window.cancelIdleCallback(handle)
		} else {
			const handle = window.setTimeout(runUpgrade, 80)
			cancelIdle = () => window.clearTimeout(handle)
		}

		return () => {
			triggerUpgradeRef.current = null
			cancelIdle?.()
			abort.abort()
		}
	}, [format, defaultValue, renderedHtml, deferRich, editorExtensions])

	function choose(next: Mode) {
		rememberMode(next)
		setMode(next)
	}

	function submit() {
		root.current?.closest('form')?.requestSubmit()
	}

	const showRich = mode === 'rich' && rich !== null && extra !== null && format === 'markdown'

	// Set by the rich editor while it is shown.
	const richInsert = useRef<InsertAttachment | null>(null)

	/** Puts an uploaded file where the visitor is writing; extension toolbar buttons call this. */
	const insert: InsertAttachment = (item) => {
		if (showRich && richInsert.current !== null) {
			richInsert.current(item)
			return
		}
		const shown = item.text.replaceAll(/[[\]\\]/g, '\\$&')
		const markdown = `${item.kind === 'image' ? '!' : ''}[${shown}](${item.href})`
		const area = root.current?.querySelector('textarea')
		const current = latest.current
		const start = area?.selectionStart ?? current.length
		const end = area?.selectionEnd ?? current.length
		const before = current.slice(0, start)
		const spaced = before === '' || /\s$/.test(before) ? markdown : ` ${markdown}`
		const next = `${before}${spaced} ${current.slice(end)}`
		latest.current = next
		setValue(next)
		const caret = before.length + spaced.length + 1
		requestAnimationFrame(() => {
			area?.focus()
			area?.setSelectionRange(caret, caret)
		})
	}

	useEffect(() => {
		if (insertRef) insertRef.current = insert
		return () => {
			if (insertRef) insertRef.current = null
		}
	})

	const tools = <ComposerToolbarSlots insert={insert} />

	const showCount = maxLength !== undefined && value.length > maxLength * 0.8
	const hint =
		format !== 'markdown' || showRich
			? undefined
			: fits
				? t`支持 Markdown`
				: t`含表格或图片，切到富文本会改变它们。`

	const toggle = rich !== null && format === 'markdown' && (
		<button
			type="button"
			className="button button--ghost button--sm text-ink-weak ml-auto"
			onClick={() => choose(showRich ? 'source' : 'rich')}
		>
			{showRich ? <Code aria-hidden /> : <Type aria-hidden />}
			{showRich ? t`Markdown 源码` : t`富文本`}
		</button>
	)

	return (
		<div ref={root} className={`flex flex-col gap-1${fill ? ' composer-fill' : ''}`}>
			{showRich ? (
				<>
					<div className="flex min-h-7 items-center gap-2">
						{!hideLabel && <span className="label">{label}</span>}
						{tools}
						{toggle}
					</div>
					<input type="hidden" name={name} value={value} />
					<rich.RichEditor
						// A different set of extensions needs a new editor; it starts from the text so far.
						key={extra.key}
						extensions={extra.extensions}
						initial={value}
						label={label}
						placeholder={placeholder}
						rows={rows}
						autoFocus={autoFocus || focusOnUpgrade}
						onChange={(next) => {
							latest.current = next
							setValue(next)
						}}
						onSubmit={submit}
						insertRef={richInsert}
					/>
				</>
			) : (
				<TextField
					name={name}
					isRequired={required}
					maxLength={maxLength}
					value={value}
					onChange={(next) => {
						latest.current = next
						setValue(next)
					}}
					fullWidth
				>
					<div className="flex min-h-7 items-center gap-2 empty:hidden">
						<Label className={hideLabel ? 'sr-only' : undefined}>{label}</Label>
						{tools}
						{toggle}
					</div>
					<TextArea
						rows={rows}
						placeholder={placeholder}
						autoFocus={autoFocus}
						className={format === 'markdown' ? 'font-mono' : undefined}
						onFocus={() => {
							if (
								deferRich &&
								mode === 'source' &&
								format === 'markdown' &&
								preferredMode() !== 'source'
							) {
								setFocusOnUpgrade(true)
								triggerUpgradeRef.current?.()
							}
						}}
						onBlur={() => {
							setFocusOnUpgrade(false)
						}}
						onKeyDown={(event) => {
							if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
								event.preventDefault()
								submit()
							}
						}}
					/>
				</TextField>
			)}
			{(hint !== undefined || showCount) && (
				<div className="text-ink-weak flex items-start justify-between gap-3 text-meta">
					<span>{hint}</span>
					{showCount && (
						<span className="tabular-nums" aria-live="polite">
							{value.length} / {maxLength}
						</span>
					)}
				</div>
			)}
		</div>
	)
}
