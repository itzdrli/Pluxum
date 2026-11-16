import type { PostDto } from '@pluxum/domain'
import { ThumbsUp } from 'lucide-react'
import { useFetcher, useRouteLoaderData } from 'react-router'

import { Button } from '../../components/ui/button'
import type { loader as rootLoader } from '../../root'
import type { ExtActionResult } from '../../routes/ext-action'

const EXT_ID = 'forum-reactions'

type Summary = Readonly<{ count: number; reacted: boolean }>

/** The plugin's data on a post. It crosses the API untyped, so its shape is checked here. */
function summaryOf(value: unknown): Summary {
	if (typeof value === 'object' && value !== null && 'count' in value && 'reacted' in value) {
		const { count, reacted } = value
		if (typeof count === 'number' && typeof reacted === 'boolean') return { count, reacted }
	}
	return { count: 0, reacted: false }
}

/** `post.footer`: the like button of a post, with its count. */
export function ReactionsFooter({ post }: { post: PostDto }) {
	const viewer = useRouteLoaderData<typeof rootLoader>('root')?.meta?.viewer
	const fetcher = useFetcher<ExtActionResult>()
	const saved = summaryOf(post.ext[EXT_ID])
	// While the request is on its way, show the state it asks for.
	const pending: unknown = fetcher.json
	const asked =
		typeof pending === 'object' && pending !== null && 'on' in pending
			? pending.on === true
			: undefined
	const shown: Summary =
		asked === undefined || asked === saved.reacted
			? saved
			: { reacted: asked, count: Math.max(0, saved.count + (asked ? 1 : -1)) }
	const error =
		fetcher.state === 'idle' && fetcher.data?.ok === false ? fetcher.data.error : undefined
	const loggedIn = viewer?.user != null
	if (post.deleted) return null
	return (
		<div className="flex items-center gap-2 px-4 pb-3">
			<Button
				tone="ghost"
				size="sm"
				aria-pressed={shown.reacted}
				aria-label={shown.reacted ? '取消点赞' : '点赞'}
				isDisabled={!loggedIn}
				className={shown.reacted ? 'text-accent' : 'text-ink-weak'}
				onPress={() =>
					fetcher.submit(
						{ postId: post.id, on: !shown.reacted },
						{ method: 'post', action: `/ext/${EXT_ID}/react`, encType: 'application/json' },
					)
				}
			>
				<ThumbsUp aria-hidden fill={shown.reacted ? 'currentColor' : 'none'} />
				<span className="tabular-nums">{shown.count > 0 ? shown.count : '赞'}</span>
			</Button>
			{error !== undefined && (
				<span role="alert" className="text-danger text-meta">
					{error}
				</span>
			)}
		</div>
	)
}
