import { type Editor, Extension, type Extensions, markInputRule } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
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

/**
 * The editor's extensions for the forum's Markdown dialect (see forum-markdown): paragraphs, line
 * breaks, headings 2–4, bold, italic, strikethrough, inline code, code blocks, quotes, lists,
 * links and rules. Everything the renderer does not show as formatting stays switched off here,
 * so the editor cannot produce what a post would not display.
 *
 * Built per editor rather than shared: this is where formats contributed by other extensions
 * (mentions, attachments) will be added from what `/meta` reports.
 */
export function composerExtensions(): Extensions {
	return [
		StarterKit.configure({
			// Level 1 is the thread title; the renderer has no style below level 4.
			heading: { levels: [2, 3, 4] },
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
		InlineInputRules,
		// The same parser options as the renderer: GFM, and a single newline is a line break.
		Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
	]
}

/**
 * The editor's content as Markdown. The serialiser can leave blank lines after the last block
 * (an empty paragraph at the end, for one); they mean nothing in a post and are dropped.
 */
export function markdownOf(editor: Editor): string {
	return editor.getMarkdown().trimEnd()
}
