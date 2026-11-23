import type { PostDto, ThreadDto } from '@pluxum/domain'
import { CircleCheck } from 'lucide-react'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useCallback, useEffect } from 'react'
import { Link, useFetcher, useRouteLoaderData } from 'react-router'
import { Trans, useLingui } from '@lingui/react/macro'

import { Tag } from '../../components/ui/display'
import { appHotkeys } from '../../lib/hotkeys'
import { useIsTargetPost } from '../../lib/target-post'
import { useThreadContext } from '../../lib/thread-context'
import type { loader as rootLoader } from '../../root'
import type { ExtActionResult } from '../../routes/ext-action'
import type { SlotProps } from '../slots'

const EXT_ID = 'forum-solved'

type Solution = Readonly<{
	postId: string
	floor: number
	excerpt: string
	author: Readonly<{ displayName: string }> | null
}>

/** A thread's answer. Plugin data crosses the API untyped, so its shape is checked here. */
function solutionOf(thread: ThreadDto): Solution | null {
	const value = thread.ext[EXT_ID]
	if (typeof value !== 'object' || value === null) return null
	if (!('postId' in value && 'floor' in value && 'excerpt' in value && 'author' in value)) {
		return null
	}
	const { postId, floor, excerpt, author } = value
	if (typeof postId !== 'string' || typeof floor !== 'number' || typeof excerpt !== 'string') {
		return null
	}
	const named =
		typeof author === 'object' &&
		author !== null &&
		'displayName' in author &&
		typeof author.displayName === 'string'
			? { displayName: author.displayName }
			: null
	return { postId, floor, excerpt, author: named }
}

function isAccepted(post: PostDto): boolean {
	const value = post.ext[EXT_ID]
	return (
		typeof value === 'object' && value !== null && 'accepted' in value && value.accepted === true
	)
}

/** `thread.badges`: 「已解决」 on a topic with an accepted answer. */
export function SolvedBadge({ thread, tagClassName }: SlotProps['thread.badges']) {
	if (solutionOf(thread) === null) return null
	return (
		<Tag tone="success" icon={CircleCheck} className={tagClassName}>
			<Trans>已解决</Trans>
		</Tag>
	)
}

/** `post.footer`: marks the accepted answer. */
export function AcceptedMark({ post }: { post: PostDto }) {
	if (!isAccepted(post)) return null
	return (
		<p className="px-4 pb-3 lg:px-5">
			<Tag tone="success" icon={CircleCheck}>
				<Trans>已采纳的答案</Trans>
			</Tag>
		</p>
	)
}

/** `post.after`: under the opening post, the accepted answer's opening words and a way to it. */
export function SolutionPin({ post, thread }: SlotProps['post.after']) {
	const { t } = useLingui()
	const solution = solutionOf(thread)
	if (post.number !== 1 || solution === null) return null
	return (
		<li className="max-lg:border-line-soft max-lg:border-b">
			<Link
				to={{ search: `?floor=${solution.floor}` }}
				preventScrollReset
				className="border-success bg-panel hover:bg-hover flex flex-col gap-1 border-l-2 px-4 py-3 transition-colors lg:rounded-[2px] lg:px-5"
			>
				<span className="text-ink-weak flex flex-wrap items-center gap-x-2 text-meta">
					<span className="text-success flex items-center gap-1 font-bold">
						<CircleCheck aria-hidden size={14} />
						<Trans>已采纳的答案</Trans>
					</span>
					<span>
						{solution.author?.displayName ?? t`一位成员`} · #{solution.floor}
					</span>
				</span>
				{solution.excerpt !== '' && (
					<span className="text-ink line-clamp-2 break-words">{solution.excerpt}</span>
				)}
			</Link>
		</li>
	)
}

/**
 * `post.actions`: 「采纳为答案」 / 「取消采纳」 in a reply's menu, for the topic's author and for
 * moderators. Notes and the opening post have no such item.
 */
export function AcceptAction({ post, setMenuItems }: SlotProps['post.actions']) {
	const { t } = useLingui()
	const viewer = useRouteLoaderData<typeof rootLoader>('root')?.meta?.viewer
	const context = useThreadContext()
	const fetcher = useFetcher<ExtActionResult>()
	const { submit } = fetcher
	const accepted = isAccepted(post)
	const userId = viewer?.user?.id
	const available =
		context !== null &&
		context.thread.kind === 'topic' &&
		post.number !== 1 &&
		!post.deleted &&
		userId !== undefined &&
		(userId === context.thread.author.id || context.can.moderate)
	const busy = fetcher.state !== 'idle'
	const toggle = useCallback(
		() =>
			void submit(
				{ postId: post.id, on: !accepted },
				{ method: 'post', action: `/ext/${EXT_ID}/accept`, encType: 'application/json' },
			),
		[submit, post.id, accepted],
	)
	// A accepts (or un-accepts) the floor under the pointer, as the menu item does.
	const target = useIsTargetPost(post.number)
	useHotkey(appHotkeys['post.accept'], toggle, {
		enabled: available && target && !busy,
		conflictBehavior: 'allow',
	})
	const error =
		fetcher.state === 'idle' && fetcher.data?.ok === false ? fetcher.data.error : undefined

	useEffect(() => {
		if (!available) {
			setMenuItems([])
			return
		}
		setMenuItems([
			{
				id: 'accept',
				label: accepted ? t`取消采纳` : t`采纳为答案`,
				disabled: busy,
				onAction: toggle,
			},
		])
	}, [available, accepted, busy, toggle, setMenuItems, t])

	if (error === undefined) return null
	return (
		<span role="alert" className="text-danger text-meta">
			{error}
		</span>
	)
}
