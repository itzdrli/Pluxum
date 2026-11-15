import type { PostDto, UiSlot } from '@forum/domain'
import type { ComponentType } from 'react'
import { useRouteLoaderData } from 'react-router'

import type { loader as rootLoader } from '../root'
import { ReactionsFooter } from './forum-reactions/reactions'

/** The slots that pages mount today, all of them on a post. */
export type PostSlot = Extract<UiSlot, 'post.footer' | 'post.actions'>

export type PostSlotComponent = ComponentType<{ post: PostDto }>

/**
 * The slot components this build ships, by extension ID. They are compiled into the frontend;
 * whether one renders is decided at run time by `/meta`, which lists a slot only while the
 * extension plugin behind it is running. Adding an extension's UI means adding its folder here.
 */
const EXTENSIONS: Readonly<Record<string, Partial<Record<PostSlot, PostSlotComponent>>>> = {
	'forum-reactions': { 'post.footer': ReactionsFooter },
}

/** Renders what running extensions contribute to a slot of a post; nothing when there is none. */
export function PostSlots({ slot, post }: { slot: PostSlot; post: PostDto }) {
	const filled = useRouteLoaderData<typeof rootLoader>('root')?.meta?.uiSlots ?? []
	return filled
		.filter((entry) => entry.slot === slot)
		.map((entry) => {
			const Component = EXTENSIONS[entry.extId]?.[slot]
			// An extension newer than this build has no component here yet; skip it.
			return Component === undefined ? null : <Component key={entry.extId} post={post} />
		})
}
