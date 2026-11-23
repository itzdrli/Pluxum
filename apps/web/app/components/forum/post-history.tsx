import type { PostDto, PostHistoryDto } from '@pluxum/domain'
import { Modal } from '@heroui/react'
import { useEffect, useMemo, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'

import { diffText } from '../../lib/diff'
import { formatDateTime } from '../../lib/format'
import { useTimeZone } from '../../lib/timezone'
import { Button } from '../ui/button'
import { Timestamp } from '../ui/display'
import { KeyboardScope } from '../ui/keyboard-scope'

function isHistory(value: unknown): value is PostHistoryDto {
	return (
		typeof value === 'object' &&
		value !== null &&
		'versions' in value &&
		Array.isArray(value.versions) &&
		value.versions.length > 0
	)
}

type Loaded =
	| Readonly<{ state: 'loading' }>
	| Readonly<{ state: 'failed' }>
	| Readonly<{ state: 'ready'; history: PostHistoryDto }>

/**
 * 「已编辑」 after a post's time: opens the post's edit history, each version shown as what
 * changed from the one before it.
 */
export function EditedMark({ post }: { post: PostDto }) {
	const { t, i18n } = useLingui()
	const timeZone = useTimeZone()
	const [open, setOpen] = useState(false)
	if (post.editedAt === null || post.deleted) return null
	const editedAt = formatDateTime(post.editedAt, i18n.locale, timeZone)
	return (
		<>
			<button
				type="button"
				className="hover:text-ink-strong cursor-pointer hover:underline"
				title={t`编辑于 ${editedAt}`}
				onClick={() => setOpen(true)}
			>
				{t`已编辑`}
			</button>
			{open && (
				// Keyed by the edit time: a new edit while open reloads the history.
				<PostHistoryDialog key={post.editedAt} postId={post.id} onClose={() => setOpen(false)} />
			)}
		</>
	)
}

function PostHistoryDialog({ postId, onClose }: { postId: string; onClose: () => void }) {
	const { t } = useLingui()
	const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
	// The version shown; null is the newest.
	const [chosen, setChosen] = useState<number | null>(null)

	useEffect(() => {
		const controller = new AbortController()
		void (async () => {
			try {
				const response = await fetch(`/api/forum/posts/${encodeURIComponent(postId)}/history`, {
					headers: { accept: 'application/json' },
					signal: controller.signal,
				})
				const body: unknown = response.ok ? await response.json() : null
				setLoaded(isHistory(body) ? { state: 'ready', history: body } : { state: 'failed' })
			} catch {
				if (!controller.signal.aborted) setLoaded({ state: 'failed' })
			}
		})()
		return () => controller.abort()
	}, [postId])

	const versions = loaded.state === 'ready' ? loaded.history.versions : []
	const newest = versions.at(-1)
	const shown = versions.find((version) => version.number === chosen) ?? newest
	const previous = shown === undefined ? undefined : versions[shown.number - 2]
	const parts = useMemo(
		() => (shown === undefined ? [] : diffText(previous?.body ?? '', shown.body)),
		[previous, shown],
	)
	const labelOf = (number: number) =>
		number === newest?.number ? t`当前` : number === 1 ? t`原文` : t`第 ${number} 版`

	return (
		<Modal isOpen onOpenChange={(next) => !next && onClose()}>
			<Modal.Backdrop isKeyboardDismissDisabled={false}>
				<Modal.Container size="lg">
					<Modal.Dialog>
						<KeyboardScope>
							<Modal.Header>
								<Modal.Heading className="text-ink-strong text-heading font-bold">
									<Trans>编辑记录</Trans>
								</Modal.Heading>
							</Modal.Header>
							<Modal.Body className="flex flex-col gap-3 sm:flex-row">
								{loaded.state === 'loading' && (
									<p className="text-ink-weak">
										<Trans>加载中…</Trans>
									</p>
								)}
								{loaded.state === 'failed' && (
									<p className="text-danger">
										<Trans>加载失败，请重试。</Trans>
									</p>
								)}
								{shown !== undefined && (
									<>
										<ol className="flex shrink-0 gap-1 overflow-x-auto sm:w-40 sm:flex-col sm:overflow-visible">
											{versions.toReversed().map((version) => {
												const selected = version.number === shown.number
												return (
													<li key={version.number} className="shrink-0">
														<button
															type="button"
															aria-current={selected ? 'true' : undefined}
															onClick={() => setChosen(version.number)}
															className={`flex w-full cursor-pointer flex-col items-start rounded-[2px] px-2 py-1.5 text-left text-meta ${
																selected ? 'bg-selected text-ink-strong' : 'text-ink hover:bg-hover'
															}`}
														>
															<span className="font-bold">{labelOf(version.number)}</span>
															<span className="text-ink-weak truncate">
																{version.editor.displayName} · <Timestamp iso={version.createdAt} />
															</span>
														</button>
													</li>
												)
											})}
										</ol>
										<div
											className="post-diff border-line-soft bg-page min-w-0 flex-1 overflow-auto rounded-[2px] border px-3 py-2 sm:max-h-[60vh]"
											// What the diff shows: the first version as written, each later one against the one before.
											aria-label={previous === undefined ? t`原文` : t`与上一版的差异`}
										>
											{parts.map((part, index) =>
												part.kind === 'added' ? (
													// oxlint-disable-next-line react/no-array-index-key -- parts have no identity but their order.
													<ins key={index}>{part.text}</ins>
												) : part.kind === 'removed' ? (
													// oxlint-disable-next-line react/no-array-index-key -- see above.
													<del key={index}>{part.text}</del>
												) : (
													// oxlint-disable-next-line react/no-array-index-key -- see above.
													<span key={index}>{part.text}</span>
												),
											)}
										</div>
									</>
								)}
							</Modal.Body>
							<Modal.Footer className="flex justify-end">
								<Button tone="ghost" onPress={onClose}>
									<Trans>关闭</Trans>
								</Button>
							</Modal.Footer>
						</KeyboardScope>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	)
}
