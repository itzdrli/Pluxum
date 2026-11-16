import { Link2, Mail, Rss } from 'lucide-react'
import type { ComponentType } from 'react'
import { Link, useRouteLoaderData } from 'react-router'

import { isInternalHref, type FooterIcon, type FooterLink } from '../../lib/footer'
import { footerOf, siteOf } from '../../lib/site'
import type { loader as rootLoader } from '../../root'
import { LogoMark } from './logo-mark'
import { ThemeSwatches } from './theme-picker'

/** The GitHub mark; lucide no longer ships brand icons. */
function GithubIcon({ size = 16 }: { size?: number }) {
	return (
		<svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
			<path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.4-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
		</svg>
	)
}

/** How each of FOOTER_ICONS (@pluxum/domain) is drawn. */
const FOOTER_ICONS: Record<FooterIcon, ComponentType<{ size?: number }>> = {
	github: GithubIcon,
	rss: Rss,
	mail: Mail,
	link: Link2,
}

function FooterAnchor({
	link,
	className,
	children,
	...rest
}: {
	link: FooterLink
	className: string
	children: React.ReactNode
	'aria-label'?: string
	title?: string
}) {
	if (isInternalHref(link.href)) {
		return (
			<Link to={link.href} className={className} {...rest}>
				{children}
			</Link>
		)
	}
	return (
		<a href={link.href} target="_blank" rel="noreferrer" className={className} {...rest}>
			{children}
		</a>
	)
}

/**
 * The footer folded into the category rail of the split stage (which has no page footer): flat
 * links, then theme swatches and icon links, then the notes. Pinned to the rail's bottom.
 */
export function SiteFooterCompact() {
	const root = useRouteLoaderData<typeof rootLoader>('root')
	const { name } = siteOf(root)
	const { groups, icons, notes, siteLinks: showSiteLinks } = footerOf(root)
	const links = [
		...(showSiteLinks && root?.meta?.search.available === true
			? [{ label: '搜索', href: '/search' }]
			: []),
		...groups.flatMap((group) => group.links),
	]
	return (
		<footer className="border-line-soft text-ink-weak text-meta flex shrink-0 flex-col gap-2 border-t px-3 py-3">
			{links.length > 0 && (
				<ul className="flex flex-wrap gap-x-3 gap-y-1.5">
					{links.map((link) => (
						<li key={`${link.label} ${link.href}`}>
							<FooterAnchor link={link} className="hover:text-ink-strong hover:underline">
								{link.label}
							</FooterAnchor>
						</li>
					))}
				</ul>
			)}
			<div className="flex items-center justify-between gap-2">
				<p className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5">
					<span>© {name}</span>
					{notes.map((note) => (
						<span key={note}>{note}</span>
					))}
				</p>
				{icons.length > 0 && (
					<ul className="-my-1.5 -mr-1.5 flex shrink-0 items-center">
						{icons.map((link) => {
							const Icon = FOOTER_ICONS[link.icon]
							return (
								<li key={link.href}>
									<FooterAnchor
										link={link}
										aria-label={link.label}
										title={link.label}
										className="hover:bg-hover hover:text-ink-strong size-control-sm flex items-center justify-center rounded-[2px]"
									>
										<Icon size={14} />
									</FooterAnchor>
								</li>
							)
						})}
					</ul>
				)}
			</div>
		</footer>
	)
}

/**
 * Under every page that scrolls. Its content is Forum Core's site and footer config plus the links
 * running plugins add (both in `/meta`). Top: the brand with its tagline on the left, link columns
 * on the right (the optional built-in "站内" column first, then the configured ones). Bottom bar: copyright
 * and notes, then theme swatches and icon links.
 */
export function SiteFooter() {
	const root = useRouteLoaderData<typeof rootLoader>('root')
	const { name, tagline } = siteOf(root)
	const { groups, icons, notes, siteLinks: showSiteLinks } = footerOf(root)
	const searchAvailable = root?.meta?.search.available === true
	const siteLinks: FooterLink[] = [
		{ label: '版块', href: '/' },
		...(searchAvailable ? [{ label: '搜索', href: '/search' }] : []),
	]
	const columns = showSiteLinks ? [{ title: '站内', links: siteLinks }, ...groups] : groups

	return (
		<footer className="border-line bg-panel border-t">
			<div className="mx-auto flex w-full max-w-[1760px] flex-col gap-8 px-4 py-8 lg:px-6">
				<div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between md:gap-12">
					<div className="flex max-w-sm min-w-0 flex-col gap-3">
						<div className="flex items-center gap-2.5">
							<LogoMark className="size-6 shrink-0" />
							<span className="text-ink-strong text-title font-bold">{name}</span>
						</div>
						{tagline !== '' && <p className="text-ink-weak text-ui leading-relaxed">{tagline}</p>}
					</div>
					<nav
						aria-label="页脚链接"
						className="grid grid-cols-2 gap-x-10 gap-y-6 sm:grid-cols-3 md:flex md:gap-x-16"
					>
						{columns.map((group) => (
							<div key={group.title} className="flex min-w-24 flex-col gap-3">
								<h2 className="section-label">{group.title}</h2>
								<ul className="flex flex-col gap-2">
									{group.links.map((link) => (
										<li key={`${link.label} ${link.href}`}>
											<FooterAnchor
												link={link}
												className="text-ink hover:text-ink-strong text-ui hover:underline"
											>
												{link.label}
											</FooterAnchor>
										</li>
									))}
								</ul>
							</div>
						))}
					</nav>
				</div>
				<div className="border-line text-ink-weak text-meta flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t pt-5">
					<p className="flex flex-wrap items-center gap-x-4 gap-y-1">
						<span>© {name}</span>
						{notes.map((note) => (
							<span key={note}>{note}</span>
						))}
					</p>
					<div className="flex items-center gap-4">
						{/* Phones switch theme from the user menu; the footer stays quiet. */}
						<div className="hidden md:block">
							<ThemeSwatches />
						</div>
						{icons.length > 0 && (
							<ul className="-mr-2 flex items-center gap-1">
								{icons.map((link) => {
									const Icon = FOOTER_ICONS[link.icon]
									return (
										<li key={link.href}>
											<FooterAnchor
												link={link}
												aria-label={link.label}
												title={link.label}
												className="text-ink-weak hover:bg-hover hover:text-ink-strong size-control flex items-center justify-center rounded-[2px]"
											>
												<Icon size={16} />
											</FooterAnchor>
										</li>
									)
								})}
							</ul>
						)}
					</div>
				</div>
			</div>
		</footer>
	)
}
