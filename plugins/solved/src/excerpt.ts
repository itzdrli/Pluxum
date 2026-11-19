/** Characters of an answer kept to show under the question. */
export const EXCERPT_CHARS = 120

/**
 * The opening words of a Markdown post as plain text: code, images and markup dropped, links
 * reduced to their text, whitespace collapsed, cut to `max` characters.
 */
export function excerptOf(source: string, max = EXCERPT_CHARS): string {
	const text = source
		.replaceAll(/```[\s\S]*?```/gu, ' ')
		.replaceAll(/!\[[^\]]*\]\([^)]*\)/gu, ' ')
		.replaceAll(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
		.replaceAll(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gmu, '')
		.replaceAll(/[*_~`|]+/gu, '')
		.replaceAll(/\s+/gu, ' ')
		.trim()
	const chars = Array.from(text)
	return chars.length <= max ? text : `${chars.slice(0, max).join('')}…`
}
