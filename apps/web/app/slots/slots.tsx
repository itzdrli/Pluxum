import type { MetaDto, PostDto, ThreadDto, UiSlot, UserProfileDto } from '@pluxum/domain'
import type { Extensions } from '@tiptap/core'
import { useCallback, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { useRouteLoaderData } from 'react-router'

import type { MenuItem } from '../components/ui/overlay'
import type { loader as rootLoader } from '../root'
import { AttachmentsFooter } from './forum-attachments/attachments'
import { AvatarEditor } from './forum-attachments/avatar'
import { MailSettings } from './forum-mail/mail-settings'
import { UploadButton } from './forum-attachments/upload'
import { ReportAction } from './forum-moderation/report-button'
import { UserBanTab } from './forum-moderation/user-ban-tab'
import { NotificationBell } from './forum-notifications/bell'
import { OutlineSidebar } from './forum-outline/outline'
import { MarkThreadRead } from './forum-reads/mark-read'
import { ReactionsFooter } from './forum-reactions/reactions'

/** Puts an uploaded file where the visitor is writing: an image in place, or a link. */
export type InsertAttachment = (
	item: Readonly<{ kind: 'image' | 'link'; text: string; href: string }>,
) => void

/** What each slot hands the components mounted in it. */
export type SlotProps = {
	'post.footer': { post: PostDto }
	/**
	 * Actions on a post live in its "…" menu, so an extension does not draw a button: it hands its
	 * menu items to `setMenuItems` (from an effect) and renders only what those items open, such
	 * as a dialog, or nothing.
	 */
	'post.actions': { post: PostDto; setMenuItems: (items: readonly MenuItem[]) => void }
	'thread.sidebar': { thread: ThreadDto }
	/** Mounted while a thread is on screen; `atEnd` is true on its last page. Draws nothing, usually. */
	'thread.view': { thread: ThreadDto; atEnd: boolean }
	'composer.toolbar': { insert: InsertAttachment }
	'user.profile.tabs': { profile: UserProfileDto }
	'shell.actions': { meta: MetaDto | null }
}

export type MountedSlot = Extract<UiSlot, keyof SlotProps>

type SlotComponents = { [S in MountedSlot]?: ComponentType<SlotProps[S]> }

/**
 * The slot components this build ships, by extension ID. They are compiled into the frontend;
 * whether one renders is decided at run time by `/meta`, which lists a slot only while the
 * extension plugin behind it is running. Adding an extension's UI means adding its folder here.
 */
const EXTENSIONS: Readonly<Record<string, SlotComponents>> = {
	'forum-reactions': { 'post.footer': ReactionsFooter },
	'forum-attachments': {
		'post.footer': AttachmentsFooter,
		'composer.toolbar': UploadButton,
		'user.profile.tabs': AvatarEditor,
	},
	'forum-notifications': {
		'shell.actions': NotificationBell,
	},
	'forum-reads': { 'thread.view': MarkThreadRead },
	'forum-outline': { 'thread.sidebar': OutlineSidebar },
	'forum-moderation': {
		'post.actions': ReportAction,
		'user.profile.tabs': UserBanTab,
	},
	'forum-mail': { 'user.profile.tabs': MailSettings },
}

/**
 * `composer.editor`: what an extension adds to the rich-text editor. It hands over Tiptap
 * extensions (new marks, nodes, input rules, suggestion popups) that must only write Markdown the
 * forum's renderer already shows, such as links: the server stores and renders the Markdown, not
 * the editor's document. Each entry is loaded on demand together with the editor, so none of it
 * reaches pages without a text box.
 */
export type ComposerEditorExtension = Readonly<{ extensions: () => Extensions }>

const EDITOR_EXTENSIONS: Readonly<Record<string, () => Promise<ComposerEditorExtension>>> = {
	'forum-mentions': () => import('./forum-mentions/editor').then((module) => module.mentionsEditor),
}

/** The editor extensions running plugins ask for, as a key and a loader for their Tiptap parts. */
export function useComposerEditorExtensions(): Readonly<{
	key: string
	load: () => Promise<Extensions>
}> {
	const filled = useRouteLoaderData<typeof rootLoader>('root')?.meta?.uiSlots ?? []
	const ids = filled
		.filter((entry) => entry.slot === 'composer.editor' && entry.extId in EDITOR_EXTENSIONS)
		.map((entry) => entry.extId)
	const key = ids.join(',')
	return useMemo(
		() => ({
			key,
			load: async () => {
				const loaded = await Promise.all(
					key
						.split(',')
						.filter(Boolean)
						.map(async (id) => {
							try {
								return (await EDITOR_EXTENSIONS[id]?.())?.extensions() ?? []
							} catch {
								// An extension that fails to load leaves the editor without it.
								return []
							}
						}),
				)
				return loaded.flat()
			},
		}),
		[key],
	)
}

/** The components running extensions put into a slot, in the order `/meta` lists them. */
function useFilled<S extends MountedSlot>(
	slot: S,
): Array<readonly [string, ComponentType<SlotProps[S]>]> {
	const filled = useRouteLoaderData<typeof rootLoader>('root')?.meta?.uiSlots ?? []
	return filled.flatMap((entry) => {
		if (entry.slot !== slot) return []
		const Component = EXTENSIONS[entry.extId]?.[slot]
		// An extension newer than this build has no component here yet; skip it.
		return Component === undefined ? [] : [[entry.extId, Component] as const]
	})
}

/** Renders what running extensions put under a post; nothing when there is none. */
export function PostFooterSlots({ post }: { post: PostDto }) {
	return useFilled('post.footer').map(([extId, Component]) => <Component key={extId} post={post} />)
}

/**
 * The menu items running extensions add to a post's "…" menu, in `/meta` order, and the element
 * that mounts them (their dialogs). Render `slots` once inside the post.
 */
export function usePostMenuSlots(post: PostDto): { items: MenuItem[]; slots: ReactNode } {
	const filled = useFilled('post.actions')
	const [byExt, setByExt] = useState<Readonly<Record<string, readonly MenuItem[]>>>({})
	const setterFor = useCallback(
		(extId: string) => (items: readonly MenuItem[]) =>
			setByExt((current) => (current[extId] === items ? current : { ...current, [extId]: items })),
		[],
	)
	const items = filled.flatMap(([extId]) => byExt[extId] ?? [])
	const slots = filled.map(([extId, Component]) => (
		<SetterBound key={extId} extId={extId} setterFor={setterFor}>
			{(setMenuItems) => <Component post={post} setMenuItems={setMenuItems} />}
		</SetterBound>
	))
	return { items, slots }
}

/** Keeps one extension's setter stable across renders, so its effect does not loop. */
function SetterBound({
	extId,
	setterFor,
	children,
}: {
	extId: string
	setterFor: (extId: string) => (items: readonly MenuItem[]) => void
	children: (setMenuItems: (items: readonly MenuItem[]) => void) => ReactNode
}) {
	const [setMenuItems] = useState(() => setterFor(extId))
	return children(setMenuItems)
}

/** Buttons running extensions add to the composer's toolbar. */
export function ComposerToolbarSlots({ insert }: { insert: InsertAttachment }) {
	return useFilled('composer.toolbar').map(([extId, Component]) => (
		<Component key={extId} insert={insert} />
	))
}

/** Sections running extensions add to a user's profile page. */
export function ProfileSlots({ profile }: { profile: UserProfileDto }) {
	return useFilled('user.profile.tabs').map(([extId, Component]) => (
		<Component key={extId} profile={profile} />
	))
}

/** Whether at least one running extension has a mounted component for `slot`. */
export function useHasFilledSlot(slot: MountedSlot): boolean {
	return useFilled(slot).length > 0
}

/** Sections running extensions add to a thread's sidebar. */
export function ThreadSidebarSlots({ thread }: { thread: ThreadDto }) {
	return useFilled('thread.sidebar').map(([extId, Component]) => (
		<Component key={extId} thread={thread} />
	))
}

/** Actions running extensions add to the top shell bar. */
export function ShellSlots({ meta }: { meta: MetaDto | null }) {
	return useFilled('shell.actions').map(([extId, Component]) => (
		<Component key={extId} meta={meta} />
	))
}

/** Things running extensions do while a thread is on screen (they usually draw nothing). */
export function ThreadViewSlots({ thread, atEnd }: { thread: ThreadDto; atEnd: boolean }) {
	return useFilled('thread.view').map(([extId, Component]) => (
		<Component key={extId} thread={thread} atEnd={atEnd} />
	))
}
