import { useLingui } from '@lingui/react/macro'
import { useRevalidator } from 'react-router'

import { isLocaleId, LOCALES, localeCookie, type LocaleId } from '../../lib/locale'

export function rememberLocale(id: LocaleId) {
	// oxlint-disable-next-line unicorn/no-document-cookie -- the locale cookie is meant to be readable and writable here.
	document.cookie = localeCookie(id)
}

/**
 * The interface languages as a row of buttons. Choosing one writes the cookie in the browser and
 * revalidates the root loader, which then sends the new catalog; the server reads the same cookie
 * on the next request, so server-rendered pages come out in the chosen language.
 */
export function LocaleSwitcher({ className }: { className?: string }) {
	const { t, i18n } = useLingui()
	const revalidator = useRevalidator()
	const current = isLocaleId(i18n.locale) ? i18n.locale : null

	function choose(id: LocaleId) {
		if (id === current) return
		rememberLocale(id)
		void revalidator.revalidate()
	}

	return (
		<div
			role="group"
			aria-label={t`语言`}
			className={`text-meta flex items-center gap-1 ${className ?? ''}`}
		>
			{LOCALES.map((locale) => {
				const selected = locale.id === current
				return (
					<button
						key={locale.id}
						type="button"
						lang={locale.id}
						aria-pressed={selected}
						aria-label={locale.short}
						title={locale.short}
						onClick={() => choose(locale.id)}
						className={`cursor-pointer min-w-7 rounded-[2px] border px-1.5 py-0.5 text-center transition-colors ${
							selected
								? 'border-accent text-ink-strong'
								: 'border-line text-ink-weak hover:border-ink-weak hover:text-ink-strong'
						}`}
					>
						{locale.short}
					</button>
				)
			})}
		</div>
	)
}
