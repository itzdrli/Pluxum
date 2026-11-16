import type {
	ModerationLogDto,
	ModerationQueueStatus,
	ModerationReportDto,
	ModerationReportStatus,
} from '@pluxum/domain'
import {
	Check,
	ClipboardList,
	ExternalLink,
	History,
	LogIn,
	ShieldAlert,
	ShieldCheck,
	ShieldOff,
	Trash2,
	X,
} from 'lucide-react'
import { data, Form, useNavigation } from 'react-router'

import type { Route } from './+types/moderation'
import { UserAvatar } from '../components/forum/user-avatar'
import { StageLink } from '../components/stage/stage'
import { Button, ButtonAnchor } from '../components/ui/button'
import {
	EmptyState,
	FormError,
	PageHeader,
	Panel,
	Tag,
	type TagTone,
	Timestamp,
} from '../components/ui/display'
import { Pager } from '../components/ui/pager'
import { forumApi, orThrow, pageParam, textField } from '../lib/forum-api.server'
import { defineStage } from '../lib/stage'

export type ModerationTab = 'queue' | 'logs'

export type ParsedModerationUrl = Readonly<{
	tab: ModerationTab
	status: ModerationQueueStatus
	page: number
}>

const QUEUE_STATUS_TABS: ReadonlyArray<Readonly<{ status: ModerationQueueStatus; label: string }>> =
	[
		{ status: 'open', label: '待处理' },
		{ status: 'resolved', label: '已处理' },
		{ status: 'dismissed', label: '已驳回' },
		{ status: 'all', label: '全部' },
	]

const REPORT_STATUS_META: Readonly<
	Record<ModerationReportStatus, Readonly<{ label: string; tone: TagTone }>>
> = {
	open: { label: '待处理', tone: 'warning' },
	resolved: { label: '已处理', tone: 'success' },
	dismissed: { label: '已驳回', tone: 'neutral' },
}

const LOG_ACTION_META: Readonly<Record<string, Readonly<{ label: string; tone: TagTone }>>> = {
	'report.created': { label: '提交举报', tone: 'warning' },
	'report.resolved': { label: '处理举报', tone: 'success' },
	'report.resolved_deleted': { label: '处理并删除内容', tone: 'danger' },
	'report.dismissed': { label: '驳回举报', tone: 'neutral' },
	'user.banned': { label: '封禁账号', tone: 'danger' },
	'user.unbanned': { label: '解除封禁', tone: 'accent' },
}

function isQueueStatus(value: string | null): value is ModerationQueueStatus {
	return value === 'open' || value === 'resolved' || value === 'dismissed' || value === 'all'
}

/** Extracts active tab, status filter and page number from a `/moderation` URL. */
export function parseModerationUrl(url: URL): ParsedModerationUrl {
	const rawTab = url.searchParams.get('tab')
	const rawStatus = url.searchParams.get('status')
	const rawPage = url.searchParams.get('page') ?? ''
	return {
		tab: rawTab === 'logs' ? 'logs' : 'queue',
		status: isQueueStatus(rawStatus) ? rawStatus : 'open',
		page: /^[1-9]\d{0,5}$/.test(rawPage) ? Number(rawPage) : 1,
	}
}

/** Builds a `/moderation?...` filter URL omitting default parameters. */
export function buildModerationHref(
	tab: ModerationTab,
	status: ModerationQueueStatus = 'open',
): string {
	const params = new URLSearchParams()
	if (tab === 'logs') {
		params.set('tab', 'logs')
	} else if (status !== 'open') {
		params.set('status', status)
	}
	const qs = params.toString()
	return qs === '' ? '/moderation' : `/moderation?${qs}`
}

/** Builds a safe internal link to the reported post or thread. */
export function resolveReportTargetHref(
	report: Pick<ModerationReportDto, 'threadId' | 'postId'>,
): string {
	return report.postId !== null
		? `/t/${report.threadId}#post-${report.postId}`
		: `/t/${report.threadId}`
}

