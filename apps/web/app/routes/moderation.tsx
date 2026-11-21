import type {
	ModerationLogDto,
	ModerationQueueStatus,
	ModerationReportDto,
	ModerationReportStatus,
} from '@pluxum/domain'
import {
	ClipboardList,
	ExternalLink,
	History,
	LogIn,
	ShieldAlert,
	ShieldCheck,
	ShieldOff,
	Trash2,
} from 'lucide-react'
import { data, Form, useNavigation, useRouteLoaderData } from 'react-router'
import type { I18n, MessageDescriptor } from '@lingui/core'
import { msg, t as tm } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'

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
import { i18nOfRoot } from '../lib/i18n'
import { loginHref } from '../lib/login'
import type { loader as rootLoader } from '../root'
import { i18nFromRequest } from '../lib/i18n.server'
import { pageTitle } from '../lib/site'

export type ModerationTab = 'queue' | 'logs'

export type ParsedModerationUrl = Readonly<{
	tab: ModerationTab
	status: ModerationQueueStatus
	page: number
}>

const QUEUE_STATUS_TABS: ReadonlyArray<
	Readonly<{ status: ModerationQueueStatus; label: MessageDescriptor }>
> = [
	{ status: 'open', label: msg`待处理` },
	{ status: 'resolved', label: msg`已处理` },
	{ status: 'dismissed', label: msg`已驳回` },
	{ status: 'all', label: msg`全部` },
]

const REPORT_STATUS_META: Readonly<
	Record<ModerationReportStatus, Readonly<{ label: MessageDescriptor; tone: TagTone }>>
> = {
	open: { label: msg`待处理`, tone: 'warning' },
	resolved: { label: msg`已处理`, tone: 'success' },
	dismissed: { label: msg`已驳回`, tone: 'neutral' },
}

const LOG_ACTION_META: Readonly<
	Record<string, Readonly<{ label: MessageDescriptor; tone: TagTone }>>
> = {
	'report.created': { label: msg`提交举报`, tone: 'warning' },
	'report.resolved': { label: msg`处理举报`, tone: 'success' },
	'report.resolved_deleted': { label: msg`处理并删除内容`, tone: 'danger' },
	'report.dismissed': { label: msg`驳回举报`, tone: 'neutral' },
	'user.banned': { label: msg`封禁账号`, tone: 'danger' },
	'user.unbanned': { label: msg`解除封禁`, tone: 'accent' },
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
	// The shortlink resolves a post id to its floor and page.
	return report.postId !== null ? `/t/${report.threadId}/${report.postId}` : `/t/${report.threadId}`
}

/** Maps a moderation audit log action code to a localized badge label and tone. */
export function formatModerationLogAction(
	i18n: I18n,
	actionCode: string,
): Readonly<{ label: string; tone: TagTone }> {
	const known = LOG_ACTION_META[actionCode]
	return known === undefined
		? { label: actionCode, tone: 'neutral' }
		: { label: i18n._(known.label), tone: known.tone }
}

export const handle = defineStage({ layer: 'page', nav: true })

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [
		{ title: pageTitle(matches[0].loaderData, tm(i18nOfRoot(matches[0].loaderData))`审核队列`) },
	]
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
	const i18n = await i18nFromRequest(request)
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

	const failure: ActionResponse = { ok: false, error: tm(i18n)`不支持的审核操作` }
	return data(failure, { status: 400 })
}

