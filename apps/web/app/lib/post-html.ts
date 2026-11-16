// Pure helpers over the forum's rendered post HTML.

const HTML_ENTITIES: Readonly<Record<string, string>> = {
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&#39;': "'",
}

/**
 * The opening post's rendered HTML without a first heading that only repeats the thread title
 * (the title already heads the page). Markdown level 1 renders as `<h2>`; any heading level counts.
 */
export function withoutLeadingTitle(html: string, title: string): string {
	const match = /^\s*<h([1-6])>(.*?)<\/h\1>\s*/s.exec(html)
	if (match === null) return html
	const text = (match[2] ?? '')
		.replaceAll(/<[^>]*>/g, '')
		.replaceAll(/&(?:amp|lt|gt|quot|#39);/g, (entity) => HTML_ENTITIES[entity] ?? entity)
		.trim()
	return text === title.trim() ? html.slice(match[0].length) : html
}
