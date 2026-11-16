// The rich-text half of the composer. Everything that needs Tiptap lives in this module, which
// composer.tsx loads on demand in the browser: it never runs on the server and stays out of the
// bundle of pages without a text box.
import { Editor, Extension } from '@tiptap/core'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import {
	BetweenHorizontalEnd,
	BetweenVerticalEnd,
	Bold,
	Code,
	Heading2,
	Heading3,
	Italic,
	Link as LinkIcon,
	List,
	ListOrdered,
	type LucideIcon,
	Minus,
	Redo2,
	SquareCode,
	Strikethrough,
	Table,
	TableColumnsSplit,
	TableRowsSplit,
	TextQuote,
	Trash2,
	Undo2,
} from 'lucide-react'
import { type CSSProperties, useEffect, useRef, useState } from 'react'

import { composerExtensions, markdownOf } from './markdown'

/**
 * The Markdown the editor would save for this source, without showing an editor. When rendering
 * it gives the same HTML as the source, the post can be edited as rich text without changing it.
 */
export function roundTrip(source: string): string {
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

type Tool = Readonly<{
	id: string
	label: string
	icon: LucideIcon
	run: (editor: Editor) => void
	/** Whether the format applies at the cursor; tools without it are plain actions. */
	active?: (editor: Editor) => boolean
	enabled?: (editor: Editor) => boolean
}>

const TOOL_GROUPS: readonly (readonly Tool[])[] = [
	[
		{
			id: 'bold',
			label: '粗体',
			icon: Bold,
			run: (editor) => editor.chain().focus().toggleBold().run(),
			active: (editor) => editor.isActive('bold'),
		},
		{
			id: 'italic',
			label: '斜体',
			icon: Italic,
			run: (editor) => editor.chain().focus().toggleItalic().run(),
			active: (editor) => editor.isActive('italic'),
		},
		{
			id: 'strike',
			label: '删除线',
			icon: Strikethrough,
			run: (editor) => editor.chain().focus().toggleStrike().run(),
			active: (editor) => editor.isActive('strike'),
		},
		{
			id: 'code',
			label: '行内代码',
			icon: Code,
			run: (editor) => editor.chain().focus().toggleCode().run(),
			active: (editor) => editor.isActive('code'),
		},
	],
	[
		{
			id: 'h2',
			label: '标题',
			icon: Heading2,
			run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
			active: (editor) => editor.isActive('heading', { level: 2 }),
		},
		{
			id: 'h3',
			label: '小标题',
			icon: Heading3,
			run: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
			active: (editor) => editor.isActive('heading', { level: 3 }),
		},
		{
			id: 'bullet-list',
			label: '无序列表',
			icon: List,
			run: (editor) => editor.chain().focus().toggleBulletList().run(),
			active: (editor) => editor.isActive('bulletList'),
		},
		{
			id: 'ordered-list',
			label: '有序列表',
			icon: ListOrdered,
			run: (editor) => editor.chain().focus().toggleOrderedList().run(),
			active: (editor) => editor.isActive('orderedList'),
		},
		{
			id: 'blockquote',
			label: '引用',
			icon: TextQuote,
			run: (editor) => editor.chain().focus().toggleBlockquote().run(),
			active: (editor) => editor.isActive('blockquote'),
		},
		{
			id: 'code-block',
			label: '代码块',
			icon: SquareCode,
			run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
			active: (editor) => editor.isActive('codeBlock'),
		},
		{
			id: 'rule',
			label: '分隔线',
			icon: Minus,
			run: (editor) => editor.chain().focus().setHorizontalRule().run(),
		},
		{
			id: 'table',
			label: '插入表格',
			icon: Table,
			run: (editor) =>
				editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
			enabled: (editor) => !editor.isActive('table') && editor.can().insertTable(),
		},
	],
	[
		{
			id: 'undo',
			label: '撤销',
			icon: Undo2,
			run: (editor) => editor.chain().focus().undo().run(),
			enabled: (editor) => editor.can().undo(),
		},
		{
			id: 'redo',
			label: '重做',
			icon: Redo2,
			run: (editor) => editor.chain().focus().redo().run(),
			enabled: (editor) => editor.can().redo(),
		},
	],
]

/** Shown only while the cursor is inside a table. */
const TABLE_TOOLS: readonly Tool[] = [
	{
		id: 'row-after',
		label: '在下方插入行',
		icon: BetweenHorizontalEnd,
		run: (editor) => editor.chain().focus().addRowAfter().run(),
	},
	{
		id: 'column-after',
		label: '在右侧插入列',
		icon: BetweenVerticalEnd,
		run: (editor) => editor.chain().focus().addColumnAfter().run(),
	},
	{
		id: 'row-delete',
		label: '删除行',
		icon: TableRowsSplit,
		run: (editor) => editor.chain().focus().deleteRow().run(),
		enabled: (editor) => editor.can().deleteRow(),
	},
	{
		id: 'column-delete',
		label: '删除列',
		icon: TableColumnsSplit,
		run: (editor) => editor.chain().focus().deleteColumn().run(),
		enabled: (editor) => editor.can().deleteColumn(),
	},
	{
		id: 'table-delete',
		label: '删除表格',
		icon: Trash2,
		run: (editor) => editor.chain().focus().deleteTable().run(),
	},
]

const TOOLS = [...TOOL_GROUPS.flat(), ...TABLE_TOOLS]

/** A link target as the forum accepts it; a bare domain gets `https://`. */
function linkHref(input: string): string | null {
	const value = input.trim()
	if (value === '') return null
	if (/^(?:https?:\/\/|mailto:)/i.test(value)) return value
	// A path within the forum, but not a protocol-relative URL.
	if (value.startsWith('/') && !value.startsWith('//')) return value
	// Any other scheme (javascript:, data:) is refused rather than prefixed.
	if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null
	return `https://${value}`
}

/** The editing area's minimum height, handed to app.css as a custom property. */
function rowsStyle(rows: number): CSSProperties {
	const style: Record<string, string> = { '--composer-rows': String(rows) }
	return style
}

function ToolButton({
	label,
	icon: Icon,
	active = false,
	disabled = false,
	onClick,
}: {
	label: string
	icon: LucideIcon
	active?: boolean
	disabled?: boolean
	onClick: () => void
}) {
	return (
		<button
			type="button"
			className={`button button--ghost button--icon-only button--sm${active ? ' composer-tool--active' : ''}`}
			aria-label={label}
			aria-pressed={active}
			title={label}
			disabled={disabled}
			// Keep the selection (and the phone keyboard) where it is while a tool is pressed.
			onMouseDown={(event) => event.preventDefault()}
			onClick={onClick}
		>
			<Icon aria-hidden />
		</button>
	)
}

/** Inserts an uploaded file at the cursor. */
export type InsertAttachment = (item: AttachmentRef) => void

/** A file to put into the text: an image shown in place, or a link to the file. */
export type AttachmentRef = Readonly<{ kind: 'image' | 'link'; text: string; href: string }>

export function RichEditor({
	initial,
	label,
	placeholder,
	rows,
	autoFocus,
	onChange,
	onSubmit,
	insertRef,
}: {
	/** Markdown to start from. Later changes of this prop are ignored: the editor owns the text. */
	initial: string
	label: string
	placeholder?: string
	/** Minimum height, in lines of body text. */
	rows: number
	autoFocus: boolean
	onChange: (markdown: string) => void
	/** Ctrl/⌘+Enter. */
	onSubmit: () => void
	/** Filled with a function that inserts a link at the cursor while the editor is mounted. */
	insertRef?: { current: InsertAttachment | null }
}) {
	// The editor is created once; these refs let its callbacks reach the latest props.
	const changed = useRef(onChange)
	const submit = useRef(onSubmit)
	useEffect(() => {
		changed.current = onChange
		submit.current = onSubmit
	}, [onChange, onSubmit])
	const [linkDraft, setLinkDraft] = useState<string | null>(null)

	const editor = useEditor({
		extensions: [
			...composerExtensions(),
			Extension.create({
				name: 'submitShortcut',
				// Ahead of the hard break, which binds the same keys by default.
				priority: 1000,
				addKeyboardShortcuts: () => ({
					'Mod-Enter': () => {
						submit.current()
						return true
					},
				}),
			}),
		],
		content: initial,
		contentType: 'markdown',
		autofocus: autoFocus ? 'end' : false,
		// This component only mounts in the browser, after hydration.
		immediatelyRender: true,
		// The toolbar subscribes to exactly the state it shows (below).
		shouldRerenderOnTransaction: false,
		editorProps: {
			attributes: {
				class: 'post-body composer-editor',
				role: 'textbox',
				'aria-multiline': 'true',
				'aria-label': label,
			},
		},
		onUpdate: ({ editor: current }) => changed.current(markdownOf(current)),
	})

	useEffect(() => {
		if (insertRef === undefined) return undefined
		insertRef.current = ({ kind, text, href }) => {
			const node =
				kind === 'image'
					? { type: 'image', attrs: { src: href, alt: text } }
					: { type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }
			editor
				.chain()
				.focus()
				.insertContent([node, { type: 'text', text: ' ' }])
				.run()
		}
		return () => {
			insertRef.current = null
		}
	}, [editor, insertRef])

	const state = useEditorState({
		editor,
		selector: ({ editor: current }) => ({
			empty: current.isEmpty,
			link: current.isActive('link'),
			table: current.isActive('table'),
			active: TOOLS.filter((tool) => tool.active?.(current) === true).map((tool) => tool.id),
			disabled: TOOLS.filter((tool) => tool.enabled?.(current) === false).map((tool) => tool.id),
		}),
	})

	function openLink() {
		const current: unknown = editor.getAttributes('link').href
		setLinkDraft(typeof current === 'string' ? current : '')
	}

	function applyLink() {
		const href = linkHref(linkDraft ?? '')
		if (href === null) return
		const chain = editor.chain().focus().extendMarkRange('link')
		if (editor.state.selection.empty && !editor.isActive('link')) {
			// Nothing selected: the address itself becomes the linked text.
			chain.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] })
		} else {
			chain.setLink({ href })
		}
		chain.run()
		setLinkDraft(null)
	}

	function removeLink() {
		editor.chain().focus().extendMarkRange('link').unsetLink().run()
		setLinkDraft(null)
	}

	return (
		<div className="composer" style={rowsStyle(rows)}>
			<div className="composer-toolbar" role="toolbar" aria-label="格式">
				{TOOL_GROUPS.map((group, index) => (
					<div key={group[0]?.id} className="composer-tool-group">
						{group.map((tool) => (
							<ToolButton
								key={tool.id}
								label={tool.label}
								icon={tool.icon}
								active={state.active.includes(tool.id)}
								disabled={state.disabled.includes(tool.id)}
								onClick={() => tool.run(editor)}
							/>
						))}
						{index === 0 && (
							<ToolButton label="链接" icon={LinkIcon} active={state.link} onClick={openLink} />
						)}
					</div>
				))}
				{state.table && (
					<div className="composer-tool-group">
						{TABLE_TOOLS.map((tool) => (
							<ToolButton
								key={tool.id}
								label={tool.label}
								icon={tool.icon}
								disabled={state.disabled.includes(tool.id)}
								onClick={() => tool.run(editor)}
							/>
						))}
					</div>
				)}
			</div>
			{linkDraft !== null && (
				<div className="composer-link">
					<input
						type="text"
						inputMode="url"
						className="input min-w-0 flex-1"
						aria-label="链接地址"
						placeholder="https://"
						value={linkDraft}
						autoFocus
						onChange={(event) => setLinkDraft(event.target.value)}
						onKeyDown={(event) => {
							// Enter belongs to this row, not to the form around the composer.
							if (event.key === 'Enter') {
								event.preventDefault()
								applyLink()
							} else if (event.key === 'Escape') {
								setLinkDraft(null)
								editor.commands.focus()
							}
						}}
					/>
					<button type="button" className="button button--secondary button--sm" onClick={applyLink}>
						确定
					</button>
					{state.link && (
						<button type="button" className="button button--ghost button--sm" onClick={removeLink}>
							移除链接
						</button>
					)}
					<button
						type="button"
						className="button button--ghost button--sm"
						onClick={() => setLinkDraft(null)}
					>
						取消
					</button>
				</div>
			)}
			<div className="relative">
				{state.empty && placeholder !== undefined && (
					<span aria-hidden className="composer-placeholder">
						{placeholder}
					</span>
				)}
				<EditorContent editor={editor} />
			</div>
		</div>
	)
}
