import type { MetaDto, PostDto, ThreadDto, UiSlot, UserProfileDto } from '@pluxum/domain'
import type { ComponentType } from 'react'
import { useRouteLoaderData } from 'react-router'

import type { loader as rootLoader } from '../root'
import { AttachmentsFooter } from './forum-attachments/attachments'
import { AvatarEditor } from './forum-attachments/avatar'
import { UploadButton } from './forum-attachments/upload'
import { ReportButton } from './forum-moderation/report-button'
import { UserBanTab } from './forum-moderation/user-ban-tab'
import { NotificationBell } from './forum-notifications/bell'
import { ReactionsFooter } from './forum-reactions/reactions'

/** Puts an uploaded file where the visitor is writing: an image in place, or a link. */
export type InsertAttachment = (
	item: Readonly<{ kind: 'image' | 'link'; text: string; href: string }>,
) => void

/** What each slot hands the components mounted in it. */
export type SlotProps = {
	'post.footer': { post: PostDto }
	'post.actions': { post: PostDto }
	'thread.sidebar': { thread: ThreadDto }
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
	'forum-moderation': {
		'post.actions': ReportButton,
		'user.profile.tabs': UserBanTab,
	},
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

export type PostSlot = Extract<MountedSlot, 'post.footer' | 'post.actions'>

/** Renders what running extensions contribute to a slot of a post; nothing when there is none. */
export function PostSlots({ slot, post }: { slot: PostSlot; post: PostDto }) {
	return useFilled(slot).map(([extId, Component]) => <Component key={extId} post={post} />)
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