export default function ModerationRoute({ loaderData, actionData }: Route.ComponentProps) {
	const rootAuth = useRouteLoaderData<typeof rootLoader>('root')?.meta?.auth
	const { t, i18n } = useLingui()
	const { available, loggedIn, authorized, loginAvailable, tab, status, queue, logs } = loaderData
	const queueTotal = queue?.total ?? 0

	if (!available) {
		return (
			<>
				<PageHeader title={t`审核队列`} />
				<EmptyState icon={ShieldOff} title={t`审核功能未启用`} />
			</>
		)
	}

	if (!loggedIn) {
		return (
			<>
				<PageHeader title={t`审核队列`} />
				<EmptyState
					icon={LogIn}
					title={t`请先登录`}
					action={
						loginAvailable ? (
							<ButtonAnchor href={loginHref(rootAuth, '/moderation')} tone="primary" size="sm">
								<Trans>登录</Trans>
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
				<PageHeader title={t`审核队列`} />
				<EmptyState icon={ShieldAlert} title={t`没有权限访问审核队列`} />
			</>
		)
	}

	const globalError =
		actionData?.ok === false && actionData.reportId === undefined ? actionData.error : undefined

	return (
		<>
			<PageHeader
				title={t`审核`}
				actions={
					<div
						role="tablist"
						aria-label={t`审核视图`}
						className="border-line bg-panel isolate inline-flex rounded-[2px] border p-0.5 text-meta"
					>
						<StageLink
							role="tab"
							aria-selected={tab === 'queue'}
							to={buildModerationHref('queue', status)}
							className={`relative flex items-center gap-1.5 rounded-[2px] px-2.5 py-1 ${
								tab === 'queue'
									? 'text-ink-strong font-bold'
									: 'text-ink-weak hover:text-ink-strong'
							}`}
						>
							{tab === 'queue' && <SegmentIndicator />}
							<ClipboardList aria-hidden size={13} />
							<span>
								<Trans>举报队列</Trans>
							</span>
							{queue !== null && queue.openCount > 0 && (
								<span className="tabular-nums">({queue.openCount})</span>
							)}
						</StageLink>
						<StageLink
							role="tab"
							aria-selected={tab === 'logs'}
							to={buildModerationHref('logs')}
							className={`relative flex items-center gap-1.5 rounded-[2px] px-2.5 py-1 ${
								tab === 'logs' ? 'text-ink-strong font-bold' : 'text-ink-weak hover:text-ink-strong'
							}`}
						>
							{tab === 'logs' && <SegmentIndicator />}
							<History aria-hidden size={13} />
							<span>
								<Trans>审核日志</Trans>
							</span>
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
				<section aria-label={t`举报列表`}>
					<div className="mb-4 flex flex-wrap items-center justify-between gap-2">
						<div
							role="group"
							aria-label={t`举报状态筛选`}
							className="border-line bg-panel isolate inline-flex flex-wrap rounded-[2px] border p-0.5 text-meta"
						>
							{QUEUE_STATUS_TABS.map((entry) => {
								const active = status === entry.status
								return (
									<StageLink
										key={entry.status}
										to={buildModerationHref('queue', entry.status)}
										aria-current={active ? 'true' : undefined}
										className={`relative flex items-center gap-1 rounded-[2px] px-2.5 py-1 ${
											active ? 'text-ink-strong font-bold' : 'text-ink-weak hover:text-ink-strong'
										}`}
									>
										{active && <SegmentIndicator name="moderation-status" />}
										<span>{i18n._(entry.label)}</span>
										{entry.status === 'open' && queue.openCount > 0 && (
											<span className="tabular-nums">({queue.openCount})</span>
										)}
									</StageLink>
								)
							})}
						</div>
						{queue.total > 0 && (
							<span className="text-ink-weak text-meta tabular-nums">{t`共 ${queueTotal} 条`}</span>
						)}
					</div>

					{queue.items.length === 0 ? (
						<EmptyState
							icon={ShieldCheck}
							title={status === 'open' ? t`没有待处理的举报` : t`当前筛选下没有举报记录`}
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
				<section aria-label={t`审核日志`}>
					{logs.items.length === 0 ? (
						<EmptyState icon={History} title={t`暂无审核日志`} />
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
	const { t, i18n } = useLingui()
	const navigation = useNavigation()
	const isSubmittingThis =
		navigation.state === 'submitting' && navigation.formData?.get('reportId') === report.id
	const submittingMode = isSubmittingThis ? navigation.formData?.get('mode') : null
	const statusMeta = REPORT_STATUS_META[report.status]
	const resolutionNote = report.resolutionNote ?? ''
	const resolverName = report.resolvedBy?.displayName ?? ''
	const targetHref = resolveReportTargetHref(report)

	return (
		<Panel as="article" className="flex flex-col gap-3 p-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex flex-wrap items-center gap-2">
					<Tag tone={statusMeta.tone}>{i18n._(statusMeta.label)}</Tag>
					<Tag>{report.targetType === 'thread' ? t`主题举报` : t`帖子举报`}</Tag>
					<span className="text-ink-weak flex items-center gap-1.5 text-meta">
						<span>
							<Trans>举报人：</Trans>
						</span>
						<StageLink
							to={`/u/${report.reporter.handle}`}
							className="text-ink-strong inline-flex items-center gap-1 font-bold hover:underline"
						>
							<UserAvatar user={report.reporter} size="sm" />
							<span>{report.reporter.displayName}</span>
						</StageLink>
					</span>
					{report.targetAuthor !== null && (
						<span className="text-ink-weak flex items-center gap-1.5 text-meta">
							<span>
								<Trans>· 被举报作者：</Trans>
							</span>
							<StageLink
								to={`/u/${report.targetAuthor.handle}`}
								className="text-ink-strong font-bold hover:underline"
							>
								{report.targetAuthor.displayName}
							</StageLink>
						</span>
					)}
				</div>

				<div className="flex items-center gap-3 text-meta">
					<Timestamp iso={report.createdAt} className="text-ink-weak" />
					<StageLink
						to={targetHref}
						className="text-accent inline-flex items-center gap-1 hover:underline"
					>
						<span>
							<Trans>查看目标</Trans>
						</span>
						<ExternalLink aria-hidden size={12} />
					</StageLink>
				</div>
			</div>

			<div className="border-line bg-control rounded-[2px] border px-3 py-2">
				<p className="text-ink break-words whitespace-pre-wrap">{report.reason}</p>
			</div>

			{report.status !== 'open' && (
				<div className="text-ink-weak flex flex-wrap items-center gap-x-2 gap-y-1 text-meta">
					<span>
						{report.resolvedBy !== null ? (
							report.status === 'dismissed' ? (
								<Trans>
									由{' '}
									<StageLink
										to={`/u/${report.resolvedBy.handle}`}
										className="text-ink-strong font-bold hover:underline"
									>
										{resolverName}
									</StageLink>{' '}
									驳回
								</Trans>
							) : (
								<Trans>
									由{' '}
									<StageLink
										to={`/u/${report.resolvedBy.handle}`}
										className="text-ink-strong font-bold hover:underline"
									>
										{resolverName}
									</StageLink>{' '}
									处理
								</Trans>
							)
						) : report.status === 'dismissed' ? (
							t`由管理人员驳回`
						) : (
							t`由管理人员处理`
						)}
					</span>
					{report.resolvedAt !== null && (
						<>
							<span>·</span>
							<Timestamp iso={report.resolvedAt} />
						</>
					)}
					{report.resolutionNote !== null && (
						<span className="text-ink break-words">{t`· 备注：${resolutionNote}`}</span>
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
							placeholder={t`备注（可选）`}
							aria-label={t`处理备注`}
							className="border-line bg-page text-ink-strong placeholder:text-ink-weak/60 hover:border-ink-weak focus:border-accent h-control min-w-0 flex-1 basis-48 rounded-[2px] border px-2.5 text-ui outline-none"
						/>
						<div className="flex flex-wrap items-center gap-2">
							<Button
								tone="ghost"
								type="submit"
								name="mode"
								value="dismiss"
								isPending={submittingMode === 'dismiss'}
								isDisabled={isSubmittingThis}
							>
								<Trans>驳回</Trans>
							</Button>
							<Button
								tone="secondary"
								type="submit"
								name="mode"
								value="resolve"
								isPending={submittingMode === 'resolve'}
								isDisabled={isSubmittingThis}
							>
								<Trans>标记已处理</Trans>
							</Button>
							<Button
								tone="danger"
								type="submit"
								name="mode"
								value="resolve-delete"
								isPending={submittingMode === 'resolve-delete'}
								isDisabled={isSubmittingThis}
							>
								<Trash2 aria-hidden />
								{report.targetType === 'thread' ? t`处理并删除主题` : t`处理并删除内容`}
							</Button>
						</div>
					</div>
				</Form>
			)}
		</Panel>
	)
}

function LogRow({ entry }: { entry: ModerationLogDto }) {
	const { t, i18n } = useLingui()
	const actionMeta = formatModerationLogAction(i18n, entry.action)
	const targetRef = entry.targetId.slice(0, 8)
	return (
		<li className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
			<div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
				<div className="flex flex-wrap items-center gap-2">
					<Tag tone={actionMeta.tone}>{actionMeta.label}</Tag>
					<StageLink
						to={`/u/${entry.actor.handle}`}
						className="text-ink-strong inline-flex items-center gap-1.5 font-bold hover:underline"
					>
						<UserAvatar user={entry.actor} size="sm" />
						<span>{entry.actor.displayName}</span>
					</StageLink>
					{entry.targetUser !== null ? (
						<span className="text-ink-weak text-meta">
							<Trans>目标用户：</Trans>
							<StageLink
								to={`/u/${entry.targetUser.handle}`}
								className="text-ink-strong font-bold hover:underline"
							>
								{entry.targetUser.displayName}
							</StageLink>
						</span>
					) : entry.targetType === 'thread' ? (
						<StageLink
							to={`/t/${entry.targetId}`}
							className="text-accent text-meta hover:underline"
						>
							{t`主题 #${targetRef}`}
						</StageLink>
					) : (
						<span className="text-ink-weak font-mono text-meta">
							{entry.targetType}:{entry.targetId.slice(0, 8)}
						</span>
					)}
				</div>
				{entry.detail !== null && <p className="text-ink text-meta break-words">{entry.detail}</p>}
			</div>
			<Timestamp iso={entry.createdAt} className="text-ink-weak shrink-0 text-meta" />
		</li>
	)
}

/**
 * The selected segment's fill; it slides to the newly selected segment when the view or filter
 * switches. Each row of segments on the page needs its own `name`.
 */
function SegmentIndicator({ name = 'moderation-tab' }: { name?: string }) {
	return (
		<span
			aria-hidden
			style={{
				viewTransitionName: name,
				viewTransitionClass: 'indicator',
			}}
			className="bg-selected absolute inset-0 -z-10 rounded-[2px]"
		/>
	)
}
