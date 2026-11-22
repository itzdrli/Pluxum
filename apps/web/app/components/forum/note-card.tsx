import type { CategoryDto, PostDto, ThreadDto } from '@pluxum/domain'
import { MessageSquare, Send } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import { Trans, useLingui } from '@lingui/react/macro'

import { PostFooterSlots } from '../../slots/slots'
import { Composer } from '../composer/composer'
import { StageLink, useStageNavigate } from '../stage/stage'
import { Button } from '../ui/button'
import { FormError, Panel, Timestamp } from '../ui/display'
import { imagesForClick, useLightbox } from '../ui/lightbox'
import { UnreadDot } from './rows'
import { UserAvatar } from './user-avatar'

/** Whether a click landed on something of its own (a link, a button, a field) inside the card. */
function onOwnControl(target: EventTarget | null, card: HTMLElement): boolean {
	const element = target instanceof Element ? target : null
	const control = element?.closest('a, button, input, textarea, select, [role="button"], label')
	return control !== null && control !== undefined && card.contains(control)
}

/**
 * A note in a list, as a card: who wrote it and when, what it says (long ones fold), what
 * extensions put under it (likes, images), how many replies it has and, in the overview feed, the
 * newest of them. Clicking the card away from its own links opens the note beside the list, like a
 * row's title does; clicking the newest reply opens the note at that reply.
 */
export function NoteCard({
	thread,
	href,
	isActive = false,
	category,
	showAuthor = true,
	fresh = false,
}: {
	thread: ThreadDto
	href: string
	isActive?: boolean
	/** Just posted from the box on this page: lit up for a moment where it landed. */
	fresh?: boolean
	/** Lists that mix categories name the stream, like a row names its category. */
	category?: Pick<CategoryDto, 'slug' | 'name'>
	showAuthor?: boolean
}) {
	const { t } = useLingui()
	const navigate = useStageNavigate()
	const lightbox = useLightbox()
	const opening = thread.opening
	const body = useRef<HTMLDivElement>(null)
	// Long notes fold to a few lines; the fold only shows once the body is known to overflow.
	const [overflows, setOverflows] = useState(false)
	const [unfolded, setUnfolded] = useState(false)
	useEffect(() => {
		const element = body.current
		if (element === null) return undefined
		const check = () => setOverflows(element.scrollHeight > element.clientHeight + 1)
		check()
		const observer = new ResizeObserver(check)
		observer.observe(element)
		return () => observer.disconnect()
	}, [])

	return (
		<li
			className={`hover:bg-hover relative cursor-pointer border-l-2 px-5 py-4 transition-colors ${
				isActive ? 'border-l-accent bg-selected' : 'border-l-transparent'
			}${fresh ? ' animate-fresh-in' : ''}`}
			onClick={(event) => {
				const card = event.currentTarget
				const found = lightbox ? imagesForClick(event, card) : null
				if (lightbox && found) {
					event.preventDefault()
					lightbox(found.images, found.index)
					return
				}
				if (onOwnControl(event.target, card)) return
				// Selecting text is not a click on the card.
				if ((window.getSelection()?.toString() ?? '') !== '') return
				const reply =
					event.target instanceof Element ? event.target.closest('[data-reply-href]') : null
				void navigate(reply?.getAttribute('data-reply-href') ?? href)
			}}
		>
			<div className="flex items-start gap-3">
				{showAuthor && (
					<StageLink to={`/u/${thread.author.handle}`} tabIndex={-1} aria-hidden>
						<UserAvatar user={thread.author} />
					</StageLink>
				)}
				<div className="min-w-0 flex-1">
					<p className="text-ink-weak flex min-w-0 items-center gap-x-2 text-meta">
						{showAuthor && (
							<StageLink
								to={`/u/${thread.author.handle}`}
								className="text-ink-strong min-w-0 truncate font-bold hover:underline"
							>
								{thread.author.displayName}
							</StageLink>
						)}
						{category !== undefined && (
							<>
								{showAuthor && <span aria-hidden>·</span>}
								<StageLink
									to={`/c/${category.slug}`}
									prefetch="intent"
									className="hover:text-ink-strong shrink-0 hover:underline"
								>
									{category.name}
								</StageLink>
							</>
						)}
						<span aria-hidden>·</span>
						{/* The note's own link: what keyboard and screen-reader users open it by. */}
						<StageLink
							to={href}
							prefetch="intent"
							data-thread-link
							aria-current={isActive ? 'page' : undefined}
							className="hover:text-ink-strong shrink-0 whitespace-nowrap hover:underline"
						>
							<Timestamp iso={thread.createdAt} />
							<span className="sr-only">
								<Trans context="screen-reader suffix after a note's time">的动态</Trans>
							</span>
						</StageLink>
						{/* A note has no title to lead with: the mark closes its line, at the card's edge. */}
						<UnreadDot thread={thread} hidden={isActive} className="ml-auto" />
					</p>
					{opening !== undefined && (
						<>
							<div
								ref={body}
								className={`post-body note-body mt-1.5${opening.bodyFormat === 'plain' ? ' post-body--plain' : ''}${
									unfolded ? '' : ' note-body--folded'
								}${overflows && !unfolded ? ' note-body--fade' : ''}`}
								// The forum core has already filtered this HTML against its allowlist.
								dangerouslySetInnerHTML={{ __html: opening.bodyHtml }}
							/>
							{(overflows || unfolded) && (
								<button
									type="button"
									className="text-accent mt-1 cursor-pointer text-meta hover:underline"
									onClick={() => setUnfolded((open) => !open)}
								>
									{unfolded ? t`收起` : t`展开全文`}
								</button>
							)}
						</>
					)}
					<div className="-ml-2.5 flex flex-wrap items-center [&>*]:px-0! [&>*]:pb-0!">
						{opening !== undefined && <PostFooterSlots post={opening} />}
						<StageLink
							to={href}
							prefetch="intent"
							className="text-ink-weak hover:text-ink-strong ml-2.5 flex h-8 items-center gap-1 text-meta tabular-nums"
						>
							<MessageSquare aria-hidden size={14} />
							{thread.replyCount > 0 ? thread.replyCount : t({ message: '回复', context: 'verb' })}
							{thread.replyCount > 0 && (
								<span className="sr-only">
									<Trans>条回复</Trans>
								</span>
							)}
						</StageLink>
					</div>
					{thread.latestReply !== undefined && (
						<LatestReply
							reply={thread.latestReply}
							href={`${href}?floor=${thread.latestReply.number}`}
						/>
					)}
				</div>
			</div>
		</li>
	)
}

