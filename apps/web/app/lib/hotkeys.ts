// Every keyboard shortcut of the forum, declared once. Components register these entries with
// `useHotkey(appHotkeys[id], …)` where the action lives; the `?` sheet and the command palette
// list them from here, so a shortcut and its description cannot drift apart.

import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { defineAppHotkeys, detectPlatform, type HotkeyPlatform } from '@tanstack/react-hotkeys'

export const appHotkeys = defineAppHotkeys({
	'palette.open': { hotkey: 'Mod+K', options: { requireReset: true } },
	'palette.slash': { hotkey: '/' },
	'help.open': { hotkey: '?' },
	'go.home': { hotkey: ['G', 'H'] },
	'go.notifications': { hotkey: ['G', 'N'] },
	'go.messages': { hotkey: ['G', 'M'] },
	'list.next': { hotkey: 'J' },
	'list.previous': { hotkey: 'K' },
	'thread.new': { hotkey: 'C' },
	'thread.reply': { hotkey: 'R' },
	'thread.close': { hotkey: 'Escape' },
	'view.focus': { hotkey: '[' },
	'view.rail': { hotkey: '\\' },
	'post.like': { hotkey: 'L' },
	'post.accept': { hotkey: 'A' },
	'thread.markRead': { hotkey: 'M' },
})

declare module '@tanstack/react-hotkeys' {
	interface Register {
		appHotkeys: typeof appHotkeys
	}
}

export type HotkeyId = keyof typeof appHotkeys

export type HotkeyGroup = 'general' | 'go' | 'reading' | 'post'

/** How the `?` sheet names and groups each shortcut, in the order it lists them. */
export const HOTKEY_TEXT: Readonly<
	Record<HotkeyId, Readonly<{ group: HotkeyGroup; label: MessageDescriptor }>>
> = {
	'palette.open': { group: 'general', label: msg`命令面板` },
	'palette.slash': { group: 'general', label: msg`搜索` },
	'help.open': { group: 'general', label: msg`快捷键` },
	'go.home': { group: 'go', label: msg`前往概览` },
	'go.notifications': { group: 'go', label: msg`前往通知` },
	'go.messages': { group: 'go', label: msg`前往私信` },
	'list.next': { group: 'reading', label: msg`下一个主题` },
	'list.previous': { group: 'reading', label: msg`上一个主题` },
	'thread.new': { group: 'reading', label: msg`发布新主题` },
	'thread.reply': { group: 'reading', label: msg`回复` },
	'thread.close': { group: 'reading', label: msg`关闭主题` },
	'view.focus': { group: 'reading', label: msg`专注阅读` },
	'view.rail': { group: 'reading', label: msg`折叠版块栏` },
	'post.like': { group: 'post', label: msg`点赞` },
	'post.accept': { group: 'post', label: msg`采纳为答案` },
	'thread.markRead': { group: 'post', label: msg`标为已读` },
}

export const HOTKEY_GROUPS: ReadonlyArray<Readonly<{ id: HotkeyGroup; label: MessageDescriptor }>> =
	[
		{ id: 'general', label: msg`通用` },
		{ id: 'go', label: msg`跳转` },
		{ id: 'reading', label: msg`阅读` },
		{ id: 'post', label: msg({ message: '帖子', context: 'post' }) },
	]

/** Every shortcut id, in the order the sheet lists them. */
export const HOTKEY_IDS: readonly HotkeyId[] = [
	'palette.open',
	'palette.slash',
	'help.open',
	'go.home',
	'go.notifications',
	'go.messages',
	'list.next',
	'list.previous',
	'thread.new',
	'thread.reply',
	'thread.close',
	'view.focus',
	'view.rail',
	'post.like',
	'post.accept',
	'thread.markRead',
]

/** The visitor's platform from the request, so ⌘ / Ctrl labels match before and after hydration. */
export function platformFromRequest(request: Request): HotkeyPlatform {
	return detectPlatform(request.headers.get('user-agent'))
}
