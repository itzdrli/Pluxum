import { Marked, type Tokens } from 'marked'

const ESCAPES: Readonly<Record<string, string>> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;',
}

/**
 * Files the forum serves itself (`/api/forum/ext/<extension>/files/<id>`). Only these become
 * images: an outside address would let a post load anything from anywhere into every reader's
 * browser. The forum core enforces the same rule on the HTML.
 */
const FORUM_FILE =
	/^\/api\/forum\/ext\/[a-z][a-z0-9-]{0,63}\/files\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

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
		// Images of the forum's own files are shown; any other image stays the text that was typed.
		image({ raw, href, text, title }: Tokens.Image): string {
			if (!FORUM_FILE.test(href)) return escapeHtml(raw)
			const titled = title ? ` title="${escapeHtml(title)}"` : ''
			return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${titled}>`
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
