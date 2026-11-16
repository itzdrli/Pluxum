// What the site footer shows. Edit this file to add links; the footer lays itself out from it.
//
//   groups  columns of text links with a heading ("社区", "文档", ...), shown on the left.
//           Empty: the footer stays one compact row.
//   icons   icon-only links on the bottom right (repo, chat, feed, ...). `icon` names one in
//           FOOTER_ICONS (components/shell/site-footer.tsx); add an entry there for a new one.
//   notes   short lines in the bottom row: licence, filing number, copyright, ...
//
// Links starting with `/` stay in the forum; anything else opens in a new tab.

export type FooterIcon = 'github' | 'rss' | 'mail'

export type FooterLink = Readonly<{ label: string; href: string }>

export type FooterGroup = Readonly<{ title: string; links: readonly FooterLink[] }>

export type FooterConfig = Readonly<{
	tagline: string
	groups: readonly FooterGroup[]
	icons: ReadonlyArray<FooterLink & { icon: FooterIcon }>
	notes: readonly string[]
}>

export const FOOTER: FooterConfig = {
	tagline: '万物皆插件 · 基于 Pluxel',
	groups: [],
	icons: [{ label: 'GitHub', href: 'https://github.com/itzdrli/Pluxum', icon: 'github' }],
	notes: [],
}

export function isInternalHref(href: string): boolean {
	return href.startsWith('/') && !href.startsWith('//')
}
