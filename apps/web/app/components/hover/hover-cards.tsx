import type { ThreadDetailDto, UserDto, UserProfileDto } from '@pluxum/domain'
import { MessageSquare } from 'lucide-react'
import { useDebouncer } from '@tanstack/react-pacer'
import { useEffect, useState } from 'react'
import { Popover } from 'react-aria-components'
import { useLingui } from '@lingui/react/macro'

import { withoutLeadingTitle } from '../../lib/post-html'
import { excerptOf, previewTarget, type PreviewTarget } from '../../lib/preview'
import { UserHeaderSlots } from '../../slots/slots'
import { STREAM_LABEL } from '../../lib/stream'

type Card =
	| Readonly<{
			kind: 'thread'
			/** Null for a note: it has no title and is named by its author. */
			title: string | null
			category: string | null
			author: string
			replies: number
			floor: number | null
			excerpt: string
	  }>
	| Readonly<{ kind: 'user'; user: UserDto; threads: number; posts: number; ghost: boolean }>

const OPEN_DELAY_MS = 350
const CLOSE_DELAY_MS = 180
const EXCERPT_CHARS = 150

const cache = new Map<string, Promise<Card | null>>()

async function getJson<T>(path: string): Promise<T | null> {
	try {
		const response = await fetch(`/api/forum${path}`)
		if (!response.ok) return null
		const body: T = await response.json()
		return body
	} catch {
		return null
	}
}

async function loadCard(target: PreviewTarget): Promise<Card | null> {
	if (target.kind === 'user') {
		const profile = await getJson<UserProfileDto>(
			`/users/${encodeURIComponent(target.handle)}?pageSize=1`,
		)
		return profile === null
			? null
			: {
					kind: 'user',
					user: profile.user,
					threads: profile.threadCount,
					posts: profile.postCount,
					ghost: profile.ghost,
				}
	}
	const detail = await getJson<ThreadDetailDto>(
		`/threads/${encodeURIComponent(target.ref)}?pageSize=1`,
	)
	if (detail === null) return null
	return {
		kind: 'thread',
		title: detail.thread.kind === 'note' ? null : detail.thread.title,
		// The stream is shown by the interface's word for notes, in the reader's language.
		category: detail.category.kind === 'stream' ? null : detail.category.name,
		author: detail.thread.author.displayName,
		replies: detail.thread.replyCount,
		floor: target.floor,
		excerpt: excerptOf(
			withoutLeadingTitle(detail.posts.items[0]?.bodyHtml ?? '', detail.thread.title),
			EXCERPT_CHARS,
		),
	}
}

function cardFor(target: PreviewTarget): Promise<Card | null> {
	const key = target.kind === 'user' ? `u:${target.handle}` : `t:${target.ref}`
	let loading = cache.get(key)
	if (loading === undefined) {
		// A failed lookup is tried again next time instead of being remembered.
		loading = loadCard(target).then((card) => {
			if (card === null) cache.delete(key)
			return card
		})
		cache.set(key, loading)
	}
	return loading
}

/**
 * Summaries on hover for the links inside posts that lead to a thread, a floor or a profile: the
 * title, category and opening lines of the thread, or the member's counts. One delegated listener
 * serves every post; nothing is fetched until the pointer rests on a link, and touch screens,
 * which cannot hover, are left alone.
 */
