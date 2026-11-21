import { createAvatar } from '@dicebear/core'
import * as thumbs from '@dicebear/thumbs'

const cache = new Map<string, string>()
const CACHE_LIMIT = 500

/**
 * The picture for a user who hasn't uploaded one: a DiceBear "Thumbs" drawing (CC0) seeded by the
 * user id, so it stays the same across renames and between server and client renders. Returned as
 * a data URI for an `<img>`, which keeps each drawing's mask ids out of the page's id space.
 */
export function generatedAvatarOf(userId: string): string {
	const cached = cache.get(userId)
	if (cached !== undefined) return cached
	// The RDF licence block is attribution the CC0 drawing doesn't require; drop it to save bytes.
	const svg = createAvatar(thumbs, { seed: userId })
		.toString()
		.replace(/<metadata[\s\S]*?<\/metadata>/, '')
	const uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
	if (cache.size >= CACHE_LIMIT) {
		const oldest = cache.keys().next().value
		if (oldest !== undefined) cache.delete(oldest)
	}
	cache.set(userId, uri)
	return uri
}