/** Maps a moderation audit log action code to a localized badge label and tone. */
export function formatModerationLogAction(
	actionCode: string,
): Readonly<{ label: string; tone: TagTone }> {
	return LOG_ACTION_META[actionCode] ?? { label: actionCode, tone: 'neutral' }
}

export const handle = defineStage({ layer: 'page' })

export function meta(): Route.MetaDescriptors {
	return [{ title: '审核队列 · Pluxum' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	const forumMeta = orThrow(await forumApi.meta(request))
	const parsed = parseModerationUrl(new URL(request.url))
	const page = pageParam(request)
	const pluginActive = forumMeta.uiSlots.some((slot) => slot.extId === 'forum-moderation')

	if (!pluginActive) {
		return {
			available: false as const,
			loggedIn: forumMeta.viewer.user !== null,
			authorized: false as const,
			loginAvailable: forumMeta.auth.loginAvailable,
			...parsed,
			queue: null,
			logs: null,
		}
	}

	if (forumMeta.viewer.user === null) {
		return {
			available: true as const,
			loggedIn: false as const,
			authorized: false as const,
			loginAvailable: forumMeta.auth.loginAvailable,
			...parsed,
			queue: null,
			logs: null,
		}
	}

	const isStaff =
		forumMeta.viewer.roles.includes('moderator') || forumMeta.viewer.roles.includes('admin')
	if (!isStaff) {
		return {
			available: true as const,
			loggedIn: true as const,
			authorized: false as const,
			loginAvailable: forumMeta.auth.loginAvailable,
			...parsed,
			queue: null,
			logs: null,
		}
	}

	if (parsed.tab === 'logs') {
		const logsResult = await forumApi.moderationLogs(request, { page })
		if (!logsResult.ok) {
			if (logsResult.status === 404 || logsResult.error.code === 'unavailable') {
				return {
					available: false as const,
					loggedIn: true as const,
					authorized: false as const,
					loginAvailable: forumMeta.auth.loginAvailable,
					...parsed,
					queue: null,
					logs: null,
				}
			}
			if (logsResult.status === 403 || logsResult.error.code === 'forbidden') {
				return {
					available: true as const,
					loggedIn: true as const,
					authorized: false as const,
					loginAvailable: forumMeta.auth.loginAvailable,
					...parsed,
					queue: null,
					logs: null,
				}
			}
			orThrow(logsResult)
		}
		return {
			available: true as const,
			loggedIn: true as const,
			authorized: true as const,
			loginAvailable: forumMeta.auth.loginAvailable,
			...parsed,
			queue: null,
			logs: logsResult.ok ? logsResult.value : null,
		}
	}

	const queueResult = await forumApi.moderationQueue(request, { status: parsed.status, page })
	if (!queueResult.ok) {
		if (queueResult.status === 404 || queueResult.error.code === 'unavailable') {
			return {
				available: false as const,
				loggedIn: true as const,
				authorized: false as const,
				loginAvailable: forumMeta.auth.loginAvailable,
				...parsed,
				queue: null,
				logs: null,
			}
		}
		if (queueResult.status === 403 || queueResult.error.code === 'forbidden') {
			return {
				available: true as const,
				loggedIn: true as const,
				authorized: false as const,
				loginAvailable: forumMeta.auth.loginAvailable,
				...parsed,
				queue: null,
				logs: null,
			}
		}
		orThrow(queueResult)
	}

	return {
		available: true as const,
		loggedIn: true as const,
		authorized: true as const,
		loginAvailable: forumMeta.auth.loginAvailable,
		...parsed,
		queue: queueResult.ok ? queueResult.value : null,
		logs: null,
	}
}

type ActionResponse =
	| Readonly<{ ok: true; reportId: string; error?: undefined }>
	| Readonly<{ ok: false; reportId?: string; error: string }>

export async function action({ request }: Route.ActionArgs) {
	const form = await request.formData()
	const intent = textField(form, 'intent')

	if (intent === 'resolve') {
		const reportId = textField(form, 'reportId')
		const mode = textField(form, 'mode')
		const rawNote = textField(form, 'note').trim()
		const decision = mode === 'dismiss' ? ('dismissed' as const) : ('resolved' as const)
		const deleteTarget = mode === 'resolve-delete'

		const result = await forumApi.resolveReport(request, {
			reportId,
			decision,
			deleteTarget,
			...(rawNote === '' ? {} : { note: rawNote }),
		})
		if (!result.ok) {
			const failure: ActionResponse = { ok: false, reportId, error: result.error.message }
			return data(failure, { status: result.status })
		}
		const success: ActionResponse = { ok: true, reportId }
		return success
	}

	const failure: ActionResponse = { ok: false, error: '不支持的审核操作' }
	return data(failure, { status: 400 })
}

export default function ModerationRoute({ loaderData, actionData }: Route.ComponentProps) {
	const { available, loggedIn, authorized, loginAvailable, tab, status, queue, logs } = loaderData

	if (!available) {
		return (
			<>
				<PageHeader title="审核队列" description="处理用户举报并查看社区管理日志。" />
				<EmptyState
					icon={ShieldOff}
					title="审核功能未启用"
					hint="内容审核插件当前处于停用状态，请稍后再试。"
				/>
			</>
		)
	}

	if (!loggedIn) {
		return (
			<>
				<PageHeader title="审核队列" description="处理用户举报并查看社区管理日志。" />
				<EmptyState
					icon={LogIn}
					title="请先登录"
					hint="请使用版主或管理员账号登录以访问审核队列。"
					action={
						loginAvailable ? (
							<ButtonAnchor
								href="/api/forum/auth/login?returnTo=%2Fmoderation"
								tone="primary"
								size="sm"
							>
								<LogIn aria-hidden />
								登录
							</ButtonAnchor>
						) : undefined
					}
				/>
			</>
		)
	}

	if (!authorized) {
		return (
			<>
				<PageHeader title="审核队列" description="处理用户举报并查看社区管理日志。" />
				<EmptyState
					icon={ShieldAlert}
					title="没有权限访问审核队列"
					hint="仅版主或管理员可以处理举报与查看审核日志。"
				/>
			</>
		)
	}

	const globalError =
		actionData?.ok === false && actionData.reportId === undefined ? actionData.error : undefined

	return (
		<>
			<PageHeader
				title="审核队列"
				description="处理社区举报、清理违规内容并查阅管理操作记录。"
				actions={
					<div
						role="tablist"
						aria-label="审核视图"
						className="border-line bg-panel inline-flex rounded-[2px] border p-0.5 text-[12px]"
					>
						<StageLink
							role="tab"
							aria-selected={tab === 'queue'}
							to={buildModerationHref('queue', status)}
							className={`flex items-center gap-1.5 rounded-[2px] px-2.5 py-1 ${
								tab === 'queue'
									? 'bg-selected text-ink-strong font-bold'
									: 'text-ink-weak hover:text-ink-strong'
							}`}
						>
							<ClipboardList aria-hidden size={13} />
							<span>举报队列</span>
							{queue !== null && queue.openCount > 0 && (
								<span className="tabular-nums">({queue.openCount})</span>
							)}
						</StageLink>
						<StageLink
							role="tab"
							aria-selected={tab === 'logs'}
							to={buildModerationHref('logs')}
							className={`flex items-center gap-1.5 rounded-[2px] px-2.5 py-1 ${
								tab === 'logs'
									? 'bg-selected text-ink-strong font-bold'
									: 'text-ink-weak hover:text-ink-strong'
							}`}
						>
							<History aria-hidden size={13} />
							<span>审核日志</span>
						</StageLink>
					</div>
				}
			/>

			{globalError !== undefined && (
				<div className="mb-6">
					<FormError message={globalError} />
				</div>
			)}

			{tab === 'queue' && queue !== null && (
				<section aria-label="举报列表">
					<div className="mb-4 flex flex-wrap items-center justify-between gap-2">
						<div
							role="group"
							aria-label="举报状态筛选"
							className="border-line bg-panel inline-flex flex-wrap rounded-[2px] border p-0.5 text-[12px]"
						>
							{QUEUE_STATUS_TABS.map((entry) => {
								const active = status === entry.status
								return (
									<StageLink
										key={entry.status}
										to={buildModerationHref('queue', entry.status)}
										className={`flex items-center gap-1 rounded-[2px] px-2.5 py-1 ${
											active
												? 'bg-selected text-ink-strong font-bold'
												: 'text-ink-weak hover:text-ink-strong'
										}`}
									>
										<span>{entry.label}</span>
										{entry.status === 'open' && queue.openCount > 0 && (
											<span className="tabular-nums">({queue.openCount})</span>
										)}
									</StageLink>
								)
							})}
						</div>
						<span className="text-ink-weak text-[12px] tabular-nums">共 {queue.total} 条记录</span>
					</div>

					{queue.items.length === 0 ? (
						<EmptyState
							icon={ShieldCheck}
							title={status === 'open' ? '没有待处理的举报' : '当前筛选下没有举报记录'}
							hint={status === 'open' ? '所有举报均已处理完毕。' : '切换其他状态筛选查看历史记录。'}
						/>
					) : (
						<div className="flex flex-col gap-3">
							{queue.items.map((report) => (
								<ReportCard
									key={report.id}
									report={report}
									error={
										actionData?.ok === false && actionData.reportId === report.id
											? actionData.error
											: undefined
									}
								/>
							))}
						</div>
					)}

					<Pager page={queue.page} pageSize={queue.pageSize} total={queue.total} />
				</section>
			)}

			{tab === 'logs' && logs !== null && (
				<section aria-label="审核日志">
					{logs.items.length === 0 ? (
						<EmptyState icon={History} title="暂无审核日志" hint="社区管理操作记录将显示在这里。" />
					) : (
						<Panel as="ul" className="divide-line divide-y">
							{logs.items.map((entry) => (
								<LogRow key={entry.id} entry={entry} />
							))}
						</Panel>
					)}
					<Pager page={logs.page} pageSize={logs.pageSize} total={logs.total} />
				</section>
			)}
		</>
	)
}

function ReportCard({ report, error }: { report: ModerationReportDto; error: string | undefined }) {
	const navigation = useNavigation()
	const isSubmittingThis =
		navigation.state === 'submitting' && navigation.formData?.get('reportId') === report.id
	const submittingMode = isSubmittingThis ? navigation.formData?.get('mode') : null
	const statusMeta = REPORT_STATUS_META[report.status]
	const targetHref = resolveReportTargetHref(report)

	return (
		<Panel as="article" className="flex flex-col gap-3 p-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex flex-wrap items-center gap-2">
					<Tag tone={statusMeta.tone}>{statusMeta.label}</Tag>
					<Tag>{report.targetType === 'thread' ? '主题举报' : '帖子举报'}</Tag>
					<span className="text-ink-weak flex items-center gap-1.5 text-[12px]">
						<span>举报人：</span>
						<StageLink
							to={`/u/${report.reporter.id}`}
							className="text-ink-strong inline-flex items-center gap-1 font-bold hover:underline"
						>
							<UserAvatar user={report.reporter} size="sm" />
							<span>{report.reporter.displayName}</span>
						</StageLink>
					</span>
					{report.targetAuthor !== null && (
						<span className="text-ink-weak flex items-center gap-1.5 text-[12px]">
							<span>· 被举报作者：</span>
							<StageLink
								to={`/u/${report.targetAuthor.id}`}
								className="text-ink-strong font-bold hover:underline"
							>
								{report.targetAuthor.displayName}
							</StageLink>
						</span>
					)}
				</div>

				<div className="flex items-center gap-3 text-[12px]">
					<Timestamp iso={report.createdAt} className="text-ink-weak" />
					<StageLink
						to={targetHref}
						className="text-accent inline-flex items-center gap-1 hover:underline"
					>
						<span>查看目标</span>
						<ExternalLink aria-hidden size={12} />
					</StageLink>
				</div>
			</div>

			<div className="border-line bg-control rounded-[2px] border px-3 py-2">
				<p className="text-ink break-words whitespace-pre-wrap">{report.reason}</p>
			</div>

			{report.status !== 'open' && (
				<div className="text-ink-weak flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
					<span>
						由{' '}
						{report.resolvedBy !== null ? (
							<StageLink
								to={`/u/${report.resolvedBy.id}`}
								className="text-ink-strong font-bold hover:underline"
							>
								{report.resolvedBy.displayName}
							</StageLink>
						) : (
							'管理人员'
						)}{' '}
						{report.status === 'dismissed' ? '驳回' : '处理'}
					</span>
					{report.resolvedAt !== null && (
						<>
							<span>·</span>
							<Timestamp iso={report.resolvedAt} />
						</>
					)}
					{report.resolutionNote !== null && (
						<span className="text-ink break-words">· 备注：{report.resolutionNote}</span>
					)}
				</div>
			)}

			{report.status === 'open' && (
				<Form method="post" className="border-line flex flex-col gap-2.5 border-t pt-3">
					<FormError message={error} />
					<input type="hidden" name="intent" value="resolve" />
					<input type="hidden" name="reportId" value={report.id} />
					<div className="flex flex-wrap items-center gap-2">
						<input
							type="text"
							name="note"
							maxLength={500}
							placeholder="处理备注（可选，记入审核日志）…"
							aria-label="处理备注"
							className="border-line bg-page text-ink-strong placeholder:text-ink-weak/60 hover:border-ink-weak focus:border-accent h-8 min-w-0 flex-1 basis-48 rounded-[2px] border px-2.5 text-[13px] outline-none"
						/>
						<div className="flex flex-wrap items-center gap-2">
							<Button
								tone="ghost"
								size="sm"
								type="submit"
								name="mode"
								value="dismiss"
								isPending={submittingMode === 'dismiss'}
								isDisabled={isSubmittingThis}
							>
								<X aria-hidden />
								驳回
							</Button>
							<Button
								tone="secondary"
								size="sm"
								type="submit"
								name="mode"
								value="resolve"
								isPending={submittingMode === 'resolve'}
								isDisabled={isSubmittingThis}
							>
								<Check aria-hidden />
								标记已处理
							</Button>
							<Button
								tone="danger"
								size="sm"
								type="submit"
								name="mode"
								value="resolve-delete"
								isPending={submittingMode === 'resolve-delete'}
								isDisabled={isSubmittingThis}
							>
								<Trash2 aria-hidden />
								{report.targetType === 'thread' ? '处理并删除主题' : '处理并删除内容'}
							</Button>
						</div>
					</div>
				</Form>
			)}
		</Panel>
	)
}

function LogRow({ entry }: { entry: ModerationLogDto }) {
	const actionMeta = formatModerationLogAction(entry.action)
	return (
		<li className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
			<div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
				<div className="flex flex-wrap items-center gap-2">
					<Tag tone={actionMeta.tone}>{actionMeta.label}</Tag>
					<StageLink
						to={`/u/${entry.actor.id}`}
						className="text-ink-strong inline-flex items-center gap-1.5 font-bold hover:underline"
					>
						<UserAvatar user={entry.actor} size="sm" />
						<span>{entry.actor.displayName}</span>
					</StageLink>
					{entry.targetUser !== null ? (
						<span className="text-ink-weak text-[12px]">
							目标用户：
							<StageLink
								to={`/u/${entry.targetUser.id}`}
								className="text-ink-strong font-bold hover:underline"
							>
								{entry.targetUser.displayName}
							</StageLink>
						</span>
					) : entry.targetType === 'thread' ? (
						<StageLink
							to={`/t/${entry.targetId}`}
							className="text-accent text-[12px] hover:underline"
						>
							主题 #{entry.targetId.slice(0, 8)}
						</StageLink>
					) : (
						<span className="text-ink-weak font-mono text-[12px]">
							{entry.targetType}:{entry.targetId.slice(0, 8)}
						</span>
					)}
				</div>
				{entry.detail !== null && (
					<p className="text-ink text-[12px] break-words">{entry.detail}</p>
				)}
			</div>
			<Timestamp iso={entry.createdAt} className="text-ink-weak shrink-0 text-[12px]" />
		</li>
	)
}
