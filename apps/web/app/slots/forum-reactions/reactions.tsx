import type { PostDto } from '@pluxum/domain'
import { Lightbulb, ThumbsUp } from 'lucide-react'
import { useFetcher, useRouteLoaderData } from 'react-router'
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'

import { Button } from '../../components/ui/button'
import { useThreadContext } from '../../lib/thread-context'
import type { loader as rootLoader } from '../../root'
import type { ExtActionResult } from '../../routes/ext-action'

const EXT_ID = 'forum-reactions'

type Kind = 'like' | 'useful'
type Tally = Readonly<{ count: number; reacted: boolean }>

const NONE: Tally = { count: 0, reacted: false }

function tallyOf(value: unknown): Tally | null {
	if (typeof value === 'object' && value !== null && 'count' in value && 'reacted' in value) {
		const { count, reacted } = value
		if (typeof count === 'number' && typeof reacted === 'boolean') return { count, reacted }
	}
	return null
}

/**
 * The plugin's data on a post: likes at the top level, 「有用」 under `useful`. It crosses the API
 * untyped, so its shape is checked here.
 */
function summaryOf(value: unknown): Readonly<{ like: Tally; useful: Tally }> {
	const useful =
		typeof value === 'object' && value !== null && 'useful' in value ? tallyOf(value.useful) : null
	return { like: tallyOf(value) ?? NONE, useful: useful ?? NONE }
}

const LABELS: Record<
	Kind,
	Readonly<{ on: MessageDescriptor; off: MessageDescriptor; count: MessageDescriptor }>
> = {
	like: { on: msg`取消点赞`, off: msg`点赞`, count: msg`人点赞` },
	useful: { on: msg`取消「有用」`, off: msg`有用`, count: msg`人觉得有用` },
}

/** One reaction's button with its count; while the request is on its way, the state it asks for. */
function ReactionButton({ post, kind, saved }: { post: PostDto; kind: Kind; saved: Tally }) {
	const { i18n } = useLingui()
	const fetcher = useFetcher<ExtActionResult>()
	const pending: unknown = fetcher.json
	const asked =
		typeof pending === 'object' && pending !== null && 'on' in pending
			? pending.on === true
			: undefined
	const shown: Tally =
		asked === undefined || asked === saved.reacted
			? saved
			: { reacted: asked, count: Math.max(0, saved.count + (asked ? 1 : -1)) }
	const error =
		fetcher.state === 'idle' && fetcher.data?.ok === false ? fetcher.data.error : undefined
	const labels = LABELS[kind]
	const Icon = kind === 'like' ? ThumbsUp : Lightbulb
	// The like is a bare icon; 「有用」 says what it is, an icon alone would not.
	const showText = kind === 'useful'
	return (
		<>
			<Button
				tone="ghost"
				size="sm"
				aria-pressed={shown.reacted}
				aria-label={i18n._(shown.reacted ? labels.on : labels.off)}
				{...{ title: i18n._(shown.reacted ? labels.on : labels.off) }}
				className={`${shown.count > 0 || showText ? 'px-2' : 'button--icon-only'} ${shown.reacted ? 'text-accent' : 'text-ink-weak'}`}
				onPress={() =>
					fetcher.submit(
						{ postId: post.id, kind, on: !shown.reacted },
						{ method: 'post', action: `/ext/${EXT_ID}/react`, encType: 'application/json' },
					)
				}
			>
				{/* Keyed by the state, so each reaction pops (only when pressed, not on load). */}
				<Icon
					key={shown.reacted ? 'on' : 'off'}
					aria-hidden
					fill={shown.reacted && kind === 'like' ? 'currentColor' : 'none'}
					className={asked === true ? 'animate-like-pop' : undefined}
				/>
				{showText && (
					<span>
						<Trans>有用</Trans>
					</span>
				)}
				{shown.count > 0 && (
					<span
						key={shown.count}
						className={`tabular-nums ${asked === undefined ? '' : 'animate-notice-in'}`}
					>
						{shown.count}
					</span>
				)}
			</Button>
			{error !== undefined && (
				<span role="alert" className="text-danger text-meta">
					{error}
				</span>
			)}
		</>
	)
}

/**
 * `post.footer`: the like button of a post with its count, and in topics 「有用」 (which weighs
 * more in 「热门」). Notes, here or as cards in a feed, have the like alone.
 */
export function ReactionsFooter({ post }: { post: PostDto }) {
	const { i18n } = useLingui()
	const viewer = useRouteLoaderData<typeof rootLoader>('root')?.meta?.viewer
	const inTopic = useThreadContext()?.thread.kind === 'topic'
	const saved = summaryOf(post.ext[EXT_ID])
	const loggedIn = viewer?.user != null
	if (post.deleted) return null
	// Guests cannot react: show how many did, as text, and nothing at all for none.
	if (!loggedIn) {
		const useful = inTopic ? saved.useful.count : 0
		if (saved.like.count === 0 && useful === 0) return null
		return (
			<p className="text-ink-weak flex items-center gap-3 px-4 pb-3 text-meta tabular-nums">
				{saved.like.count > 0 && (
					<span className="flex items-center gap-1.5">
						<ThumbsUp aria-hidden size={14} />
						{saved.like.count}
						<span className="sr-only">{i18n._(LABELS.like.count)}</span>
					</span>
				)}
				{useful > 0 && (
					<span className="flex items-center gap-1.5">
						<Lightbulb aria-hidden size={14} />
						<Trans>有用</Trans> {useful}
						<span className="sr-only">{i18n._(LABELS.useful.count)}</span>
					</span>
				)}
			</p>
		)
	}
	return (
		<div className="flex items-center gap-1 px-2.5 pb-2">
			<ReactionButton post={post} kind="like" saved={saved.like} />
			{inTopic && <ReactionButton post={post} kind="useful" saved={saved.useful} />}
		</div>
	)
}
