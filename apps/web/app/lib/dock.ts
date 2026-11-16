// Pure logic of the composer dock: what a drop puts in, and the sizes it can take.

export type DockSize = 'min' | 'half' | 'full'

/** The next size when the size button is pressed: half and full swap. */
export function toggledSize(size: DockSize): DockSize {
	return size === 'full' ? 'half' : 'full'
}

export type DroppedLink = Readonly<{ text: string; href: string }>

const FORUM_PATH = /^\/(?:c\/[^/]+\/t\/[^/?#]+|t\/[^/?#]+(?:\/\d+)?|u\/[^/?#]+)\/?$/

/**
 * The forum link a drag carried: the URL (as text/uri-list or text/plain) must lead to a thread,
 * a floor of one or a profile on `origin`; the link text comes from the dragged anchor (text/html)
 * when it has one. Anything else is not something to quote, and gives null.
 */
export function droppedLink(
	data: Readonly<{ uriList: string; plain: string; html: string }>,
	origin: string,
): DroppedLink | null {
	const first =
		data.uriList.split(/\r?\n/).find((line) => line !== '' && !line.startsWith('#')) ??
		data.plain.trim()
	let url: URL
	try {
		url = new URL(first, origin)
	} catch {
		return null
	}
	if (url.origin !== origin || !FORUM_PATH.test(url.pathname)) return null
	const anchor = /<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(data.html)
	const text = (anchor?.[1] ?? '')
		.replaceAll(/<[^>]*>/g, '')
		.replaceAll('&amp;', '&')
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&quot;', '"')
		.replaceAll('&#39;', "'")
		.trim()
	return { text: text === '' ? url.pathname : text, href: `${url.pathname}${url.hash}` }
}
