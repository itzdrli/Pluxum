import type { PostDto } from '@pluxum/domain'
import { Modal } from '@heroui/react'
import { Check, Flag } from 'lucide-react'
import { useState } from 'react'
import { useFetcher, useRouteLoaderData } from 'react-router'

import { Button, IconButton } from '../../components/ui/button'
import { FormError, Tag } from '../../components/ui/display'
import type { loader as rootLoader } from '../../root'
import type { ExtActionResult } from '../../routes/ext-action'

const EXT_ID = 'forum-moderation'
const REASON_MAX = 500

const PRESET_REASONS = [
	'垃圾广告或恶意推广',
	'人身攻击或骚扰',
	'违法或不当内容',
	'恶意灌水或偏离主题',
] as const

/** `post.actions`: compact report button and dialog for signed-in members. */
export function ReportButton({ post }: { post: PostDto }) {
	const viewer = useRouteLoaderData<typeof rootLoader>('root')?.meta?.viewer
	const fetcher = useFetcher<ExtActionResult>()
	const [open, setOpen] = useState(false)
	const [reason, setReason] = useState('')
	const [acknowledgedData, setAcknowledgedData] = useState<ExtActionResult | undefined>(undefined)

	if (!viewer?.user || post.deleted) return null

	const submitting = fetcher.state !== 'idle'
	const succeeded = fetcher.state === 'idle' && fetcher.data?.ok === true
	const isOpen = open && !(succeeded && fetcher.data !== acknowledgedData)
	const error =
		fetcher.state === 'idle' && fetcher.data?.ok === false && fetcher.data !== acknowledgedData
			? fetcher.data.error
			: undefined

	if (succeeded) {
		return (
			<Tag tone="neutral" icon={Check}>
				已举报
			</Tag>
		)
	}

	return (
		<>
			<IconButton
				label="举报"
				tone="ghost"
				size="sm"
				className="text-ink-weak hover:text-ink-strong"
				onPress={() => {
					setAcknowledgedData(fetcher.data)
					setOpen(true)
				}}
			>
				<Flag aria-hidden />
			</IconButton>

			<Modal
				isOpen={isOpen}
				onOpenChange={(nextOpen) => {
					if (!nextOpen) {
						setAcknowledgedData(fetcher.data)
						setOpen(false)
					}
				}}
			>
				<Modal.Backdrop isKeyboardDismissDisabled={false}>
					<Modal.Container size="sm">
						<Modal.Dialog>
							<Modal.Header>
								<Modal.Heading className="text-ink-strong text-heading font-bold">
									举报内容
								</Modal.Heading>
							</Modal.Header>
							<Modal.Body className="flex flex-col gap-3">
								<p className="text-ink-weak text-meta">
									请说明举报 {post.author.displayName} 的原因，版主和管理员会尽快核实处理。
								</p>
								<FormError message={error} />
								<div className="flex flex-wrap gap-1.5">
									{PRESET_REASONS.map((preset) => {
										const selected = reason.trim() === preset
										return (
											<button
												key={preset}
												type="button"
												onClick={() => setReason(preset)}
												className={`rounded-[2px] border px-2 py-1 text-meta transition-colors ${
													selected
														? 'border-accent bg-selected text-ink-strong font-bold'
														: 'border-line bg-control text-ink hover:border-ink-weak'
												}`}
											>
												{preset}
											</button>
										)
									})}
								</div>
								<label className="flex flex-col gap-1">
									<span className="text-ink-weak text-meta">详细说明</span>
									<textarea
										value={reason}
										onChange={(event) => setReason(event.currentTarget.value)}
										maxLength={REASON_MAX}
										rows={3}
										required
										placeholder="补充违规细节或选择上方常见原因…"
										className="border-line bg-page text-ink-strong placeholder:text-ink-weak/60 hover:border-ink-weak focus:border-accent w-full rounded-[2px] border px-2.5 py-2 text-ui leading-relaxed outline-none"
									/>
								</label>
							</Modal.Body>
							<Modal.Footer className="flex justify-end gap-2">
								<Button
									tone="ghost"
									onPress={() => {
										setAcknowledgedData(fetcher.data)
										setOpen(false)
									}}
								>
									取消
								</Button>
								<Button
									tone="danger"
									isPending={submitting}
									isDisabled={reason.trim().length === 0 || submitting}
									onPress={() => {
										const trimmed = reason.trim()
										if (!trimmed) return
										void fetcher.submit(
											{ postId: post.id, reason: trimmed },
											{
												method: 'post',
												action: `/ext/${EXT_ID}/report`,
												encType: 'application/json',
											},
										)
									}}
								>
									提交举报
								</Button>
							</Modal.Footer>
						</Modal.Dialog>
					</Modal.Container>
				</Modal.Backdrop>
			</Modal>
		</>
	)
}
