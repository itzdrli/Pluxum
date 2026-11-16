import {
	isFooterIcon,
	type FooterIcon,
	type FooterLinkDto,
	type FooterLinksDto,
} from '@pluxum/domain'
import { CONTRIBUTION_ID } from './policies'

/**
 * Links a plugin puts in the site footer while it runs. Plain data: the frontend draws them, so
 * a plugin needs no frontend code of its own.
 */
export type FooterLinkContribution = Readonly<{
	/** The contributor's ID, e.g. `forum-docs`. */
	id: string
	/** Title of the column the text `links` go in; contributors with the same title share it. */
	group?: string
	/** Text links, shown in the `group` column. */
	links?: readonly FooterLinkDto[]
	/** Icon-only links in the footer's bottom row. */
	icons?: ReadonlyArray<FooterLinkDto & Readonly<{ icon: FooterIcon }>>
	/** Short plain-text lines for the footer's bottom row (licence, filing number, ...). */
	notes?: readonly string[]
	/** Asks for the built-in "站内" column of forum pages. */
	siteLinks?: boolean
}>

export const FOOTER_LABEL_MAX = 40
export const FOOTER_GROUP_MAX = 20
export const FOOTER_LINKS_MAX = 20
export const FOOTER_NOTE_MAX = 120
export const FOOTER_NOTES_MAX = 6

/** A forum path or an http(s) URL; anything else (javascript:, data:, //host) is refused. */
export function isFooterHref(href: unknown): href is string {
	if (typeof href !== 'string' || href.length === 0 || href.length > 2000) return false
	if (href.startsWith('/')) return !href.startsWith('//') && !href.startsWith('/\\')
	try {
		const url = new URL(href)
		return url.protocol === 'https:' || url.protocol === 'http:'
	} catch {
		return false
	}
}

function checkText(id: string, what: string, value: unknown, max: number): void {
	if (typeof value !== 'string' || value.trim() === '' || Array.from(value).length > max) {
		throw new TypeError(`Footer contributor "${id}" has an invalid ${what}: ${String(value)}`)
	}
}

function checkLink(id: string, link: FooterLinkDto): void {
	checkText(id, 'link label', link.label, FOOTER_LABEL_MAX)
	if (!isFooterHref(link.href)) {
		throw new TypeError(`Footer contributor "${id}" has an invalid link: ${String(link.href)}`)
	}
}

/**
 * Footer links of running plugins. Stopping a contributor withdraws its links. `list()` merges
 * them: columns by title in registration order, icon links without repeating an href.
 */
export class FooterLinkRegistry {
	private readonly entries = new Map<string, FooterLinkContribution>()

	register(contribution: FooterLinkContribution): () => void {
		const { id, group, links = [], icons = [], notes = [], siteLinks = false } = contribution
		if (typeof id !== 'string' || !CONTRIBUTION_ID.test(id)) {
			throw new TypeError(`Invalid footer contributor ID: ${id}`)
		}
		if (links.length + icons.length + notes.length === 0 && !siteLinks) {
			throw new TypeError(
				`Footer contributor "${id}" must give at least one link, note or the site links`,
			)
		}
		if (notes.length > FOOTER_NOTES_MAX) {
			throw new TypeError(`Footer contributor "${id}" gives more than ${FOOTER_NOTES_MAX} notes`)
		}
		for (const note of notes) checkText(id, 'note', note, FOOTER_NOTE_MAX)
		if (links.length + icons.length > FOOTER_LINKS_MAX) {
			throw new TypeError(`Footer contributor "${id}" gives more than ${FOOTER_LINKS_MAX} links`)
		}
		if (links.length > 0) checkText(id, 'group title', group, FOOTER_GROUP_MAX)
		for (const link of links) checkLink(id, link)
		for (const link of icons) {
			checkLink(id, link)
			if (!isFooterIcon(link.icon)) {
				throw new TypeError(
					`Footer contributor "${id}" names an unknown icon: ${String(link.icon)}`,
				)
			}
		}
		if (this.entries.has(id)) throw new Error(`Footer links of "${id}" are already registered`)
		// Keep a copy, so a contributor changing its arrays later cannot bypass the checks.
		const stored: FooterLinkContribution = {
			id,
			group: group?.trim(),
			links: links.map(({ label, href }) => ({ label: label.trim(), href })),
			icons: icons.map(({ label, href, icon }) => ({ label: label.trim(), href, icon })),
			notes: notes.map((note) => note.trim()),
			siteLinks,
		}
		this.entries.set(id, stored)
		return () => {
			if (this.entries.get(id) === stored) this.entries.delete(id)
		}
	}

	/**
	 * The registered links merged after `base` (the forum's configured footer): a contributor
	 * column whose title matches one already there joins it, and a repeated icon href is dropped.
	 */
	list(base: FooterLinksDto = { groups: [], icons: [] }): FooterLinksDto {
		const groups: Array<{ title: string; links: FooterLinkDto[] }> = base.groups.map((group) => ({
			title: group.title,
			links: [...group.links],
		}))
		const icons: Array<FooterLinkDto & { icon: FooterIcon }> = [...base.icons]
		for (const entry of this.entries.values()) {
			if (entry.group !== undefined && (entry.links?.length ?? 0) > 0) {
				let column = groups.find((existing) => existing.title === entry.group)
				if (column === undefined) {
					column = { title: entry.group, links: [] }
					groups.push(column)
				}
				column.links.push(...(entry.links ?? []))
			}
			for (const icon of entry.icons ?? []) {
				if (!icons.some((existing) => existing.href === icon.href)) icons.push(icon)
			}
		}
		return { groups, icons }
	}

	/** Whether any contributor asked for the built-in "站内" column. */
	siteLinks(): boolean {
		return [...this.entries.values()].some((entry) => entry.siteLinks === true)
	}

	/** `base` (the configured notes) followed by the registered ones, without repeats. */
	notes(base: readonly string[] = []): string[] {
		const notes = [...base]
		for (const entry of this.entries.values()) {
			for (const note of entry.notes ?? []) if (!notes.includes(note)) notes.push(note)
		}
		return notes
	}
}
