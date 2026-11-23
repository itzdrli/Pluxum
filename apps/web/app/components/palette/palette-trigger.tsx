import { useFormatForDisplay } from '@tanstack/react-hotkeys'
import { Search } from 'lucide-react'
import { useLingui } from '@lingui/react/macro'

import { IconButton } from '../ui/button'
import { usePalette } from './command-palette'

/**
 * The way into the command palette. In the top bar (phones, and pages without the rail): a
 * search-field look-alike on wider screens, an icon on phones. In the rail (`variant="rail"`, wide
 * screens): a field as wide as the rail, or an icon while the rail shows only icons; `active`
 * marks it while the search page is open, as the rail marks its other destinations.
 */
export function PaletteTrigger({
	variant = 'bar',
	collapsed = false,
	active = false,
}: {
	variant?: 'bar' | 'rail'
	collapsed?: boolean
	active?: boolean
}) {
	const { t } = useLingui()
	const label = t`搜索或输入命令`
	const { open } = usePalette()
	// ⌘ K on Apple platforms, Ctrl+K elsewhere: the server knows which from the request.
	const format = useFormatForDisplay()
	const kbd = (
		<kbd className="border-line pointer-events-none inline-flex h-5 shrink-0 items-center rounded-[2px] border px-1 font-mono text-micro">
			{format('Mod+K')}
		</kbd>
	)
	if (variant === 'rail') {
		// Folding narrows the field to a square around its magnifier; the text and the key hint fade.
		const fade = 'transition-opacity duration-200 rail-mini:opacity-0'
		return (
			<button
				type="button"
				onClick={() => open()}
				aria-label={label}
				aria-keyshortcuts="Control+K Meta+K /"
				title={collapsed ? label : undefined}
				className={`hover:border-ink-weak flex h-control w-full cursor-pointer items-center gap-2 overflow-hidden rounded-[2px] border pr-2.5 pl-[11px] text-ui whitespace-nowrap transition-[width,border-color,background-color,color] duration-300 ease-[var(--stage-ease)] active:scale-[0.97] rail-mini:w-10 ${
					active ? 'border-accent bg-selected text-ink-strong' : 'border-line bg-page text-ink-weak'
				}`}
			>
				<Search aria-hidden size={16} className="shrink-0" />
				<span className={`min-w-0 flex-1 truncate text-left ${fade}`}>{label}</span>
				<span className={`flex ${fade}`}>{kbd}</span>
			</button>
		)
	}
	return (
		<>
			<button
				type="button"
				onClick={() => open()}
				aria-label={label}
				aria-keyshortcuts="Control+K Meta+K /"
				className="border-line bg-page text-ink-weak hover:border-ink-weak mr-2 flex h-control w-52 cursor-pointer items-center gap-2 rounded-[2px] border px-2.5 text-ui max-md:hidden lg:w-72"
			>
				<Search aria-hidden size={16} className="shrink-0" />
				<span className="text-ink-weak min-w-0 flex-1 truncate text-left">{label}</span>
				{kbd}
			</button>
			<IconButton label={label} className="md:hidden" onPress={() => open()}>
				<Search aria-hidden />
			</IconButton>
		</>
	)
}
