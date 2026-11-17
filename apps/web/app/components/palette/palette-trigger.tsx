import { Search } from 'lucide-react'
import { useSyncExternalStore } from 'react'

import { IconButton } from '../ui/button'
import { usePalette } from './command-palette'

const subscribeNothing = () => () => {}

/** ⌘ on Apple platforms, Ctrl elsewhere; the server renders Ctrl and the browser corrects it. */
function useModifierLabel(): string {
	return useSyncExternalStore(
		subscribeNothing,
		() => (/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'),
		() => 'Ctrl',
	)
}

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
	const { open } = usePalette()
	const modifier = useModifierLabel()
	const kbd = (
		<kbd className="border-line pointer-events-none inline-flex h-5 shrink-0 items-center rounded-[2px] border px-1 font-mono text-micro">
			{modifier} K
		</kbd>
	)
	if (variant === 'rail') {
		return (
			<button
				type="button"
				onClick={() => open()}
				aria-label="搜索或输入命令"
				aria-keyshortcuts="Control+K Meta+K /"
				title={collapsed ? '搜索或输入命令' : undefined}
				className={`hover:border-ink-weak flex h-control w-full cursor-pointer items-center gap-2 rounded-[2px] border px-2.5 text-ui ${
					active ? 'border-accent bg-selected text-ink-strong' : 'border-line bg-page text-ink-weak'
				} ${collapsed ? 'lg:max-xl:mx-auto lg:max-xl:w-10 lg:max-xl:justify-center lg:max-xl:px-0' : ''}`}
			>
				<Search aria-hidden size={16} className="shrink-0" />
				<span
					className={`min-w-0 flex-1 truncate text-left ${collapsed ? 'lg:max-xl:hidden' : ''}`}
				>
					搜索或输入命令
				</span>
				<span className={collapsed ? 'contents lg:max-xl:hidden' : 'contents'}>{kbd}</span>
			</button>
		)
	}
	return (
		<>
			<button
				type="button"
				onClick={() => open()}
				aria-label="搜索或输入命令"
				aria-keyshortcuts="Control+K Meta+K /"
				className="border-line bg-page text-ink-weak hover:border-ink-weak mr-2 flex h-control w-52 cursor-pointer items-center gap-2 rounded-[2px] border px-2.5 text-ui max-md:hidden lg:w-72"
			>
				<Search aria-hidden size={16} className="shrink-0" />
				<span className="text-ink-weak min-w-0 flex-1 truncate text-left">搜索或输入命令</span>
				{kbd}
			</button>
			<IconButton label="搜索或输入命令" className="md:hidden" onPress={() => open()}>
				<Search aria-hidden />
			</IconButton>
		</>
	)
}