/**
 * A note's newest reply under its card, quoted and cut to two lines. Its body may hold links, so
 * it is no link itself: the card's click opens the note at this reply, and the time is the link
 * keyboard and screen-reader users take.
 */
function LatestReply({ reply, href }: { reply: PostDto; href: string }) {
	return (
		<div data-reply-href={href} className="border-line mt-1 border-l-2 py-0.5 pl-3">
			<p className="text-ink-weak flex min-w-0 items-center gap-x-2 text-meta">
				<UserAvatar user={reply.author} size="sm" />
				<StageLink
					to={`/u/${reply.author.handle}`}
					className="text-ink-strong min-w-0 truncate font-bold hover:underline"
				>
					{reply.author.displayName}
				</StageLink>
				<span aria-hidden>·</span>
				<StageLink
					to={href}
					prefetch="intent"
					className="hover:text-ink-strong shrink-0 whitespace-nowrap hover:underline"
				>
					<Timestamp iso={reply.createdAt} />
					<span className="sr-only">
						<Trans context="screen-reader suffix after the newest reply's time">的回复</Trans>
					</span>
				</StageLink>
			</p>
			<div
				className={`post-body note-reply mt-0.5${reply.bodyFormat === 'plain' ? ' post-body--plain' : ''}`}
				// The forum core has already filtered this HTML against its allowlist.
				dangerouslySetInnerHTML={{ __html: reply.bodyHtml }}
			/>
		</div>
	)
}

/** What the home route's action answers a note with. */
type NoteResult = { posted: string } | { noteError: string }

/**
 * "发动态": a light box at the top of a feed, like a microblog's. It posts a note (no title, a
 * short body) to the stream through the home route's action (`intent=note`), from any page, by a
 * fetcher: the page stays where it is and learns the new note's id, so it can show it. `aside`
 * sits beside the closed box, for the way to the full topic composer: one place to write from.
 */
export function NoteComposer({
	max,
	aside,
	onPosted,
}: {
	max: number | undefined
	aside?: React.ReactNode
	/** Called once per note posted, with its id, after the lists have reloaded. */
	onPosted?: (id: string) => void
}) {
	const { t } = useLingui()
	const fetcher = useFetcher<NoteResult>({ key: 'note' })
	const submitting = fetcher.state !== 'idle'
	const [open, setOpen] = useState(false)
	// Bumped after each note, which remounts the form and so empties the box.
	const [round, setRound] = useState(0)
	const handled = useRef<string | null>(null)
	const result = fetcher.state === 'idle' ? fetcher.data : undefined
	const posted = result !== undefined && 'posted' in result ? result.posted : null
	const error = result !== undefined && 'noteError' in result ? result.noteError : undefined
	useEffect(() => {
		if (posted === null || handled.current === posted) return
		handled.current = posted
		setOpen(false)
		setRound((n) => n + 1)
		onPosted?.(posted)
	}, [posted, onPosted])

	return (
		<Panel as="section" aria-label={t`发动态`} className="mb-4 p-3">
			{open ? (
				<fetcher.Form method="post" action="/?index" className="flex flex-col gap-2" key={round}>
					<input type="hidden" name="intent" value="note" />
					<FormError message={error} />
					<Composer
						label={t`动态内容`}
						hideLabel
						required
						maxLength={max}
						rows={3}
						placeholder={t`分享点什么…`}
						autoFocus
					/>
					<div className="flex items-center justify-end gap-2">
						<Button tone="ghost" size="sm" onPress={() => setOpen(false)}>
							<Trans>收起</Trans>
						</Button>
						<Button tone="primary" size="sm" type="submit" isPending={submitting}>
							<Send aria-hidden />
							<Trans context="verb">发布</Trans>
						</Button>
					</div>
				</fetcher.Form>
			) : (
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={() => setOpen(true)}
						className="bg-control text-ink-weak hover:text-ink h-control min-w-0 flex-1 cursor-text truncate rounded-[2px] px-3 text-left"
					>
						<Trans>分享点什么…</Trans>
					</button>
					{aside}
				</div>
			)}
			{!open && error !== undefined && <FormError message={error} />}
		</Panel>
	)
}
