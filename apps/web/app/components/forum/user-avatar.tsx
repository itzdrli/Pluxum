import type { UserDto } from '@forum/domain'

import { avatarUrlOf } from '../../slots/forum-attachments/shared'
import { Avatar } from '../ui/display'

/** A user's avatar: the picture an extension attached to the user, or the monogram. */
export function UserAvatar({ user, size }: { user: UserDto; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
	return <Avatar name={user.displayName} src={avatarUrlOf(user)} size={size} />
}
