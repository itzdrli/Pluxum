// The forum's name, blurbs and footer come from Forum Core's config (Workbench › Forum Core) through
// `/meta`. These defaults only show while the API cannot be reached.

import type { FooterDto, MetaDto, SiteDto } from '@pluxum/domain'
import type { MetaDescriptor } from 'react-router'

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

/** The extension that draws thread social cards (`@pluxum/og`). */
const OG_EXT_ID = 'forum-og'

type SocialRoot = Readonly<{ origin?: string; meta: Pick<MetaDto, 'uiSlots'> | null }> | undefined

/** Whether thread pages carry their own social card image (the og plugin is running). */
export function threadCardsAvailable(root: SocialRoot): boolean {
	return (
		root?.origin !== undefined &&
		(root.meta?.uiSlots.some((slot) => slot.slot === 'thread.social' && slot.extId === OG_EXT_ID) ??
			false)
	)
}

/** The absolute URL of a thread's social card, or undefined while none is served. */
export function threadCardUrl(root: SocialRoot, threadRef: string): string | undefined {
	if (!threadCardsAvailable(root)) return undefined
	return `${root?.origin}/api/forum/ext/${OG_EXT_ID}/files/${encodeURIComponent(threadRef)}.png`
}

/** `og:image` and its size; the site-wide image in the root layout uses the same tags. */
export function socialImageMeta(url: string): MetaDescriptor[] {
	return [
		{ property: 'og:image', content: url },
		{ property: 'og:image:width', content: '1200' },
		{ property: 'og:image:height', content: '630' },
	]
}
