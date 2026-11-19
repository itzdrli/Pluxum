// `composer.editor` contribution of forum-mentions. Loaded only together with the rich editor.
import { Extension, type Editor, type Range } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { Suggestion, type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion'
import type { I18n } from '@lingui/core'
import { t } from '@lingui/core/macro'

import type { ComposerEditorExtension } from '../slots'

const EXT_ID = 'forum-mentions'

type Person = Readonly<{ id: string; handle: string; displayName: string }>

function isPerson(value: unknown): value is Person {
	return (
		typeof value === 'object' &&
		value !== null &&
		'id' in value &&
		typeof value.id === 'string' &&
		'handle' in value &&
		typeof value.handle === 'string' &&
		'displayName' in value &&
		typeof value.displayName === 'string'
	)
}

/** People matching `query`, from forum-mentions; an empty list when it cannot answer. */
async function suggest(query: string, signal: AbortSignal): Promise<Person[]> {
	try {
		const response = await fetch(
			`/api/forum/ext/${EXT_ID}/suggest?q=${encodeURIComponent(query)}`,
			{ headers: { accept: 'application/json' }, signal },
		)
		if (!response.ok) return []
		const body: unknown = await response.json()
		const items =
			typeof body === 'object' && body !== null && 'items' in body && Array.isArray(body.items)
				? body.items
				: []
		return items.filter(isPerson)
	} catch {
		return []
	}
}

/** Writes the choice as a profile link, which Markdown keeps as `[@名字](/u/handle)`. */
function insertMention(editor: Editor, range: Range, person: Person) {
	editor
		.chain()
		.focus()
		.insertContentAt(range, [
			{
				type: 'text',
				text: `@${person.displayName}`,
				marks: [{ type: 'link', attrs: { href: `/u/${person.handle}` } }],
			},
			{ type: 'text', text: ' ' },
		])
		.run()
}

/** The popup: a listbox of people, driven by the suggestion plugin's keys and the mouse. */
function popup(i18n: I18n) {
	let element: HTMLDivElement | null = null
	let unmount: (() => void) | null = null
	let items: Person[] = []
	let active = 0
	let choose: ((person: Person) => void) | null = null

	const draw = (loading: boolean) => {
		if (element === null) return
		element.replaceChildren()
		if (items.length === 0) {
			const empty = document.createElement('p')
			empty.className = 'text-ink-weak px-3 py-2 text-meta'
			empty.textContent = loading ? t(i18n)`查找中…` : t(i18n)`没有找到这个人`
			element.append(empty)
			return
		}
		items.forEach((person, index) => {
			const option = document.createElement('div')
			option.setAttribute('role', 'option')
			option.setAttribute('aria-selected', String(index === active))
			option.className = `mx-1 flex cursor-pointer items-baseline gap-2 rounded-[2px] border-l-2 px-2.5 py-1.5 ${
				index === active
					? 'border-l-accent bg-selected text-ink-strong'
					: 'text-ink border-l-transparent'
			}`
			const name = document.createElement('span')
			name.className = 'min-w-0 truncate'
			name.textContent = person.displayName
			const handle = document.createElement('span')
			handle.className = 'text-ink-weak shrink-0 text-meta'
			handle.textContent = `@${person.handle}`
			option.append(name, handle)
			// Keep the editor's selection: choosing must not blur it first.
			option.addEventListener('mousedown', (event) => event.preventDefault())
			option.addEventListener('mousemove', () => {
				if (active === index) return
				active = index
				draw(false)
			})
			option.addEventListener('click', () => choose?.(person))
			element?.append(option)
		})
	}

	const update = (props: SuggestionProps<Person, Person>) => {
		if (items !== props.items) active = 0
		items = props.items
		choose = (person) => props.command(person)
		draw(props.loading)
	}

	return {
		onStart: (props: SuggestionProps<Person, Person>) => {
			element = document.createElement('div')
			element.setAttribute('role', 'listbox')
			element.setAttribute('aria-label', t(i18n)`提到的人`)
			element.className =
				'border-line bg-panel shadow-overlay z-50 w-64 max-w-[calc(100vw-1rem)] rounded-[2px] border py-1'
			element.style.position = 'absolute'
			document.body.append(element)
			unmount = props.mount(element)
			update(props)
		},
		onUpdate: update,
		onKeyDown: ({ event }: SuggestionKeyDownProps) => {
			if (items.length === 0) return false
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				const step = event.key === 'ArrowDown' ? 1 : -1
				active = (active + step + items.length) % items.length
				draw(false)
				return true
			}
			if (event.key === 'Enter' || event.key === 'Tab') {
				const person = items[active]
				if (person !== undefined) choose?.(person)
				return true
			}
			return false
		},
		onExit: () => {
			unmount?.()
			unmount = null
			element?.remove()
			element = null
			items = []
		},
	}
}

/** A letter, digit or address character right before `@`: an email address, not a mention. */
const ADDRESS_CHAR = /[\w.%+-]$/u

const Mentions = (i18n: I18n) =>
	Extension.create({
		name: 'forumMentions',
		addProseMirrorPlugins() {
			return [
				Suggestion<Person, Person>({
					editor: this.editor,
					pluginKey: new PluginKey('forumMentions'),
					char: '@',
					// Chinese text has no space before a mention.
					allowedPrefixes: null,
					debounce: 150,
					allow: ({ state, range }) => {
						const $from = state.doc.resolve(range.from)
						if ($from.parent.type.spec.code === true) return false
						if (
							$from.marks().some((mark) => mark.type.name === 'code' || mark.type.name === 'link')
						) {
							return false
						}
						const before = state.doc.textBetween(Math.max(0, range.from - 1), range.from)
						return !ADDRESS_CHAR.test(before)
					},
					items: ({ query, signal }) => suggest(query, signal),
					command: ({ editor, range, props }) => insertMention(editor, range, props),
					render: () => popup(i18n),
				}),
			]
		},
	})

export const mentionsEditor: ComposerEditorExtension = { extensions: (i18n) => [Mentions(i18n)] }
