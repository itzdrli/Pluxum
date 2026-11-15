import { Marked, type Tokens } from 'marked'

const ESCAPES: Readonly<Record<string, string>> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;',
}

function escapeHtml(text: string): string {
	return text.replaceAll(/[&<>"']/g, (char) => ESCAPES[char] ?? char)
}

/**
 * The forum's Markdown dialect: CommonMark plus GFM strikethrough and autolinks, with a single
 * newline kept as a line break. Syntax outside the dialect is shown as the text that was typed.
 */
const marked = new Marked({ gfm: true, breaks: true, async: false })

marked.use({
	tokenizer: {
		// Tables are not part of the dialect: the lines stay an ordinary paragraph.
		table: () => undefined,
	},
	renderer: {
		// Level 1 belongs to the thread title, and levels below 4 have no style of their own.
		heading({ tokens, depth }: Tokens.Heading): string {
			const level = Math.min(Math.max(depth, 2), 4)
			return `<h${level}>${this.parser.parseInline(tokens)}</h${level}>\n`
		},
		// Raw HTML is text. Block-level HTML would otherwise sit outside any paragraph.
		html({ text, block }: Tokens.HTML | Tokens.Tag): string {
			const shown = escapeHtml(block ? text.trim() : text)
			return block ? `<p>${shown.replaceAll('\n', '<br>')}</p>\n` : shown
		},
		// Images wait for attachments (M4).
		image({ raw }: Tokens.Image): string {
			return escapeHtml(raw)
		},
		// Task lists are not part of the dialect; keep the brackets instead of a checkbox.
		checkbox({ checked }: Tokens.Checkbox): string {
			return checked ? '[x] ' : '[ ] '
		},
	},
})

/** Markdown source to HTML. The forum core filters the result before it reaches a page. */
export function renderMarkdown(source: string): string {
	return marked.parse(source, { async: false })
}
