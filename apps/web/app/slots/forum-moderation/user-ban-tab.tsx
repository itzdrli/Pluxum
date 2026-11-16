import type { UserBanStatusDto, UserProfileDto } from '@pluxum/domain'
import { Ban, ShieldCheck, Unlock } from 'lucide-react'
import { useState } from 'react'
import { useFetcher, useRouteLoaderData } from 'react-router'

import { Button } from '../../components/ui/button'
import { FormError, Panel, SectionLabel, Tag, Timestamp } from '../../components/ui/display'
import type { loader as rootLoader } from '../../root'
import type { ExtActionResult } from '../../routes/ext-action'

const EXT_ID = 'forum-moderation'
const REASON_MAX = 500

const DURATION_OPTIONS = [
	{ value: '', label: '永久封禁' },
	{ value: '1', label: '1 小时' },
	{ value: '24', label: '24 小时' },
	{ value: '168', label: '7 天' },
	{ value: '720', label: '30 天' },
] as const

/** Parses untrusted `user.ext['forum-moderation']` data into a normalized `UserBanStatusDto`. */
export function banStatusOf(value: unknown): UserBanStatusDto {
	if (typeof value !== 'object' || value === null || !('banned' in value)) {
		return { banned: false }
	}
	if (value.banned !== true) return { banned: false }
	const reason = 'reason' in value && typeof value.reason === 'string' ? value.reason : undefined
	const expiresAt =
		'expiresAt' in value && (typeof value.expiresAt === 'string' || value.expiresAt === null)
			? value.expiresAt
			: null
	return {
		banned: true,
		...(reason === undefined ? {} : { reason }),
		expiresAt,
	}
}

/** `user.profile.tabs`: displays active ban badge and staff ban/unban controls on non-self profiles. */
export function UserBanTab({ profile }: { profile: UserProfileDto }) {
	const viewer = useRouteLoaderData<typeof rootLoader>('root')?.meta?.viewer
	const banStatus = banStatusOf(profile.ext[EXT_ID])
	const viewerRoles = viewer?.roles ?? []
	const isStaff = viewerRoles.includes('moderator') || viewerRoles.includes('admin')
	const isSelf = viewer?.user?.id === profile.user.id
	const isTargetAdmin = profile.roles.includes('admin')
	const canManage = isStaff && !isSelf && !isTargetAdmin

	if (!banStatus.banned && (!isStaff || isSelf)) {
		return null
	}

	return (
		<section aria-labelledby="moderation-status-heading">
			<SectionLabel>
				<span id="moderation-status-heading">{canManage ? '账号状态与封禁管理' : '账号状态'}</span>
			</SectionLabel>
			<Panel className="flex flex-col gap-3 px-4 py-3">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div className="flex flex-wrap items-center gap-2">
						{banStatus.banned ? (
							<>
								<Tag tone="danger" icon={Ban}>
									已封禁
								</Tag>
								<span className="text-ink-weak text-meta">
									{banStatus.expiresAt != null ? (
										<>
											封禁至 <Timestamp iso={banStatus.expiresAt} />
										</>
									) : (
										'永久封禁'
									)}
								</span>
							</>
						) : (
							<>
								<Tag tone="success" icon={ShieldCheck}>
									正常
								</Tag>
								<span className="text-ink-weak text-meta">
									{isTargetAdmin
										? '管理员账号受保护，不可封禁。'
										: '该账号当前状态正常，可正常发帖与互动。'}
								</span>
							</>
						)}
					</div>
				</div>

				{banStatus.banned && banStatus.reason !== undefined && (
					<p className="border-line bg-control text-ink rounded-[2px] border px-3 py-2 text-ui break-words">
						<span className="text-ink-weak">封禁原因：</span>
						{banStatus.reason}
					</p>
				)}

				{canManage &&
					(banStatus.banned ? (
						<UnbanForm key="unban" userId={profile.user.id} />
					) : (
						<BanForm key="ban" userId={profile.user.id} />
					))}
			</Panel>
		</section>
	)
}