export function HoverCards() {
	const { t, i18n } = useLingui()
	const [open, setOpen] = useState<{ anchor: HTMLAnchorElement; target: PreviewTarget } | null>(
		null,
	)
	const [card, setCard] = useState<{ key: string; value: Card | null } | null>(null)
	// Opening waits for the pointer to rest on a link, closing gives it time to reach the card;
	// either replaces the other while it waits.
	const schedule = useDebouncer(setOpen, {
		wait: (debouncer) =>
			debouncer.store.state.lastArgs?.[0] == null ? CLOSE_DELAY_MS : OPEN_DELAY_MS,
	})
	const { maybeExecute, cancel } = schedule

	useEffect(() => {
		if (!window.matchMedia('(hover: hover)').matches) return undefined
		const linkOf = (event: Event): HTMLAnchorElement | null => {
			const element = event.target
			if (!(element instanceof Element)) return null
			const anchor = element.closest('a')
			return anchor?.closest('.post-body') ? anchor : null
		}
		const onOver = (event: MouseEvent) => {
			const anchor = linkOf(event)
			if (anchor === null) return
			const target = previewTarget(anchor.href, window.location.origin)
			if (target === null) return
			maybeExecute({ anchor, target })
		}
		const onOut = (event: MouseEvent) => {
			if (linkOf(event) === null) return
			maybeExecute(null)
		}
		document.addEventListener('mouseover', onOver)
		document.addEventListener('mouseout', onOut)
		return () => {
			cancel()
			document.removeEventListener('mouseover', onOver)
			document.removeEventListener('mouseout', onOut)
		}
	}, [maybeExecute, cancel])

	const key =
		open === null
			? null
			: open.target.kind === 'user'
				? `u:${open.target.handle}`
				: `t:${open.target.ref}`
	useEffect(() => {
		if (open === null || key === null) return undefined
		let current = true
		const show = async () => {
			const value = await cardFor(open.target)
			if (current) setCard({ key, value })
		}
		void show()
		return () => {
			current = false
		}
	}, [open, key])

	const shown = card !== null && card.key === key ? card.value : null
	if (open === null || shown === null) return null
	// Named locals: a member expression inside `t` would become an anonymous `{0}` placeholder.
	const noteAuthor = shown.kind === 'thread' ? shown.author : ''
	const floor = shown.kind === 'thread' ? shown.floor : null
	const threads = shown.kind === 'user' ? shown.threads : 0
	const posts = shown.kind === 'user' ? shown.posts : 0
	return (
		<Popover
			isOpen
			isNonModal
			triggerRef={{ current: open.anchor }}
			placement="bottom start"
			offset={6}
			shouldCloseOnInteractOutside={() => false}
			className="popover-motion border-line bg-panel shadow-overlay w-[320px] max-w-[calc(100vw-1rem)] rounded-[2px] border"
		>
			<div
				role="dialog"
				aria-label={t`链接预览`}
				className="flex flex-col gap-1.5 p-3"
				onMouseEnter={cancel}
				onMouseLeave={() => maybeExecute(null)}
			>
				{shown.kind === 'thread' ? (
					<>
						<p className="text-ink-strong leading-snug font-bold break-words">
							{shown.title ?? t`${noteAuthor} 的动态`}
						</p>
						<p className="text-ink-weak flex flex-wrap items-center gap-x-2 text-meta">
							<span>{shown.category ?? i18n._(STREAM_LABEL)}</span>
							<span aria-hidden>·</span>
							<span>{shown.author}</span>
							<span className="flex items-center gap-1 tabular-nums">
								<MessageSquare aria-hidden size={12} />
								{shown.replies}
							</span>
							{floor !== null && <span>{t`指向第 ${floor} 楼`}</span>}
						</p>
						{shown.excerpt !== '' && (
							<p className="text-ink line-clamp-4 leading-relaxed break-words">{shown.excerpt}</p>
						)}
					</>
				) : (
					<>
						<p className="text-ink-strong font-bold">{shown.user.displayName}</p>
						{shown.ghost ? (
							<p className="text-ink-weak text-meta">@{shown.user.handle}</p>
						) : (
							<>
								<p className="text-ink-weak text-meta tabular-nums">
									@{shown.user.handle} · {t`${threads} 主题`} · {t`${posts} 回复`}
								</p>
								<UserHeaderSlots user={shown.user} compact />
							</>
						)}
					</>
				)}
			</div>
		</Popover>
	)
}
