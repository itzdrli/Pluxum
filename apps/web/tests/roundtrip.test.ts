// The composer saves what the rich editor serialises, not what the author typed. This suite pins
// down what a trip Markdown → editor → Markdown does to a post, judged the way the forum judges
// it: by the HTML that forum-markdown renders.
import { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'

import { composerExtensions, markdownOf } from '../app/components/composer/markdown'
// The renderer itself, straight from the plugin's source: a pure function of marked. Importing
// the plugin package would start the Pluxel plugin class, which a frontend test has no host for.
import { renderMarkdown } from '../../../plugins/markdown/src/render'

function roundTrip(source: string): string {
	const editor = new Editor({
		extensions: composerExtensions(),
		content: source,
		contentType: 'markdown',
	})
	try {
		return markdownOf(editor)
	} finally {
		editor.destroy()
	}
}

/**
 * Syntax of the forum's dialect. The editor may rewrite the notation (second column), which is
 * accepted and recorded here; the rendered HTML must not change.
 */
const PRESERVED: readonly (readonly [name: string, source: string, rewritten: string])[] = [
	['plain paragraphs', '第一段\n\n第二段', '第一段\n\n第二段'],
	['a single newline becomes an explicit break', '一行\n下一行', '一行  \n下一行'],
	['explicit breaks', '两个空格  \n反斜杠\\\n结束', '两个空格  \n反斜杠  \n结束'],
	['blank lines between paragraphs', '上\n\n\n\n下', '上\n\n\n\n下'],
	['headings 2 to 4', '## 二\n\n### 三\n\n#### 四', '## 二\n\n### 三\n\n#### 四'],
	['headings outside 2 to 4', '# 一\n\n##### 五', '## 一\n\n#### 五'],
	[
		'emphasis in either notation',
		'**粗** __粗__ *斜* _斜_ ~~删~~ `码`',
		'**粗** **粗** *斜* *斜* ~~删~~ `码`',
	],
	['nested emphasis', '文字 **粗*斜*体** 结尾', '文字 **粗*斜*体** 结尾'],
	['bullet lists with either marker', '* a\n* b\n  * c', '- a\n- b\n  - c'],
	['ordered lists', '1. x\n2. y', '1. x\n2. y'],
	['list items with a second paragraph', '1. a\n\n   续\n2. b', '1. a\n\n   续\n2. b'],
	['quotes and rules', '> 引用\n> 第二行\n\n---\n\n段落', '> 引用  \n> 第二行\n\n---\n\n段落'],
	['fenced code with a language', '```ts\nconst a = 1 < 2\n```', '```ts\nconst a = 1 < 2\n```'],
	['indented code', '    indented', '```\nindented\n```'],
	[
		'links, autolinks and bare URLs',
		'[链接](https://example.com/?a=1&b=2) <https://auto.example> https://bare.example/x',
		'[链接](https://example.com/?a=1&b=2) [https://auto.example](https://auto.example) [https://bare.example/x](https://bare.example/x)',
	],
	[
		'characters that are not markup',
		'2 * 3 * 4、snake_case_name、a < b & c',
		'2 \\* 3 \\* 4、snake\\_case\\_name、a &lt; b &amp; c',
	],
	['escaped markup', '\\*不是斜体\\* \\# 不是标题', '\\*不是斜体\\* # 不是标题'],
	[
		'images of forum files, in the text',
		'看 ![截图]($/api/forum/ext/forum-attachments/files/0b9e8f1c-3a2d-4c5e-9f10-1234567890ab) 结尾',
		'看 ![截图]($/api/forum/ext/forum-attachments/files/0b9e8f1c-3a2d-4c5e-9f10-1234567890ab) 结尾',
	],
	[
		'tables, padded into columns',
		'| a | b |\n|---|---|\n| 1 | 2 |',
		'| a   | b   |\n| --- | --- |\n| 1   | 2   |',
	],
	[
		'tables with alignment, formatting, escaped pipes and line breaks in cells',
		'前文\n\n| 左 | 中 | 右 |\n|:--|:-:|--:|\n| **粗** | `a\\|b` | [链](/t/1) |\n| 1<br>2 |  | x |\n\n后文',
		'前文\n\n\n| 左      | 中      | 右         |\n| :------ | :------: | ---------: |\n| **粗**  | `a\\|b` | [链](/t/1) |\n| 1<br>2 |        | x         |\n\n\n后文',
	],
	// Shown as typed text by the renderer, before and after.
	['images from elsewhere', '![图](https://example.com/a.png)', '![图](https://example.com/a.png)'],
]

/**
 * Syntax outside the dialect, which the renderer shows as the text that was typed. The editor has
 * no node for it and would save something else, so these must be detected: the composer opens
 * such a post as Markdown source instead.
 */
const OUTSIDE: readonly (readonly [name: string, source: string])[] = [
	['task lists', '- [ ] todo\n- [x] done'],
	['inline HTML', '<b>html</b>'],
	['block HTML', '<div>block</div>'],
]

describe('Markdown round trip through the editor', () => {
	it.each(PRESERVED)('keeps the rendering of %s', (_name, source, rewritten) => {
		const saved = roundTrip(source)
		expect(renderMarkdown(saved)).toBe(renderMarkdown(source))
		expect(saved).toBe(rewritten)
	})

	it('is stable once rewritten', () => {
		for (const [, , rewritten] of PRESERVED) expect(roundTrip(rewritten)).toBe(rewritten)
	})

	it.each(OUTSIDE)(
		'changes the rendering of %s, which sends the post to source mode',
		(_name, source) => {
			expect(renderMarkdown(roundTrip(source))).not.toBe(renderMarkdown(source))
		},
	)

	it('saves nothing for an empty editor', () => {
		expect(roundTrip('')).toBe('')
	})

	it('drops the blank lines an empty last paragraph would leave', () => {
		const editor = new Editor({
			extensions: composerExtensions(),
			content: '段落',
			contentType: 'markdown',
		})
		try {
			editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'paragraph' })
			expect(editor.getMarkdown()).not.toBe('段落')
			expect(markdownOf(editor)).toBe('段落')
		} finally {
			editor.destroy()
		}
	})
})
