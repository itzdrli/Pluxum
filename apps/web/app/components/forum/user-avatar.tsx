import type { UserDto } from '@pluxum/domain'
import { useRouteLoaderData } from 'react-router'

import type { loader as rootLoader } from '../../root'
import { generatedAvatarOf } from '../../lib/generated-avatar'
import { avatarUrlOf } from '../../slots/forum-attachments/shared'
import { Avatar } from '../ui/display'

/**
 * A user's avatar: the picture an extension attached to the user, or a drawing generated from the
 * user id. Ghost, which holds deleted accounts' posts, has a drawing of its own.
 */
export function UserAvatar({ user, size }: { user: UserDto; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
	const ghostUserId = useRouteLoaderData<typeof rootLoader>('root')?.meta?.ghostUserId
	if (ghostUserId != null && user.id === ghostUserId) {
		return <Avatar name={user.displayName} art={<GhostArt />} size={size} />
	}
	return (
		<Avatar
			name={user.displayName}
			src={avatarUrlOf(user)}
			art={<img src={generatedAvatarOf(user.id)} alt="" className="size-full" />}
			size={size}
		/>
	)
}

/**
 * A small ghost in the theme's colours: the strong text tone on the control background, eyes cut
 * from the background, cheeks in the accent.
 */
function GhostArt() {
	return (
		<svg viewBox="0 0 32 32" className="size-full" role="presentation">
			<g>
				<path
					fill="var(--c-text-strong)"
					d="M6.5 27.5V14a9.5 9.5 0 0 1 19 0v13.5q-1.58 -2.4 -3.17 0t-3.16 0t-3.17 0t-3.17 0t-3.16 0t-3.17 0Z"
				/>
				<ellipse cx="12.6" cy="14.2" rx="1.7" ry="2.3" fill="var(--c-control)" />
				<ellipse cx="19.4" cy="14.2" rx="1.7" ry="2.3" fill="var(--c-control)" />
				<ellipse cx="16" cy="19.4" rx="1.15" ry="1.35" fill="var(--c-control)" />
				<circle cx="10.2" cy="18" r="1.3" fill="var(--c-accent)" opacity="0.6" />
				<circle cx="21.8" cy="18" r="1.3" fill="var(--c-accent)" opacity="0.6" />
			</g>
		</svg>
	)
}
