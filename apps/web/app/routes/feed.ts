// Atom feeds: `/feed.xml` (new threads across the site), `/c/<slug>/feed.xml` (one category) and
// `/u/<handle>/feed.xml` (one person's topics and notes). Always read as a guest, so a feed shows
// what anyone may see and can be cached and shared.
import type { ThreadDto } from '@pluxum/domain'
import type { LoaderFunctionArgs } from 'react-router'

import { absolutizeHtml, clip, renderAtom, textOf, type Feed, type FeedEntry } from '../lib/feed'
import { forumApi } from '../lib/forum-api.server'
import { withoutLeadingTitle } from '../lib/post-html'
import { siteOf } from '../lib/site'

const FEED_SIZE = 20
const NOTE_TITLE_MAX = 60
const TTL_MS = 5 * 60_000
const CACHE_MAX = 300

const cache = new Map<string, Readonly<{ expires: number; body: string }>>()

/** The same request without the visitor's session. */
function guestOf(request: Request): Request {
	return new Request(request.url, { signal: request.signal })
}

function atom(body: string): Response {
	return new Response(body, {
		headers: {
			'content-type': 'application/atom+xml; charset=utf-8',
			'cache-control': 'public, max-age=300',
		},
	})
}

function notFound(): Response {
	return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } })
}

/** The thread as a feed entry; a topic's body is read from its page, a note's rides along. */
async function entryOf(
	guest: Request,
	origin: string,
	thread: ThreadDto,
	category: string | undefined,
): Promise<FeedEntry> {
	let opening = thread.opening
	if (opening === undefined) {
		const detail = await forumApi.thread(guest, thread.ref)
		if (detail.ok) opening = detail.value.posts.items.find((post) => post.number === 1)
	}
	const html =
		opening === undefined
			? undefined
			: absolutizeHtml(
					thread.kind === 'note'
						? opening.bodyHtml
						: withoutLeadingTitle(opening.bodyHtml, thread.title),
					origin,
				)
	const title =
		thread.title !== ''
			? thread.title
			: clip(textOf(opening?.bodyHtml ?? ''), NOTE_TITLE_MAX) || `#${thread.number}`
	return {
		url: `${origin}/t/${thread.ref}`,
		title,
		authorName: thread.author.displayName,
		authorUrl: `${origin}/u/${thread.author.handle}`,
		published: thread.createdAt,
		updated: opening?.editedAt ?? thread.createdAt,
		category,
		html,
	}
}

function newestFirst<T extends Pick<ThreadDto, 'createdAt'>>(threads: readonly T[]): T[] {
	return threads.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, FEED_SIZE)
}

async function buildFeed(
	request: Request,
	params: LoaderFunctionArgs['params'],
	origin: string,
	selfUrl: string,
): Promise<Feed | null> {
	const guest = guestOf(request)
	const meta = await forumApi.meta(guest)
	const site = siteOf({ meta: meta.ok ? meta.value : null })
	const iconUrl = new URL(site.brand.icon ?? '/favicon.svg', origin).toString()
	const base = { selfUrl, iconUrl }

	if (params.slug !== undefined) {
		const listed = await forumApi.categoryThreads(guest, params.slug)
		if (!listed.ok) return null
		const { category, threads } = listed.value
		const entries = await Promise.all(
			newestFirst(threads.items).map((thread) => entryOf(guest, origin, thread, category.name)),
		)
		return {
			...base,
			title: `${category.name} · ${site.name}`,
			subtitle: category.description || undefined,
			pageUrl: `${origin}/c/${category.slug}`,
			entries,
		}
	}

	if (params.userId !== undefined) {
		const [topics, notes] = await Promise.all([
			forumApi.userProfile(guest, params.userId, 1, 'topic'),
			forumApi.userProfile(guest, params.userId, 1, 'note'),
		])
		if (!topics.ok || topics.value.ghost) return null
		const { user } = topics.value
		const threads = newestFirst([
			...topics.value.threads.items,
			...(notes.ok ? notes.value.threads.items : []),
		])
		const entries = await Promise.all(
			threads.map((thread) => entryOf(guest, origin, thread, undefined)),
		)
		return {
			...base,
			title: `${user.displayName} · ${site.name}`,
			pageUrl: `${origin}/u/${user.handle}`,
			entries,
		}
	}

	const recent = await forumApi.recentThreads(guest, 1, FEED_SIZE, { sort: 'new', scope: 'all' })
	if (!recent.ok) return null
	const entries = await Promise.all(
		recent.value.items.map((thread) => entryOf(guest, origin, thread, thread.category.name)),
	)
	return {
		...base,
		title: site.name,
		subtitle: site.description || undefined,
		pageUrl: `${origin}/`,
		entries,
	}
}

export async function loader({ request, params }: LoaderFunctionArgs) {
	const url = new URL(request.url)
	// Behind the TLS proxy request.url says http://; links in a feed must be the public ones.
	const origin = process.env.FORUM_WEB_PUBLIC_ORIGIN || url.origin
	const key = url.pathname
	const hit = cache.get(key)
	if (hit !== undefined && hit.expires > Date.now()) return atom(hit.body)
	const feed = await buildFeed(request, params, origin, `${origin}${url.pathname}`)
	if (feed === null) return notFound()
	const body = renderAtom(feed)
	cache.delete(key)
	cache.set(key, { expires: Date.now() + TTL_MS, body })
	if (cache.size > CACHE_MAX) {
		const oldest = cache.keys().next()
		if (!oldest.done) cache.delete(oldest.value)
	}
	return atom(body)
}
