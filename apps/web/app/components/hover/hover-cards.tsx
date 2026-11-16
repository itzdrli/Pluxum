import type { ThreadDetailDto, UserProfileDto } from '@pluxum/domain'
import { MessageSquare } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Popover } from 'react-aria-components'

import { withoutLeadingTitle } from '../../lib/post-html'
import { excerptOf, previewTarget, type PreviewTarget } from '../../lib/preview'

type Card =
	| Readonly<{
			kind: 'thread'
			title: string
			category: string
			author: string
			replies: number
			floor: number | null
			excerpt: string
	  }>
	| Readonly<{ kind: 'user'; name: string; handle: string; threads: number; posts: number }>

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
					name: profile.user.displayName,
					handle: profile.user.handle,
					threads: profile.threadCount,
					posts: profile.postCount,
				}
	}
	const detail = await getJson<ThreadDetailDto>(
		`/threads/${encodeURIComponent(target.ref)}?pageSize=1`,
	)
	if (detail === null) return null
	return {
		kind: 'thread',
		title: detail.thread.title,
		category: detail.category.name,
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
	const [open, setOpen] = useState<{ anchor: HTMLAnchorElement; target: PreviewTarget } | null>(
		null,
	)
	const [card, setCard] = useState<{ key: string; value: Card | null } | null>(null)
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

	useEffect(() => {
		if (!window.matchMedia('(hover: hover)').matches) return undefined
		const clear = () => clearTimeout(timer.current)
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
			clear()
			timer.current = setTimeout(() => setOpen({ anchor, target }), OPEN_DELAY_MS)
		}
		const onOut = (event: MouseEvent) => {
			if (linkOf(event) === null) return
			clear()
			timer.current = setTimeout(() => setOpen(null), CLOSE_DELAY_MS)
		}
		document.addEventListener('mouseover', onOver)
		document.addEventListener('mouseout', onOut)
		return () => {
			clear()
			document.removeEventListener('mouseover', onOver)
			document.removeEventListener('mouseout', onOut)
		}
	}, [])

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
	return (
		<Popover
			isOpen
			isNonModal
			triggerRef={{ current: open.anchor }}
			placement="bottom start"
			offset={6}
			shouldCloseOnInteractOutside={() => false}
			className="border-line bg-panel shadow-overlay w-[320px] max-w-[calc(100vw-1rem)] rounded-[4px] border"
		>
			<div
				role="dialog"
				aria-label="链接预览"
				className="flex flex-col gap-1.5 p-3"
				onMouseEnter={() => clearTimeout(timer.current)}
				onMouseLeave={() => {
					timer.current = setTimeout(() => setOpen(null), CLOSE_DELAY_MS)
				}}
			>
				{shown.kind === 'thread' ? (
					<>
						<p className="text-ink-strong leading-snug font-bold break-words">{shown.title}</p>
						<p className="text-ink-weak flex flex-wrap items-center gap-x-2 text-meta">
							<span>{shown.category}</span>
							<span aria-hidden>·</span>
							<span>{shown.author}</span>
							<span className="flex items-center gap-1 tabular-nums">
								<MessageSquare aria-hidden size={12} />
								{shown.replies}
							</span>
							{shown.floor !== null && <span>指向第 {shown.floor} 楼</span>}
						</p>
						{shown.excerpt !== '' && (
							<p className="text-ink line-clamp-4 leading-relaxed break-words">{shown.excerpt}</p>
						)}
					</>
				) : (
					<>
						<p className="text-ink-strong font-bold">{shown.name}</p>
						<p className="text-ink-weak text-meta tabular-nums">
							@{shown.handle} · {shown.threads} 主题 · {shown.posts} 回复
						</p>
					</>
				)}
			</div>
		</Popover>
	)
}
