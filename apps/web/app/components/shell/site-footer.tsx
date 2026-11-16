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
 * Under every page that scrolls. Its content is Forum Core's site and footer config plus the links
 * running plugins add (both in `/meta`): brand and tagline, optional link columns, then a bottom
 * row with notes, theme swatches and icon links.
 */
export function SiteFooter() {
	const root = useRouteLoaderData<typeof rootLoader>('root')
	const { name, tagline } = siteOf(root)
	const { groups, icons, notes } = footerOf(root)
	const brand = (
		<div className="flex min-w-0 items-center gap-2.5">
			<LogoMark className="size-5 shrink-0" />
			<span className="text-ink-strong font-bold">{name}</span>
			{tagline !== '' && <span className="text-ink-weak text-meta">{tagline}</span>}
		</div>
	)
	const tools = (
		<div className="flex items-center gap-4">
			{/* Phones switch theme from the user menu; the footer stays quiet. */}
			<div className="hidden md:block">
				<ThemeSwatches />
			</div>
			{icons.length > 0 && (
				<ul className="flex items-center gap-1">
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
	)
	const noteLine =
		notes.length > 0 ? (
			<p className="text-ink-weak flex flex-wrap gap-x-3 gap-y-1 text-meta">
				{notes.map((note) => (
					<span key={note}>{note}</span>
				))}
			</p>
		) : null

	return (
		<footer className="border-line bg-panel border-t">
			<div className="mx-auto w-full max-w-[1760px] px-4 py-5 lg:px-6">
				{groups.length === 0 ? (
					// Nothing but the brand and the tools: one compact row.
					<div className="flex flex-col gap-3">
						<div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
							{brand}
							{tools}
						</div>
						{noteLine}
					</div>
				) : (
					<div className="flex flex-col gap-6">
						<div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
							{brand}
							<nav
								aria-label="页脚链接"
								className="grid grid-cols-2 gap-x-10 gap-y-6 sm:grid-cols-3 md:flex"
							>
								{groups.map((group) => (
									<div key={group.title} className="flex min-w-24 flex-col gap-2">
										<h2 className="section-label">{group.title}</h2>
										<ul className="flex flex-col gap-1.5">
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
						<div className="border-line flex flex-wrap items-center justify-between gap-3 border-t pt-4">
							{noteLine ?? <span />}
							{tools}
						</div>
					</div>
				)}
			</div>
		</footer>
	)
}
