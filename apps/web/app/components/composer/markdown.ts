import { type Editor, Extension, type Extensions, markInputRule } from '@tiptap/core'
import { Heading, type Level } from '@tiptap/extension-heading'
import { Image } from '@tiptap/extension-image'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { Markdown } from '@tiptap/markdown'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { StarterKit } from '@tiptap/starter-kit'

/**
 * Typing `**粗体**`, `~~删除~~` or `` `代码` `` turns into the format as soon as it is closed. The
 * stock rules only fire after a space or at the start of a line, which Chinese text rarely has in
 * the middle of a sentence; these fire anywhere, as Markdown itself would read the same text.
 * (`*斜体*` keeps the stock rule: a lone asterisk is too common in ordinary writing.)
 */
const InlineInputRules = Extension.create({
	name: 'inlineInputRules',
	addInputRules() {
		const { bold, strike, code } = this.editor.schema.marks
		return [
			...(bold ? [markInputRule({ find: /(?<![*\\])(\*\*([^*\s][^*]*)\*\*)$/, type: bold })] : []),
			...(strike ? [markInputRule({ find: /(?<![~\\])(~~([^~\s][^~]*)~~)$/, type: strike })] : []),
			...(code ? [markInputRule({ find: /(?<![`\\])(`([^`]+)`)$/, type: code })] : []),
		]
	},
})

/** Block or inline syntax that only means something as Markdown. */
const MARKDOWN_SIGNS = [
	/^#{1,6}\s+\S/m, // headings
	/^\s{0,3}(?:[-*+]|\d{1,9}[.)])\s+\S/m, // list items
	/^\s{0,3}>\s?/m, // quotes
	/^\s{0,3}(?:```|~~~)/m, // code fences
	/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/m, // rules
	/^\s*\|?[^\n]*\|[^\n]*\n\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/m, // tables
	/\*\*[^*\n]+\*\*|~~[^~\n]+~~|`[^`\n]+`/, // bold, strike, inline code
	/!?\[[^\]\n]*\]\([^)\s]+\)/, // links and images
]

/**
 * Pasting Markdown source (from a text editor, a terminal, a `.md` file) inserts it formatted, as
 * if it had been typed. The browser hands such text over as plain text, which ProseMirror would
 * otherwise insert verbatim with every `##` left as characters. Rich HTML from a web page still
 * goes through the normal HTML paste; VS Code also offers HTML, but of the source as coloured
 * text, so its plain text wins. Inside a code block everything stays literal.
 */
const MarkdownPaste = Extension.create({
	name: 'markdownPaste',
	addProseMirrorPlugins() {
		const { editor } = this
		return [
			new Plugin({
				key: new PluginKey('markdownPaste'),
				props: {
					handlePaste: (view, event) => {
						const data = event.clipboardData
						if (data === null) return false
						if (view.state.selection.$from.parent.type.spec.code === true) return false
						const text = data.getData('text/plain')
						if (text.trim() === '') return false
						const fromCodeEditor = data.types.includes('vscode-editor-data')
						if (data.getData('text/html') !== '' && !fromCodeEditor) return false
						if (!MARKDOWN_SIGNS.some((sign) => sign.test(text))) return false
						return editor.commands.insertContent(text, { contentType: 'markdown' })
					},
				},
			}),
		]
	},
})

/** Files the forum serves itself; the only images a post shows (see forum-markdown). */
export const FORUM_FILE =
	/^\/api\/forum\/ext\/[a-z][a-z0-9-]{0,63}\/files\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

/**
 * Images inside the text, as the renderer shows them. Pasted HTML brings in only images of forum
 * files; an outside picture would be saved as Markdown the forum then shows as plain text.
 */
const ForumImage = Image.extend({
	parseHTML() {
		return [
			{
				tag: 'img[src]',
				getAttrs: (element) => (FORUM_FILE.test(element.getAttribute('src') ?? '') ? null : false),
			},
		]
	},
}).configure({ inline: true, allowBase64: false })

/**
 * GFM tables. A Markdown cell holds one line of inline text, so a cell here holds paragraphs and
 * nothing else (lists or code blocks would have no way back to Markdown); a second paragraph or a
 * line break is saved as `<br>`. No column widths: Markdown has none to keep.
 */
const tableExtensions: Extensions = [
	Table.configure({ resizable: false }),
	TableRow,
	TableHeader.extend({ content: 'paragraph+' }),
	TableCell.extend({ content: 'paragraph+' }),
]

// Level 1 is the thread title; the renderer has no style below level 4.
const HEADING_LEVELS: Level[] = [2, 3, 4]

/**
 * Headings outside 2–4 become the nearest allowed level, as the renderer shows them (`#` as a level
 * 2 heading, `#####` as level 4), so a post keeps its look; Tiptap would make them paragraphs.
 */
const ForumHeading = Heading.extend({
	parseMarkdown(token, helpers) {
		const depth = typeof token.depth === 'number' ? token.depth : 1
		const level = Math.min(Math.max(depth, HEADING_LEVELS[0]), HEADING_LEVELS.at(-1)!)
		return helpers.createNode('heading', { level }, helpers.parseInline(token.tokens ?? []))
	},
})

/**
 * The editor's extensions for the forum's Markdown dialect (see forum-markdown): paragraphs, line
 * breaks, headings 2–4, bold, italic, strikethrough, inline code, code blocks, quotes, lists,
 * links, rules, tables and images of forum files. Everything the renderer does not show as formatting stays switched off here,
 * so the editor cannot produce what a post would not display.
 *
 * Built per editor rather than shared: this is where formats contributed by other extensions
 * (mentions, attachments) will be added from what `/meta` reports.
 */
export function composerExtensions(): Extensions {
	return [
		StarterKit.configure({
			heading: false,
			// Markdown has no underline.
			underline: false,
			link: {
				// A click inside the editor places the cursor; it does not leave the page.
				openOnClick: false,
				protocols: ['http', 'https', 'mailto'],
				defaultProtocol: 'https',
				// What the forum core puts on rendered links, so the editor shows the same thing.
				HTMLAttributes: { rel: 'nofollow ugc noopener', target: null },
			},
		}),
		ForumHeading.configure({ levels: HEADING_LEVELS }),
		ForumImage,
		...tableExtensions,
		InlineInputRules,
		MarkdownPaste,
		// The same parser options as the renderer: GFM, and a single newline is a line break.
		Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
	]
}

/**
 * The editor's content as Markdown. The serialiser can leave blank lines before the first block
 * (a table starts with one) or after the last (an empty paragraph at the end, for one); they mean
 * nothing in a post and are dropped.
 */
export function markdownOf(editor: Editor): string {
	return editor.getMarkdown().replace(/^\n+/, '').trimEnd()
}
