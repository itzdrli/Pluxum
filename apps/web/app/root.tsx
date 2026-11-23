// First, so older engines have these APIs before any other module runs.
import './lib/polyfills'
// Self-hosted fonts (Fontsource), weights 400 and 700 only. Every face is split by unicode range
// (Latin, Latin Extended, Vietnamese, Greek, Cyrillic for Plex and JetBrains Mono; slices of the
// Han range for Noto Sans SC), so a page downloads only the slices for the characters it shows.
// Plex ships true italics for emphasis in posts; Han has no italic and keeps a slanted upright.
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/400-italic.css'
import '@fontsource/ibm-plex-sans/700.css'
import '@fontsource/ibm-plex-sans/700-italic.css'
import '@fontsource/noto-sans-sc/400.css'
import '@fontsource/noto-sans-sc/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/700.css'
import { I18nProvider } from '@lingui/react'
import { HotkeysProvider } from '@tanstack/react-hotkeys'
import { Trans, useLingui } from '@lingui/react/macro'
import { Home, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import {
	isRouteErrorResponse,
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
	useMatches,
	useRouteLoaderData,
} from 'react-router'

import type { Route } from './+types/root'
import 'lenis/dist/lenis.css'
import './app.css'
import { Shell } from './components/shell/shell'
import { useTheme } from './components/shell/theme-picker'
import { DockProvider } from './components/dock/composer-dock'
import { HoverCards } from './components/hover/hover-cards'
import { WindowSmoothScroll } from './components/stage/smooth-scroll'
import { GlobalShortcuts } from './components/shell/shortcuts'
import { ShortcutSheet } from './components/shell/shortcut-sheet'
import { PaletteProvider } from './components/palette/command-palette'
import { LightboxProvider } from './components/ui/lightbox'
import { ButtonLink } from './components/ui/button'
import { forumApi } from './lib/forum-api.server'
import { siteOf, threadCardsAvailable } from './lib/site'
import { focusFromRequest } from './lib/focus'
import { createI18n } from './lib/i18n'
import { loadMessages } from './lib/i18n.server'
import { DEFAULT_LOCALE, localeFromRequest } from './lib/locale'
import { rememberTimeZone, timeZoneFromRequest } from './lib/timezone'
import { railFromRequest } from './lib/rail'
import { isDarkTheme, themeFromRequest, themePageColor } from './lib/theme'
import { appHotkeys, platformFromRequest } from './lib/hotkeys'

// Who is browsing, what the forum allows, and the visitor's theme. Child routes read it through
// useRouteLoaderData('root').
export async function loader({ request }: Route.LoaderArgs) {
	const meta = await forumApi.meta(request)
	const forumMeta = meta.ok ? meta.value : null
	let unreadNotifications = 0
	if (
		forumMeta?.viewer.user != null &&
		forumMeta.uiSlots.some(
			(slot) => slot.slot === 'shell.actions' && slot.extId === 'forum-notifications',
		)
	) {
		const unread = await forumApi.unreadNotificationsCount(request)
		if (unread.ok) unreadNotifications = unread.value.count
	}
	// The shell still renders when the API is down; the page below reports the failure itself.
	const locale = localeFromRequest(request)
	return {
		meta: forumMeta,
		unreadNotifications,
		locale,
		timeZone: timeZoneFromRequest(request),
		// The whole catalog rides along with the document, so the browser hydrates in the same
		// language the server rendered. Switching language revalidates this loader.
		messages: await loadMessages(locale),
		theme: themeFromRequest(request, forumMeta?.site.defaultTheme),
		rail: railFromRequest(request),
		focusReading: focusFromRequest(request),
		// Shortcut labels (⌘ K or Ctrl K) render the same on the server and after hydration.
		platform: platformFromRequest(request),
		// Social cards need an absolute image URL; behind the TLS proxy request.url says http://.
		origin: process.env.FORUM_WEB_PUBLIC_ORIGIN || new URL(request.url).origin,
	}
}

function hasSocialImage(handle: unknown): boolean {
	return typeof handle === 'object' && handle !== null && 'socialImage' in handle
}

export function Layout({ children }: { children: React.ReactNode }) {
	const theme = useTheme()
	// Routes' own meta() replaces the root's, so the site-wide social card is written here.
	const root = useRouteLoaderData<typeof loader>('root')
	const origin = root?.origin
	const site = siteOf(root)
	// A route whose handle says `socialImage` writes its own og:image while cards are served.
	const matches = useMatches()
	const ownImage =
		threadCardsAvailable(root) &&
		matches.some((match) => hasSocialImage(match.handle) && match.loaderData !== undefined)
	const locale = root?.locale ?? DEFAULT_LOCALE
	// Without a root loader result (it failed) the source language, Chinese, is shown as written.
	const i18n = useMemo(() => createI18n(locale, root?.messages), [locale, root?.messages])
	return (
		// HeroUI picks its light or dark base from the class; app.css maps every colour from data-theme.
		<html lang={locale} data-theme={theme} className={isDarkTheme(theme) ? 'dark' : 'light'}>
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<meta property="og:site_name" content={site.name} />
				{origin !== undefined && !ownImage && (
					<>
						<meta property="og:image" content={`${origin}${site.brand.social ?? '/og.png'}`} />
						<meta property="og:image:width" content="1200" />
						<meta property="og:image:height" content="630" />
					</>
				)}
				{/* An uploaded icon replaces the built-in mark (served from public/; the SVG one
				    switches between the dark and light mark with the browser's colour scheme). */}
				{site.brand.icon !== null ? (
					<>
						<link rel="icon" href={site.brand.icon} />
						<link rel="apple-touch-icon" href={site.brand.icon} />
					</>
				) : (
					<>
						<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
						<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
					</>
				)}
				<link rel="alternate" type="application/atom+xml" href="/feed.xml" title={site.name} />
				<link rel="manifest" href="/manifest.webmanifest" />
				<meta name="theme-color" content={themePageColor(theme)} />
				<meta name="twitter:card" content="summary_large_image" />
				<Meta />
				<Links />
			</head>
			<body>
				<I18nProvider i18n={i18n}>{children}</I18nProvider>
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	)
}

export default function App({ loaderData }: Route.ComponentProps) {
	// Tells the server the visitor's time zone for its next render.
	useEffect(() => rememberTimeZone(loaderData.timeZone), [loaderData.timeZone])
	// Shows push notices and makes the forum installable; pages never depend on it.
	useEffect(() => {
		void navigator.serviceWorker?.register('/sw.js').catch(() => undefined)
	}, [])
	return (
		// A key a widget already handled (React Aria's menus and fields, the rich editor's keymap)
		// is not a shortcut as well.
		<HotkeysProvider
			appHotkeys={appHotkeys}
			defaultOptions={{ platform: loaderData.platform, hotkey: { ignoreDefaultPrevented: true } }}
		>
			<LightboxProvider>
				<DockProvider>
					<PaletteProvider>
						<GlobalShortcuts />
						<ShortcutSheet />
						<WindowSmoothScroll />
						<HoverCards />
						<Shell meta={loaderData.meta}>
							<Outlet />
						</Shell>
					</PaletteProvider>
				</DockProvider>
			</LightboxProvider>
		</HotkeysProvider>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	// Present when only a page below failed; the shell then still knows who is browsing.
	const root = useRouteLoaderData<typeof loader>('root')
	const { t } = useLingui()
	let status: number | undefined
	let details = t`发生了意外错误。`
	let stack: string | undefined
	if (isRouteErrorResponse(error)) {
		status = error.status
		// Loaders pass the forum API's own message along as the response body.
		details =
			typeof error.data === 'string' && error.data !== ''
				? error.data
				: error.status === 404
					? t`页面不存在。`
					: details
	} else if (import.meta.env.DEV && error instanceof Error) {
		details = error.message
		stack = error.stack
	}
	return (
		<Shell meta={root?.meta ?? null}>
			<div className="flex flex-col items-center gap-3 py-16 text-center">
				<TriangleAlert aria-hidden size={24} className="text-ink-weak" strokeWidth={1.75} />
				<h1 className="text-ink-strong text-[32px] leading-none font-bold tabular-nums">
					{status ?? t`出错了`}
				</h1>
				<p className="text-ink max-w-md">{details}</p>
				<ButtonLink to="/" tone="secondary" className="mt-2">
					<Home aria-hidden />
					<Trans>返回首页</Trans>
				</ButtonLink>
			</div>
			{stack !== undefined && (
				<pre className="border-line bg-panel text-ink-weak mt-4 overflow-x-auto rounded-[2px] border p-4 font-mono text-meta">
					<code>{stack}</code>
				</pre>
			)}
		</Shell>
	)
}
