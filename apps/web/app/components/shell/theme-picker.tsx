import { Popover } from '@heroui/react'
import { Check, Palette } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
import { useRouteLoaderData } from 'react-router'

import { DEFAULT_THEME, THEMES, themeCookie, type ThemeId } from '../../lib/theme'
import type { loader as rootLoader } from '../../root'
import { IconButton } from '../ui/button'

/*
 * The theme chosen in this tab. Choosing one writes the cookie in the browser (the server reads
 * it on the next request, so server-rendered pages come out right) and switches the page at once.
 * No request is involved, so a refused or failed request can never leave the picker stuck.
 */
let chosenTheme: ThemeId | null = null
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

function chooseTheme(theme: ThemeId) {
	// oxlint-disable-next-line unicorn/no-document-cookie -- the theme cookie is meant to be readable and writable here.
	document.cookie = themeCookie(theme)
	chosenTheme = theme
	for (const listener of listeners) listener()
}

/** The theme to render: the one chosen in this tab, else the cookie's. */
export function useTheme(): ThemeId {
	const fromCookie = useRouteLoaderData<typeof rootLoader>('root')?.theme ?? DEFAULT_THEME
	const chosen = useSyncExternalStore(
		subscribe,
		() => chosenTheme,
		() => null,
	)
	return chosen ?? fromCookie
}

/** A small preview of a theme: page, panel and accent, drawn by the theme's own variables. */
function Swatch({ theme }: { theme: ThemeId }) {
	return (
		<span
			data-theme={theme}
			aria-hidden
			className="bg-page border-line flex size-6 shrink-0 items-end gap-px overflow-hidden rounded-[2px] border p-0.5"
		>
			<span className="bg-panel h-full flex-1" />
			<span className="bg-accent h-2/3 flex-1" />
		</span>
	)
}

export function ThemePicker() {
	const current = useTheme()
	const [open, setOpen] = useState(false)
	return (
		<Popover isOpen={open} onOpenChange={setOpen}>
			<IconButton label="切换主题">
				<Palette aria-hidden />
			</IconButton>
			<Popover.Content placement="bottom end" className="w-52 p-1">
				<Popover.Dialog aria-label="主题" className="outline-none">
					<p className="section-label px-2 pt-1.5 pb-1">主题</p>
					<div role="group" aria-label="主题" className="flex flex-col">
						{THEMES.map((theme) => {
							const selected = theme.id === current
							return (
								<button
									key={theme.id}
									type="button"
									aria-pressed={selected}
									onClick={() => {
										chooseTheme(theme.id)
										setOpen(false)
									}}
									className={`flex h-9 items-center gap-2.5 rounded-[2px] px-2 text-left ${selected ? 'bg-selected text-ink-strong' : 'text-ink hover:bg-hover active:bg-pressed'}`}
								>
									<Swatch theme={theme.id} />
									<span className="flex-1">{theme.label}</span>
									<span className="text-ink-weak text-[12px]">{theme.dark ? '暗' : '亮'}</span>
									<Check aria-hidden size={14} className={selected ? 'text-accent' : 'invisible'} />
								</button>
							)
						})}
					</div>
				</Popover.Dialog>
			</Popover.Content>
		</Popover>
	)
}
