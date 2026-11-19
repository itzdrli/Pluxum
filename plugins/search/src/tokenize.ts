import { Jieba } from '@node-rs/jieba'
import { dict } from '@node-rs/jieba/dict.js'

const CUSTOM_WORD_FREQ = 100_000
const CUSTOM_WORD_TAG = 'nz'
const DEFAULT_SNIPPET_CHARS = 160
const SNIPPET_LEADING_CHARS = 36

const BLOCK_HTML_TAG =
	/<\/?(?:address|article|aside|blockquote|br|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/giu
const INLINE_HTML_TAG = /<\/?[A-Za-z][^>\n]*>/gu

const HTML_ENTITIES: Readonly<Record<string, string>> = {
	'&nbsp;': ' ',
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&#39;': "'",
	'&#x27;': "'",
}

function decodeEntities(text: string): string {
	return text.replaceAll(
		/&(?:nbsp|amp|lt|gt|quot|#39|#x27);/giu,
		(entity) => HTML_ENTITIES[entity.toLowerCase()] ?? entity,
	)
}

export function escapeHtml(text: string): string {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;')
}

/**
 * Strips Markdown formatting and HTML tags from post or title text while keeping readable prose
 * and code identifiers intact for indexing and excerpt display.
 */
export function stripMarkup(source: string): string {
	if (!source) return ''
	const codeSpans: string[] = []
	const stashCode = (code: string): string => {
		const index = codeSpans.length
		codeSpans.push(code)
		return `\uE000CODE${index}\uE001`
	}

	let text = source.replaceAll('\0', '').replaceAll(/\r\n?/g, '\n')

	// Keep code block and inline code contents verbatim while removing fence/backtick delimiters.
	text = text.replaceAll(/```[^\n]*\n([\s\S]*?)```/g, (_, body: string) => ` ${stashCode(body)} `)
	text = text.replaceAll(/~~~[^\n]*\n([\s\S]*?)~~~/g, (_, body: string) => ` ${stashCode(body)} `)
	text = text.replaceAll(/`([^`\n]+)`/g, (_, body: string) => stashCode(body))

	// Drop non-content script/style blocks and HTML comments before stripping remaining tags.
	text = text.replaceAll(/<!--[\s\S]*?-->/g, ' ')
	text = text.replaceAll(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/giu, ' ')

	// Markdown images keep their alt text (never raw attachment/external URLs); links keep label text.
	text = text.replaceAll(/!\[([^\]]*)\]\([^)\n]+\)/g, ' $1 ')
	text = text.replaceAll(/\[([^\]]+)\]\([^)\n]+\)/g, '$1')

	// Block HTML tags separate words; inline tags unwrap in place so CJK runs do not gain stray spaces.
	text = text.replaceAll(BLOCK_HTML_TAG, ' ')
	text = text.replaceAll(INLINE_HTML_TAG, '')
	text = decodeEntities(text)

	// GFM tables: the cell text stays, the pipes and the `| --- |` delimiter row go.
	text = stripTables(text)

	// Block-level Markdown markers.
	text = text.replaceAll(/^\s*(?:[-*_]\s*){3,}\s*$/gm, ' ')
	text = text.replaceAll(/^\s*#{1,6}\s+/gm, '')
	text = text.replaceAll(/^\s*(?:>\s*)+/gm, '')
	text = text.replaceAll(/^\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/gm, '')

	// Inline emphasis / strikethrough markers; preserve underscores inside identifiers (`ts_rank_cd`).
	text = text.replaceAll(/\*\*([^*\n]+)\*\*/g, '$1')
	text = text.replaceAll(/__([^_\n]+)__/g, '$1')
	text = text.replaceAll(/~~([^~\n]+)~~/g, '$1')
	text = text.replaceAll(/\*([^*\n]+)\*/g, '$1')
	text = text.replaceAll(/(^|[^\p{L}\p{N}_])_([^_\n]+)_(?=$|[^\p{L}\p{N}_])/gu, '$1$2')

	// Restore stashed code spans and collapse whitespace.
	text = text.replaceAll(/\uE000CODE(\d+)\uE001/g, (_, rawIndex: string) => {
		const index = Number(rawIndex)
		return codeSpans[index] ?? ''
	})

	return text.replaceAll(/\s+/g, ' ').trim()
}

/** A GFM table's delimiter row: `| --- | :-: |`, at least one cell, pipes optional at the ends. */
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/

/**
 * Replaces each GFM table (a header row, its delimiter row and the rows after it up to a blank
 * line) by its cells separated with spaces. An escaped `\|` is a literal pipe inside a cell.
 */
function stripTables(text: string): string {
	const lines = text.split('\n')
	const out: string[] = []
	for (let index = 0; index < lines.length; index++) {
		const header = lines[index] ?? ''
		const delimiter = lines[index + 1]
		if (delimiter === undefined || !header.includes('|') || !TABLE_DELIMITER.test(delimiter)) {
			out.push(header)
			continue
		}
		out.push(tableCells(header))
		index += 2
		while (
			index < lines.length &&
			(lines[index] ?? '').includes('|') &&
			(lines[index] ?? '').trim() !== ''
		) {
			out.push(tableCells(lines[index] ?? ''))
			index++
		}
		index--
	}
	return out.join('\n')
}

function tableCells(row: string): string {
	return row
		.replaceAll('\\|', '\uE002')
		.trim()
		.replace(/^\|/, '')
		.replace(/\|$/, '')
		.split('|')
		.map((cell) => cell.trim())
		.filter((cell) => cell !== '')
		.join(' ')
		.replaceAll('\uE002', '|')
}

/** Normalizes text for segmentation: NFKC folds full-width ASCII, and ASCII letters become lowercase. */
export function normalizeForSearch(plainText: string): string {
	return plainText.normalize('NFKC').toLowerCase()
}

function cleanSegmentToken(raw: string): string {
	const trimmed = raw.trim()
	if (!trimmed || !/[\p{L}\p{N}]/u.test(trimmed)) return ''
	const stripped = trimmed.replaceAll(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
	return /[\p{L}\p{N}]/u.test(stripped) ? stripped : ''
}

function filterTokens(rawTokens: readonly string[]): string[] {
	const out: string[] = []
	for (const raw of rawTokens) {
		const clean = cleanSegmentToken(raw)
		if (clean) out.push(clean)
	}
	return out
}

function formatDictLine(
	word: string,
	freq = CUSTOM_WORD_FREQ,
	tag = CUSTOM_WORD_TAG,
): string | null {
	const normalized = normalizeForSearch(word).replaceAll(/\s+/g, '')
	if (!normalized || !/[\p{L}\p{N}]/u.test(normalized)) return null
	return `${normalized} ${freq} ${tag}`
}

export type SearchTokenizer = Readonly<{
	/** Loads extra Jieba dictionary lines (`word [freq [tag]]`) from a UTF-8 buffer. */
	loadDict: (dictBytes: Uint8Array) => void
	/** Inserts a single custom word into this tokenizer's dictionary. */
	insertWord: (word: string, freq?: number, tag?: string) => void
	/** Search-mode segmentation (`cutForSearch(text, true)`) joined by spaces for `to_tsvector`. */
	tokenizeForIndex: (plainText: string) => string
	/** Precise-mode segmentation (`cut(query, true)`) deduplicated for `plainto_tsquery` & snippets. */
	tokenizeForQuery: (rawQuery: string) => string[]
}>

/** Creates an isolated Jieba tokenizer with optional custom domain words. */
export function createSearchTokenizer(customWords: readonly string[] = []): SearchTokenizer {
	const jieba = Jieba.withDict(dict)
	const encoder = new TextEncoder()

	const loadDict = (dictBytes: Uint8Array): void => {
		if (dictBytes.byteLength > 0) jieba.loadDict(dictBytes)
	}

	const insertWord = (word: string, freq = CUSTOM_WORD_FREQ, tag = CUSTOM_WORD_TAG): void => {
		const line = formatDictLine(word, freq, tag)
		if (line) jieba.loadDict(encoder.encode(`${line}\n`))
	}

	if (customWords.length > 0) {
		const lines: string[] = []
		for (const word of customWords) {
			const line = formatDictLine(word)
			if (line) lines.push(line)
		}
		if (lines.length > 0) {
			jieba.loadDict(encoder.encode(`${lines.join('\n')}\n`))
		}
	}

	return {
		loadDict,
		insertWord,
		tokenizeForIndex(plainText: string): string {
			const normalized = normalizeForSearch(plainText)
			if (!normalized) return ''
			return filterTokens(jieba.cutForSearch(normalized, true)).join(' ')
		},
		tokenizeForQuery(rawQuery: string): string[] {
			const normalized = normalizeForSearch(stripMarkup(rawQuery))
			if (!normalized) return []
			const seen = new Set<string>()
			const unique: string[] = []
			for (const token of filterTokens(jieba.cut(normalized, true))) {
				if (!seen.has(token)) {
					seen.add(token)
					unique.push(token)
				}
			}
			return unique
		},
	}
}

function escapeRegExp(literal: string): string {
	return literal.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Builds a bounded HTML excerpt from `plainBody` with matched `queryTerms` wrapped in `<mark>`.
 * All non-tag text is HTML-escaped so raw markup in a post body can never execute.
 */
export function buildSnippetHtml(
	plainBody: string,
	queryTerms: readonly string[],
	maxChars = DEFAULT_SNIPPET_CHARS,
): string {
	const clean = plainBody.trim()
	if (!clean) return ''

	const terms = [...new Set(queryTerms.map((term) => term.trim()).filter(Boolean))].toSorted(
		(a, b) => Array.from(b).length - Array.from(a).length,
	)
	const pattern =
		terms.length > 0 ? new RegExp(terms.map(escapeRegExp).join('|'), 'giu') : undefined

	const codePoints = Array.from(clean)
	let windowText = clean
	let prefix = ''
	let suffix = ''

	if (codePoints.length > maxChars) {
		let startCp = 0
		if (pattern !== undefined) {
			pattern.lastIndex = 0
			const firstMatch = pattern.exec(clean)
			if (firstMatch !== null) {
				const matchCp = Array.from(clean.slice(0, firstMatch.index)).length
				startCp = Math.max(
					0,
					Math.min(matchCp - SNIPPET_LEADING_CHARS, codePoints.length - maxChars),
				)
			}
		}
		const endCp = Math.min(codePoints.length, startCp + maxChars)
		windowText = codePoints.slice(startCp, endCp).join('')
		prefix = startCp > 0 ? '…' : ''
		suffix = endCp < codePoints.length ? '…' : ''
	}

	if (pattern === undefined) {
		return `${prefix}${escapeHtml(windowText)}${suffix}`
	}

	pattern.lastIndex = 0
	let cursor = 0
	let out = prefix
	for (const match of windowText.matchAll(pattern)) {
		const start = match.index
		const matched = match[0]
		if (!matched) continue
		if (start > cursor) {
			out += escapeHtml(windowText.slice(cursor, start))
		}
		out += `<mark>${escapeHtml(matched)}</mark>`
		cursor = start + matched.length
	}
	if (cursor < windowText.length) {
		out += escapeHtml(windowText.slice(cursor))
	}
	out += suffix
	return out
}
