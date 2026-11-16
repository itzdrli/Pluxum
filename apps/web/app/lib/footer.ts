// What the site footer shows. Edit this file to add links; the footer lays itself out from it.
//
//   groups  columns of text links with a heading ("社区", "文档", ...), shown on the left.
//           Empty: the footer stays one compact row.
//   icons   icon-only links on the bottom right (repo, chat, feed, ...). `icon` is one of
//           FOOTER_ICONS in @pluxum/domain; site-footer.tsx draws each.
//   notes   short lines in the bottom row: licence, filing number, copyright, ...
//
// Links starting with `/` stay in the forum; anything else opens in a new tab.
//
// Plugins add their own links from the backend with `core.registerFooterLinks(...)`; they arrive
// in `/meta` and `mergeFooter` puts them after the ones here.

import type { FooterDto, FooterIcon } from '@pluxum/domain'

export type { FooterIcon }

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

/**
 * This file's footer with the plugins' links from `/meta` added: a plugin column whose title
 * matches one here joins it, and an icon link repeating an href shown already is dropped.
 */
export function mergeFooter(base: FooterConfig, fromPlugins: FooterDto | undefined): FooterConfig {
	if (fromPlugins === undefined) return base
	const groups = base.groups.map((group) => ({ ...group, links: [...group.links] }))
	for (const group of fromPlugins.groups) {
		const existing = groups.find((candidate) => candidate.title === group.title)
		if (existing === undefined) groups.push({ title: group.title, links: [...group.links] })
		else existing.links.push(...group.links)
	}
	const icons = [...base.icons]
	for (const icon of fromPlugins.icons) {
		if (!icons.some((existing) => existing.href === icon.href)) icons.push(icon)
	}
	return { ...base, groups, icons }
}
