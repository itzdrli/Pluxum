import { useLingui } from '@lingui/react/macro'
import { useSyncExternalStore } from 'react'
import { useRouteLoaderData } from 'react-router'

import { DEFAULT_THEME, THEMES, themeCookie, type ThemeId } from '../../lib/theme'
import { withThemeReveal } from '../../lib/view-transition'
import type { loader as rootLoader } from '../../root'

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

export function chooseTheme(theme: ThemeId) {
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

/**
 * The themes as a row of swatches, each one a button that switches at once: no popover to open
 * first. Each swatch draws its own theme (page, panel, accent) through `data-theme` on itself.
 * Lives in the footer and the account menu, not the top bar.
 */
export function ThemeSwatches({ className }: { className?: string }) {
	const current = useTheme()
	const { t } = useLingui()
	return (
		<div
			role="group"
			aria-label={t`主题`}
			className={`flex items-center gap-1.5 ${className ?? ''}`}
		>
			{THEMES.map((theme) => {
				const selected = theme.id === current
				const label = theme.label
				const mode = theme.dark ? t`暗色` : t`亮色`
				return (
					<button
						key={theme.id}
						type="button"
						data-theme={theme.id}
						aria-pressed={selected}
						aria-label={t`${label}（${mode}）`}
						title={theme.label}
						onClick={(event) => {
							if (selected) return
							const box = event.currentTarget.getBoundingClientRect()
							withThemeReveal(() => chooseTheme(theme.id), {
								x: box.left + box.width / 2,
								y: box.top + box.height / 2,
							})
						}}
						className={`bg-page flex size-6 shrink-0 cursor-pointer items-end gap-px overflow-hidden rounded-[2px] border p-0.5 transition-[border-color,outline-color,scale] hover:scale-110 active:scale-95 ${
							selected
								? 'border-accent outline-accent outline-1 outline-offset-1'
								: 'border-line hover:border-ink-weak'
						}`}
					>
						<span aria-hidden className="bg-panel h-full flex-1" />
						<span aria-hidden className="bg-accent h-2/3 flex-1" />
					</button>
				)
			})}
		</div>
	)
}
