import type { PreviewDto } from '@forum/domain'
import { Label, TextArea, TextField } from '@heroui/react'
import { Code, Type } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useRouteLoaderData } from 'react-router'

import type { loader as rootLoader } from '../../root'

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

/** The mode a box can start in without waiting. Before the editor is loaded that is the source. */
function initialMode(format: string, source: string): Mode {
	if (loadedRich === null || format !== 'markdown' || preferredMode() === 'source') return 'source'
	if (source.trim() === '') return 'rich'
	try {
		return loadedRich.roundTrip(source) === source ? 'rich' : 'source'
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
	source: string,
	renderedHtml: string | undefined,
	signal: AbortSignal,
): Promise<boolean> {
	if (source.trim() === '') return true
	let rewritten: string
	try {
		rewritten = rich.roundTrip(source)
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
}) {
	const format = useRouteLoaderData<typeof rootLoader>('root')?.meta?.content.format ?? 'plain'
	const [value, setValue] = useState(defaultValue)
	// On the first page load nothing is loaded yet, so server and browser both start as source.
	const [mode, setMode] = useState<Mode>(() => initialMode(format, defaultValue))
	const [rich, setRich] = useState<RichModule | null>(loadedRich)
	// False once the rich editor is known to change how the saved source renders.
	const [fits, setFits] = useState(true)
	const root = useRef<HTMLDivElement>(null)
	const latest = useRef(value)
	useEffect(() => {
		latest.current = value
	}, [value])

	useEffect(() => {
		const abort = new AbortController()
		void (async () => {
			// Formatting exists only while posts are rendered as Markdown.
			if (format !== 'markdown') return
			let loaded: RichModule
			try {
				loaded = await import('./rich-editor')
			} catch {
				// Without the editor the textarea simply stays.
				return
			}
			loadedRich = loaded
			if (abort.signal.aborted) return
			setRich(loaded)
			const suits = await fitsRichEditor(loaded, defaultValue, renderedHtml, abort.signal)
			if (abort.signal.aborted) return
			setFits(suits)
			// Take over only a box the visitor has not started typing in.
			if (suits && preferredMode() !== 'source' && latest.current === defaultValue) setMode('rich')
		})()
		return () => abort.abort()
	}, [format, defaultValue, renderedHtml])

	function choose(next: Mode) {
		rememberMode(next)
		setMode(next)
	}

	function submit() {
		root.current?.closest('form')?.requestSubmit()
	}

	const showRich = mode === 'rich' && rich !== null && format === 'markdown'
	const showCount = maxLength !== undefined && value.length > maxLength * 0.8
	const hint =
		format !== 'markdown'
			? '目前按纯文本显示，换行会保留。'
			: showRich
				? undefined
				: fits
					? '支持 Markdown：**粗体**、`代码`、> 引用、- 列表。'
					: '这篇内容里有富文本编辑器不支持的写法（如表格、图片），切到富文本会改变它们。'

	const toggle = rich !== null && format === 'markdown' && (
		<button
			type="button"
			className="button button--ghost button--sm text-ink-weak ml-auto"
			onClick={() => choose(showRich ? 'source' : 'rich')}
		>
			{showRich ? <Code aria-hidden /> : <Type aria-hidden />}
			{showRich ? 'Markdown 源码' : '富文本'}
		</button>
	)

	return (
		<div ref={root} className="flex flex-col gap-1">
			{showRich ? (
				<>
					<div className="flex min-h-7 items-end gap-2">
						{!hideLabel && <span className="label">{label}</span>}
						{toggle}
					</div>
					<input type="hidden" name={name} value={value} />
					<rich.RichEditor
						initial={value}
						label={label}
						placeholder={placeholder}
						rows={rows}
						autoFocus={autoFocus}
						onChange={setValue}
						onSubmit={submit}
					/>
				</>
			) : (
				<TextField
					name={name}
					isRequired={required}
					maxLength={maxLength}
					value={value}
					onChange={setValue}
					fullWidth
				>
					<div className="flex min-h-7 items-end gap-2 empty:hidden">
						<Label className={hideLabel ? 'sr-only' : undefined}>{label}</Label>
						{toggle}
					</div>
					<TextArea
						rows={rows}
						placeholder={placeholder}
						autoFocus={autoFocus}
						className={format === 'markdown' ? 'font-mono' : undefined}
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
				<div className="text-ink-weak flex items-start justify-between gap-3 text-[12px]">
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
