import { Popover } from '@heroui/react'
import { Check, Palette } from 'lucide-react'
import { useFetcher, useRouteLoaderData } from 'react-router'

import { DEFAULT_THEME, isThemeId, THEMES, type ThemeId } from '../../lib/theme'
import type { loader as rootLoader } from '../../root'
import { IconButton } from '../ui/button'

/** Every theme change goes through this one fetcher, so the shell can read it from anywhere. */
export const THEME_FETCHER_KEY = 'theme'

/**
 * The theme to render: one being saved right now, else the one just saved, else the cookie's.
 * Lets the page switch instantly without reloading any route data.
 */
export function useTheme(): ThemeId {
	const fetcher = useFetcher<{ theme: ThemeId | null }>({ key: THEME_FETCHER_KEY })
	const fromCookie = useRouteLoaderData<typeof rootLoader>('root')?.theme ?? DEFAULT_THEME
	const pending = fetcher.formData?.get('theme')
	if (isThemeId(pending)) return pending
	// Route data is not reloaded for a theme change, so the saved value comes from the fetcher.
	return fetcher.data?.theme ?? fromCookie
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
	const fetcher = useFetcher({ key: THEME_FETCHER_KEY })
	const current = useTheme()
	return (
		<Popover>
			<IconButton label="切换主题">
				<Palette aria-hidden />
			</IconButton>
			<Popover.Content placement="bottom end" className="w-52 p-1">
				<Popover.Dialog aria-label="主题" className="outline-none">
					<p className="section-label px-2 pt-1.5 pb-1">主题</p>
					<fetcher.Form method="post" action="/theme" className="flex flex-col">
						{THEMES.map((theme) => {
							const selected = theme.id === current
							return (
								<button
									key={theme.id}
									type="submit"
									name="theme"
									value={theme.id}
									aria-pressed={selected}
									className={`flex h-9 items-center gap-2.5 rounded-[2px] px-2 text-left ${selected ? 'bg-selected text-ink-strong' : 'text-ink hover:bg-hover active:bg-pressed'}`}
								>
									<Swatch theme={theme.id} />
									<span className="flex-1">{theme.label}</span>
									<span className="text-ink-weak text-[12px]">{theme.dark ? '暗' : '亮'}</span>
									<Check aria-hidden size={14} className={selected ? 'text-accent' : 'invisible'} />
								</button>
							)
						})}
					</fetcher.Form>
				</Popover.Dialog>
			</Popover.Content>
		</Popover>
	)
}
