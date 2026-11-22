import type {
	CategoryDto,
	MetaDto,
	PostDto,
	ThreadDto,
	UiSlot,
	UserDto,
	UserProfileDto,
} from '@pluxum/domain'
import type { Extensions } from '@tiptap/core'
import { useCallback, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { useRouteLoaderData } from 'react-router'
import type { I18n } from '@lingui/core'
import { useLingui } from '@lingui/react/macro'

import type { MenuItem } from '../components/ui/overlay'
import type { loader as rootLoader } from '../root'
import { AccountSettings } from './forum-accounts/account-settings'
import { AttachmentsFooter } from './forum-attachments/attachments'
import { AvatarEditor } from './forum-attachments/avatar'
import { MailSettings } from './forum-mail/mail-settings'
import { PushSettings } from './forum-push/push-settings'
import { UploadButton } from './forum-attachments/upload'
import { CategoryFollow, FollowSettings, UserFollow } from './forum-follows/follow'
import { ReportAction } from './forum-moderation/report-button'
import { UserBanTab } from './forum-moderation/user-ban-tab'
import { NotificationBell } from './forum-notifications/bell'
import { OutlineSidebar } from './forum-outline/outline'
import { MarkThreadRead } from './forum-reads/mark-read'
import { ReactionsFooter } from './forum-reactions/reactions'
import { AcceptAction, AcceptedMark, SolutionPin, SolvedBadge } from './forum-solved/solved'

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
	/** Above a floor on the thread page, between it and the one before (a divider, a notice). */
	'post.before': { post: PostDto; thread: ThreadDto }
	/**
	 * Below a top-level floor on the thread page, outside its card (an answer pinned under it).
	 * It sits in the list of floors, so a component that draws something draws an `<li>`.
	 */
	'post.after': { post: PostDto; thread: ThreadDto }
	/**
	 * Small tags beside a thread's pinned / locked markers, in lists and on its page; each tag
	 * takes `tagClassName`, which places it like those markers.
	 */
	'thread.badges': { thread: ThreadDto; tagClassName?: string }
	/**
	 * Beside a member's name, on their profile and in their hover card: counts and buttons.
	 * `compact` in the hover card, which has little room.
	 */
	'user.header': { user: UserDto; compact: boolean }
	'thread.sidebar': { thread: ThreadDto }
	/** Under a category's title: what extensions say about it or offer for it (follow, weather). */
	'category.header': { category: CategoryDto }
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
	'forum-follows': {
		'user.header': UserFollow,
		'category.header': CategoryFollow,
		'user.profile.tabs': FollowSettings,
	},
	'forum-solved': {
		'post.actions': AcceptAction,
		'post.footer': AcceptedMark,
		'post.after': SolutionPin,
		'thread.badges': SolvedBadge,
	},
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
	'forum-push': { 'user.profile.tabs': PushSettings },
	'forum-accounts': { 'user.profile.tabs': AccountSettings },
}

/**
 * `composer.editor`: what an extension adds to the rich-text editor. It hands over Tiptap
 * extensions (new marks, nodes, input rules, suggestion popups) that must only write Markdown the
 * forum's renderer already shows, such as links: the server stores and renders the Markdown, not
 * the editor's document. Each entry is loaded on demand together with the editor, so none of it
 * reaches pages without a text box.
 */
export type ComposerEditorExtension = Readonly<{ extensions: (i18n: I18n) => Extensions }>

const EDITOR_EXTENSIONS: Readonly<Record<string, () => Promise<ComposerEditorExtension>>> = {
	'forum-mentions': () => import('./forum-mentions/editor').then((module) => module.mentionsEditor),
}

/** The editor extensions running plugins ask for, as a key and a loader for their Tiptap parts. */
export function useComposerEditorExtensions(): Readonly<{
	key: string
	load: () => Promise<Extensions>
}> {
	const { i18n } = useLingui()
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
								return (await EDITOR_EXTENSIONS[id]?.())?.extensions(i18n) ?? []
							} catch {
								// An extension that fails to load leaves the editor without it.
								return []
							}
						}),
				)
				return loaded.flat()
			},
		}),
		[key, i18n],
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

/** What running extensions put above a floor of a thread. */
export function PostBeforeSlots({ post, thread }: { post: PostDto; thread: ThreadDto }) {
	return useFilled('post.before').map(([extId, Component]) => (
		<Component key={extId} post={post} thread={thread} />
	))
}

/** What running extensions put below a floor of a thread. */
export function PostAfterSlots({ post, thread }: { post: PostDto; thread: ThreadDto }) {
	return useFilled('post.after').map(([extId, Component]) => (
		<Component key={extId} post={post} thread={thread} />
	))
}

/** Tags running extensions put beside a thread's own markers. */
export function ThreadBadgeSlots({
	thread,
	tagClassName,
}: {
	thread: ThreadDto
	tagClassName?: string
}) {
	return useFilled('thread.badges').map(([extId, Component]) => (
		<Component key={extId} thread={thread} tagClassName={tagClassName} />
	))
}

/** What running extensions put beside a member's name. */
export function UserHeaderSlots({ user, compact = false }: { user: UserDto; compact?: boolean }) {
	return useFilled('user.header').map(([extId, Component]) => (
		<Component key={extId} user={user} compact={compact} />
	))
}

/** What running extensions put under a category's title. */
export function CategoryHeaderSlots({ category }: { category: CategoryDto }) {
	return useFilled('category.header').map(([extId, Component]) => (
		<Component key={extId} category={category} />
	))
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
