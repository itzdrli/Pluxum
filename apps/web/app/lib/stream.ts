// The stream is a built-in place, not a category an admin names: wherever it shows, it carries the
// interface's own word for notes, in the reader's language, rather than its stored name.

import type { I18n } from '@lingui/core'
import { msg } from '@lingui/core/macro'

export const STREAM_LABEL = msg({ message: '动态', context: 'tab: notes' })

/** A category's name as shown: the stream's translated label, any other category's own name. */
export function categoryLabel(
	category: Readonly<{ id: string; name: string }>,
	stream: Readonly<{ id: string }> | null | undefined,
	i18n: I18n,
): string {
	return stream != null && category.id === stream.id ? i18n._(STREAM_LABEL) : category.name
}
