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
 * The top bar's way into the command palette: a search-field look-alike on wide screens (the
 * palette is where searching happens now), an icon on phones.
 */
export function PaletteTrigger() {
	const { open } = usePalette()
	const modifier = useModifierLabel()
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
				<span className="text-ink-weak/60 min-w-0 flex-1 truncate text-left">搜索或输入命令</span>
				<kbd className="border-line pointer-events-none inline-flex h-5 shrink-0 items-center rounded-[2px] border px-1 font-mono text-micro">
					{modifier} K
				</kbd>
			</button>
			<IconButton label="搜索或输入命令" className="md:hidden" onPress={() => open()}>
				<Search aria-hidden />
			</IconButton>
		</>
	)
}
