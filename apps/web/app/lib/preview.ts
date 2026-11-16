// What a hover card needs to know: which links it explains and how a post is shortened.

export type PreviewTarget =
	| Readonly<{ kind: 'thread'; ref: string; floor: number | null }>
	| Readonly<{ kind: 'user'; handle: string }>

const THREAD_PATH = /^\/(?:c\/[^/]+\/)?t\/([^/?#]+)(?:\/(\d+))?\/?$/
const USER_PATH = /^\/u\/([^/?#]+)\/?$/

/** The thread, floor or profile a link on this origin points at; null for any other link. */
export function previewTarget(href: string, origin: string): PreviewTarget | null {
	let url: URL
	try {
		url = new URL(href, origin)
	} catch {
		return null
	}
	if (url.origin !== origin) return null
	const thread = THREAD_PATH.exec(url.pathname)
	if (thread?.[1] !== undefined) {
		const floor =
			thread[2] === undefined ? Number(url.hash.slice('#post-'.length)) : Number(thread[2])
		return {
			kind: 'thread',
			ref: decodeURIComponent(thread[1]),
			floor: Number.isSafeInteger(floor) && floor >= 1 ? floor : null,
		}
	}
	const user = USER_PATH.exec(url.pathname)
	return user?.[1] === undefined ? null : { kind: 'user', handle: decodeURIComponent(user[1]) }
}

/** The text of a rendered post, tags dropped and whitespace folded, cut at `max` characters. */
export function excerptOf(html: string, max: number): string {
	const text = html
		.replaceAll(/<(?:br|\/p|\/li|\/h[1-6]|\/tr|\/blockquote)\b[^>]*>/gi, ' ')
		.replaceAll(/<[^>]*>/g, '')
		.replaceAll('&amp;', '&')
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&quot;', '"')
		.replaceAll('&#39;', "'")
		.replaceAll(/\s+/g, ' ')
		.trim()
	const chars = Array.from(text)
	return chars.length <= max ? text : `${chars.slice(0, max).join('')}…`
}
