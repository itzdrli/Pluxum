// Atom feeds of the forum (the whole site, one category, one person): what the feed routes write.
// Pure, so the shape is tested without a server.

export type FeedEntry = Readonly<{
	/** Absolute URL of the thread: the entry's id and link. */
	url: string
	title: string
	authorName: string
	authorUrl: string
	published: string
	updated: string
	category?: string
	/** The opening post as HTML, its links already absolute; absent when it could not be read. */
	html?: string
}>

export type Feed = Readonly<{
	title: string
	subtitle?: string
	/** The page the feed follows. */
	pageUrl: string
	/** The feed's own address. */
	selfUrl: string
	iconUrl?: string
	entries: readonly FeedEntry[]
}>

const XML_ESCAPES: Readonly<Record<string, string>> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&apos;',
}

export function escapeXml(text: string): string {
	// XML 1.0 forbids most control characters even escaped; a reader would reject the whole feed.
	// oxlint-disable-next-line no-control-regex -- removing exactly those characters.
	const clean = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
	return clean.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char)
}

const ENTITIES: Readonly<Record<string, string>> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
}

/** The text of a fragment of HTML, on one line: for a note's title, which has none of its own. */
export function textOf(html: string): string {
	return html
		.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
		.replace(/<[^>]*>/g, ' ')
		.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
			if (name.startsWith('#x') || name.startsWith('#X')) {
				return String.fromCodePoint(Number.parseInt(name.slice(2), 16))
			}
			if (name.startsWith('#')) return String.fromCodePoint(Number.parseInt(name.slice(1), 10))
			return ENTITIES[name.toLowerCase()] ?? whole
		})
		.replace(/\s+/g, ' ')
		.trim()
}

/** At most `max` characters of `text`, cut with an ellipsis. */
export function clip(text: string, max: number): string {
	const chars = Array.from(text)
	return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`
}

/**
 * Makes the site-relative `src` and `href` attributes of rendered post HTML absolute: a feed
 * reader shows the HTML away from the site, and not every reader honours `xml:base`.
 */
export function absolutizeHtml(html: string, origin: string): string {
	return html.replace(/\b(src|href)="\/(?!\/)/g, `$1="${origin}/`)
}

/** An Atom 1.0 document (RFC 4287). */
export function renderAtom(feed: Feed): string {
	const updated =
		feed.entries.reduce<string | undefined>(
			(latest, entry) => (latest === undefined || entry.updated > latest ? entry.updated : latest),
			undefined,
		) ?? new Date(0).toISOString()
	const lines = [
		'<?xml version="1.0" encoding="utf-8"?>',
		'<feed xmlns="http://www.w3.org/2005/Atom">',
		`<id>${escapeXml(feed.selfUrl)}</id>`,
		`<title>${escapeXml(feed.title)}</title>`,
		...(feed.subtitle ? [`<subtitle>${escapeXml(feed.subtitle)}</subtitle>`] : []),
		`<updated>${escapeXml(updated)}</updated>`,
		`<link rel="self" type="application/atom+xml" href="${escapeXml(feed.selfUrl)}"/>`,
		`<link rel="alternate" type="text/html" href="${escapeXml(feed.pageUrl)}"/>`,
		...(feed.iconUrl ? [`<icon>${escapeXml(feed.iconUrl)}</icon>`] : []),
		'<generator uri="https://github.com/itzdrli/Pluxum">Pluxum</generator>',
	]
	for (const entry of feed.entries) {
		lines.push(
			'<entry>',
			`<id>${escapeXml(entry.url)}</id>`,
			`<title>${escapeXml(entry.title)}</title>`,
			`<link rel="alternate" type="text/html" href="${escapeXml(entry.url)}"/>`,
			`<published>${escapeXml(entry.published)}</published>`,
			`<updated>${escapeXml(entry.updated)}</updated>`,
			`<author><name>${escapeXml(entry.authorName)}</name><uri>${escapeXml(entry.authorUrl)}</uri></author>`,
			...(entry.category ? [`<category term="${escapeXml(entry.category)}"/>`] : []),
			...(entry.html === undefined
				? []
				: [`<content type="html">${escapeXml(entry.html)}</content>`]),
			'</entry>',
		)
	}
	lines.push('</feed>', '')
	return lines.join('\n')
}
