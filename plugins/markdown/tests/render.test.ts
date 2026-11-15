import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../src/render'

const html = (source: string) => renderMarkdown(source).trim()

const FILE = '/api/forum/ext/forum-attachments/files/0b9e8f1c-3a2d-4c5e-9f10-1234567890ab'

describe('renderMarkdown', () => {
	it('renders the supported dialect', () => {
		expect(html('**粗体** _斜体_ ~~删除~~ `code`')).toBe(
			'<p><strong>粗体</strong> <em>斜体</em> <del>删除</del> <code>code</code></p>',
		)
		expect(html('## 标题\n\n> 引用')).toBe(
			'<h2>标题</h2>\n<blockquote>\n<p>引用</p>\n</blockquote>',
		)
		expect(html('- a\n- b')).toBe('<ul>\n<li>a</li>\n<li>b</li>\n</ul>')
		expect(html('3. a\n4. b')).toBe('<ol start="3">\n<li>a</li>\n<li>b</li>\n</ol>')
		expect(html('```ts\nconst a = 1 < 2\n```')).toBe(
			'<pre><code class="language-ts">const a = 1 &lt; 2\n</code></pre>',
		)
		expect(html('[站内](/t/1) https://example.com')).toBe(
			'<p><a href="/t/1">站内</a> <a href="https://example.com">https://example.com</a></p>',
		)
		expect(html('---')).toBe('<hr>')
	})

	it('keeps a single newline as a line break', () => {
		expect(html('第一行\n第二行\n\n第二段')).toBe('<p>第一行<br>第二行</p>\n<p>第二段</p>')
	})

	it('clamps headings to levels two through four', () => {
		expect(html('# 一级')).toBe('<h2>一级</h2>')
		expect(html('###### 六级')).toBe('<h4>六级</h4>')
	})

	it('shows images of forum files and nothing else', () => {
		expect(html(`看 ![截图 "a"](${FILE} "标题") 这里`)).toBe(
			`<p>看 <img src="${FILE}" alt="截图 &quot;a&quot;" title="标题"> 这里</p>`,
		)
		expect(html('![x](/api/forum/ext/a/files/not-an-id)')).toBe(
			'<p>![x](/api/forum/ext/a/files/not-an-id)</p>',
		)
		expect(html(`![x](https://evil.example${FILE})`)).toBe(
			`<p>![x](https://evil.example${FILE})</p>`,
		)
	})

	it('shows syntax outside the dialect as the text that was typed', () => {
		expect(html('<b>x</b> <script>alert(1)</script>')).toBe(
			'<p>&lt;b&gt;x&lt;/b&gt; &lt;script&gt;alert(1)&lt;/script&gt;</p>',
		)
		expect(html('<div>\nblock\n</div>')).toBe('<p>&lt;div&gt;<br>block<br>&lt;/div&gt;</p>')
		expect(html('![图](https://example.com/a.png)')).toBe('<p>![图](https://example.com/a.png)</p>')
		expect(html('- [ ] 待办\n- [x] 完成')).toBe('<ul>\n<li>[ ] 待办</li>\n<li>[x] 完成</li>\n</ul>')
		expect(html('| a | b |\n|---|---|\n| 1 | 2 |')).toBe(
			'<p>| a | b |<br>|---|---|<br>| 1 | 2 |</p>',
		)
	})

	it('leaves plain prose with Markdown punctuation readable', () => {
		expect(html('2 * 3 * 4 = 24，snake_case_name 不变')).toBe(
			'<p>2 * 3 * 4 = 24，snake_case_name 不变</p>',
		)
	})
})
