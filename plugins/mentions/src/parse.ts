import { parseUserRef } from '@pluxum/domain'

/** At most this many people are notified from one post; the rest are ignored. */
export const MENTION_LIMIT = 10

/**
 * `[@名字](/u/handle)`: how the composer writes a mention. It is an ordinary Markdown link to a
 * profile, so it renders (and gets a hover card) without the renderer knowing about mentions.
 */
const MENTION = /\[@[^\]\n]{1,64}\]\(\/u\/([^)\s/?#]{1,64})\)/gu

/** Code spans and fenced blocks, where a mention is only an example. */
const CODE = /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/gu

/** The distinct user refs (handles or IDs) a Markdown body mentions, in order of appearance. */
export function mentionedRefs(body: string): string[] {
	const refs = new Set<string>()
	for (const match of body.replaceAll(CODE, '').matchAll(MENTION)) {
		const ref = parseUserRef(match[1] ?? '')
		if (!ref) continue
		refs.add(ref.kind === 'id' ? ref.id : ref.handle)
		if (refs.size >= MENTION_LIMIT) break
	}
	return [...refs]
}