function BanForm({ userId }: { userId: string }) {
	const fetcher = useFetcher<ExtActionResult>()
	const [reason, setReason] = useState('')
	const [duration, setDuration] = useState('')
	const submitting = fetcher.state !== 'idle'
	const error =
		fetcher.state === 'idle' && fetcher.data?.ok === false ? fetcher.data.error : undefined

	return (
		<form
			className="border-line flex flex-col gap-2.5 border-t pt-3"
			onSubmit={(event) => {
				event.preventDefault()
				const trimmed = reason.trim()
				if (!trimmed) return
				const durationHours = duration === '' ? undefined : Number(duration)
				void fetcher.submit(
					{
						userId,
						reason: trimmed,
						...(durationHours !== undefined && Number.isFinite(durationHours)
							? { durationHours }
							: {}),
					},
					{
						method: 'post',
						action: `/ext/${EXT_ID}/ban`,
						encType: 'application/json',
					},
				)
			}}
		>
			<FormError message={error} />
			<div className="flex flex-wrap items-end gap-2">
				<label className="flex min-w-0 flex-1 basis-52 flex-col gap-1">
					<span className="text-ink-weak text-meta">封禁原因</span>
					<input
						type="text"
						value={reason}
						onChange={(event) => setReason(event.currentTarget.value)}
						maxLength={REASON_MAX}
						required
						placeholder="填写封禁原因（将记入审核日志）…"
						className="border-line bg-page text-ink-strong placeholder:text-ink-weak/60 hover:border-ink-weak focus:border-accent h-8 w-full rounded-[2px] border px-2.5 text-ui outline-none"
					/>
				</label>
				<label className="flex flex-col gap-1">
					<span className="text-ink-weak text-meta">封禁时长</span>
					<select
						value={duration}
						onChange={(event) => setDuration(event.currentTarget.value)}
						aria-label="封禁时长"
						className="border-line bg-page text-ink-strong hover:border-ink-weak focus:border-accent h-8 rounded-[2px] border px-2.5 text-ui outline-none"
					>
						{DURATION_OPTIONS.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</label>
				<Button
					tone="danger"
					size="md"
					type="submit"
					isPending={submitting}
					isDisabled={reason.trim().length === 0 || submitting}
				>
					<Ban aria-hidden />
					封禁账号
				</Button>
			</div>
		</form>
	)
}

function UnbanForm({ userId }: { userId: string }) {
	const fetcher = useFetcher<ExtActionResult>()
	const [note, setNote] = useState('')
	const submitting = fetcher.state !== 'idle'
	const error =
		fetcher.state === 'idle' && fetcher.data?.ok === false ? fetcher.data.error : undefined

	return (
		<form
			className="border-line flex flex-col gap-2.5 border-t pt-3"
			onSubmit={(event) => {
				event.preventDefault()
				const trimmed = note.trim()
				void fetcher.submit(
					{
						userId,
						...(trimmed ? { reason: trimmed } : {}),
					},
					{
						method: 'post',
						action: `/ext/${EXT_ID}/unban`,
						encType: 'application/json',
					},
				)
			}}
		>
			<FormError message={error} />
			<div className="flex flex-wrap items-end gap-2">
				<label className="flex min-w-0 flex-1 basis-52 flex-col gap-1">
					<span className="text-ink-weak text-meta">解封备注（可选）</span>
					<input
						type="text"
						value={note}
						onChange={(event) => setNote(event.currentTarget.value)}
						maxLength={REASON_MAX}
						placeholder="填写解除封禁说明…"
						className="border-line bg-page text-ink-strong placeholder:text-ink-weak/60 hover:border-ink-weak focus:border-accent h-8 w-full rounded-[2px] border px-2.5 text-ui outline-none"
					/>
				</label>
				<Button tone="secondary" size="md" type="submit" isPending={submitting}>
					<Unlock aria-hidden />
					解除封禁
				</Button>
			</div>
		</form>
	)
}
