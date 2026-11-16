// Pure logic of the command palette: how a typed line is read and how items are ranked.

/** What the palette searches: everything, only commands (`>`), or only categories (`#`). */
export type PaletteMode = 'all' | 'commands' | 'categories'

export type PaletteQuery = Readonly<{ mode: PaletteMode; text: string }>

/** `> 发布` → commands matching 发布; `# 综合` → categories matching 综合; otherwise everything. */
export function parsePaletteQuery(raw: string): PaletteQuery {
	const line = raw.trimStart()
	if (line.startsWith('>') || line.startsWith('》')) {
		return { mode: 'commands', text: line.slice(1).trim() }
	}
	if (line.startsWith('#') || line.startsWith('＃')) {
		return { mode: 'categories', text: line.slice(1).trim() }
	}
	return { mode: 'all', text: line.trim() }
}

/**
 * How well `query` matches `text`, or null for no match. A run of the query inside the text beats
 * letters spread through it, and an earlier match beats a later one; higher is better. Case is
 * ignored. An empty query matches everything equally.
 */
export function fuzzyScore(query: string, text: string): number | null {
	const q = query.toLowerCase()
	if (q === '') return 0
	const t = text.toLowerCase()
	const at = t.indexOf(q)
	if (at >= 0) return 1000 - at * 2 - (t.length - q.length)
	let from = 0
	let gaps = 0
	for (const char of q) {
		const next = t.indexOf(char, from)
		if (next < 0) return null
		gaps += next - from
		from = next + 1
	}
	return 500 - gaps - (t.length - q.length)
}

/** The best score of a label and its extra keywords; the label counts a little more. */
export function itemScore(
	query: string,
	label: string,
	keywords: readonly string[] = [],
): number | null {
	let best: number | null = null
	const labelScore = fuzzyScore(query, label)
	if (labelScore !== null) best = labelScore + 10
	for (const keyword of keywords) {
		const score = fuzzyScore(query, keyword)
		if (score !== null && (best === null || score > best)) best = score
	}
	return best
}

/** Items that match, best first; equal scores keep their original order. */
export function rank<T>(
	items: readonly T[],
	query: string,
	textOf: (item: T) => { label: string; keywords?: readonly string[] },
): T[] {
	const scored: Array<{ item: T; score: number; index: number }> = []
	for (const [index, item] of items.entries()) {
		const { label, keywords } = textOf(item)
		const score = itemScore(query, label, keywords)
		if (score !== null) scored.push({ item, score, index })
	}
	return scored.toSorted((a, b) => b.score - a.score || a.index - b.index).map(({ item }) => item)
}
