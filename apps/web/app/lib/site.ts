// The forum's name, blurbs and footer come from Forum Core's config (Workbench › Forum Core) through
// `/meta`. These defaults only show while the API cannot be reached.

import type { FooterDto, MetaDto, SiteDto } from '@pluxum/domain'

export const DEFAULT_SITE: SiteDto = {
	name: 'Pluxum',
	tagline: '万物皆插件 · 基于 Pluxel',
	description: '万物皆插件的论坛',
}

export const DEFAULT_FOOTER: FooterDto = {
	groups: [],
	icons: [{ label: 'GitHub', href: 'https://github.com/itzdrli/Pluxum', icon: 'github' }],
	notes: [],
	siteLinks: false,
}

/** The root loader's data, or the part of it these helpers read. */
type RootData = Readonly<{ meta: Pick<MetaDto, 'site' | 'footer'> | null }> | undefined

export function siteOf(root: RootData): SiteDto {
	return root?.meta?.site ?? DEFAULT_SITE
}

export function footerOf(root: RootData): FooterDto {
	return root?.meta?.footer ?? DEFAULT_FOOTER
}

/** A page title ending in the site name: `title('通知', root)` → `通知 · Pluxum`. */
export function pageTitle(root: RootData, ...parts: ReadonlyArray<string | undefined>): string {
	return [...parts.filter((part) => part !== undefined && part !== ''), siteOf(root).name].join(
		' · ',
	)
}
