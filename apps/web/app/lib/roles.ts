import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import type { Role } from '@pluxum/domain'

/** What each role is called in the interface; translate with `i18n._(ROLE_LABELS[role])`. */
export const ROLE_LABELS: Readonly<Record<Role, MessageDescriptor>> = {
	guest: msg`游客`,
	member: msg`成员`,
	moderator: msg`版主`,
	admin: msg`管理员`,
}
