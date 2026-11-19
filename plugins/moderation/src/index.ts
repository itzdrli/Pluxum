import {
	failure,
	isEntityId,
	normalizePage,
	type ForumAction,
	type ModerationLogDto,
	type ModerationLogPageDto,
	type ModerationQueuePageDto,
	type ModerationQueueStatus,
	type ModerationReportDto,
	type ModerationTargetType,
	type Principal,
	type UserBanStatusDto,
	type UserDto,
} from '@pluxum/domain'
import { ForumApiPlugin } from '@pluxum/api'
import { ForumAuth } from '@pluxum/auth'
import {
	ForumCorePlugin,
	type ForumResult,
	type PostBeforeWriteEvent,
	type PostHookRejection,
} from '@pluxum/core'
import { BasePlugin, Plugin } from '@pluxel/core'
import { Result } from '@pluxel/core/better-result'
import { Database, type PluginDatabaseHandle } from '@pluxel/services/database'
import { and, count, desc, eq, isNull } from 'drizzle-orm'
import { Type, type Static } from 'typebox'
import * as v from 'valibot'
import * as f from 'valibot-form'
import { bans, ModerationDatabase, moderationLogs, reports } from './database'

/** The extension's ID: key in `user.ext`, UI slot contributor ID and `/api/forum/ext/:extId` segment. */
export const MODERATION_EXT_ID = 'forum-moderation'
export const MODERATION_POLICY_ID = 'forum-moderation.bans'
export const MODERATION_POST_HOOK_ID = 'forum-moderation.filter'

const REASON_MAX_LENGTH = 500
const NOTE_MAX_LENGTH = 500

export const ForumModerationConfig = v.object({
	/** Words or phrases (matched case-insensitively after NFKC normalization) rejected in titles and post bodies. */
	blockedWords: v.optional(
		v.pipe(
			v.array(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120))),
			f.formMeta({
				title: '屏蔽词',
				description: '标题或正文含有这些词时拒绝发布，不区分大小写和全半角。',
			}),
			f.arrayMeta({ itemLabel: '屏蔽词', addLabel: '添加屏蔽词', emptyHint: '未设置屏蔽词' }),
		),
		[],
	),
})
export type ForumModerationConfig = v.InferOutput<typeof ForumModerationConfig>

const BANNED_WRITE_ACTIONS: ReadonlySet<ForumAction> = new Set<ForumAction>([
	'thread.create',
	'thread.edit',
	'thread.delete',
	'thread.moderate',
	'post.create',
	'post.edit',
	'post.delete',
	'post.react',
	'user.edit',
])

type ActiveBan = Readonly<{
	userId: string
	reason: string
	bannedBy: string
	createdAt: Date
	expiresAt: Date | null
}>

type ReportRow = typeof reports.$inferSelect

export const ModerationUser = Type.Object({
	id: Type.String(),
	handle: Type.String(),
	displayName: Type.String(),
	ext: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})
export type ModerationUser = Static<typeof ModerationUser>

export const ReportSubmittedResult = Type.Object({
	id: Type.String(),
	targetType: Type.Union([Type.Literal('post'), Type.Literal('thread')]),
	targetId: Type.String(),
	threadId: Type.String(),
	postId: Type.Union([Type.String(), Type.Null()]),
	status: Type.Literal('open'),
	createdAt: Type.String(),
})
export type ReportSubmittedResult = Static<typeof ReportSubmittedResult>

export const ModerationReportItem = Type.Object({
	id: Type.String(),
	targetType: Type.Union([Type.Literal('post'), Type.Literal('thread')]),
	targetId: Type.String(),
	threadId: Type.String(),
	postId: Type.Union([Type.String(), Type.Null()]),
	reason: Type.String(),
	status: Type.Union([Type.Literal('open'), Type.Literal('resolved'), Type.Literal('dismissed')]),
	reporter: ModerationUser,
	targetAuthor: Type.Union([ModerationUser, Type.Null()]),
	resolutionNote: Type.Union([Type.String(), Type.Null()]),
	resolvedBy: Type.Union([ModerationUser, Type.Null()]),
	resolvedAt: Type.Union([Type.String(), Type.Null()]),
	createdAt: Type.String(),
})
export type ModerationReportItem = Static<typeof ModerationReportItem>

export const ModerationQueueResult = Type.Object({
	items: Type.Array(ModerationReportItem),
	page: Type.Integer({ minimum: 1 }),
	pageSize: Type.Integer({ minimum: 1 }),
	total: Type.Integer({ minimum: 0 }),
	openCount: Type.Integer({ minimum: 0 }),
})
export type ModerationQueueResult = Static<typeof ModerationQueueResult>

export const BanResult = Type.Object({
	userId: Type.String(),
	banned: Type.Literal(true),
	reason: Type.String(),
	expiresAt: Type.Union([Type.String(), Type.Null()]),
	revokedSessions: Type.Integer({ minimum: 0 }),
})
export type BanResult = Static<typeof BanResult>

export const UnbanResult = Type.Object({
	userId: Type.String(),
	banned: Type.Literal(false),
})
export type UnbanResult = Static<typeof UnbanResult>

export const ModerationLogItem = Type.Object({
	id: Type.String(),
	actor: ModerationUser,
	action: Type.String(),
	targetType: Type.String(),
	targetId: Type.String(),
	targetUser: Type.Union([ModerationUser, Type.Null()]),
	detail: Type.Union([Type.String(), Type.Null()]),
	createdAt: Type.String(),
})
export type ModerationLogItem = Static<typeof ModerationLogItem>

export const ModerationLogsResult = Type.Object({
	items: Type.Array(ModerationLogItem),
	page: Type.Integer({ minimum: 1 }),
	pageSize: Type.Integer({ minimum: 1 }),
	total: Type.Integer({ minimum: 0 }),
})
export type ModerationLogsResult = Static<typeof ModerationLogsResult>

const ReportInput = Type.Object({
	postId: Type.Optional(Type.String({ maxLength: 64 })),
	targetId: Type.Optional(Type.String({ maxLength: 64 })),
	targetType: Type.Optional(Type.Union([Type.Literal('post'), Type.Literal('thread')])),
	reason: Type.String({ maxLength: 500 }),
})

// Query parameters on `GET` extActions arrive as strings.
const QueueInput = Type.Object({
	status: Type.Optional(Type.String({ maxLength: 16 })),
	page: Type.Optional(Type.String({ maxLength: 10 })),
	pageSize: Type.Optional(Type.String({ maxLength: 10 })),
})

const ResolveInput = Type.Object({
	reportId: Type.String({ maxLength: 64 }),
	decision: Type.Union([Type.Literal('resolved'), Type.Literal('dismissed')]),
	deleteTarget: Type.Optional(Type.Boolean()),
	note: Type.Optional(Type.String({ maxLength: 500 })),
})

const BanInput = Type.Object({
	userId: Type.String({ maxLength: 64 }),
	reason: Type.String({ maxLength: 500 }),
	durationHours: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 87_600 })),
})

const UnbanInput = Type.Object({
	userId: Type.String({ maxLength: 64 }),
	reason: Type.Optional(Type.String({ maxLength: 500 })),
})

const LogsInput = Type.Object({
	page: Type.Optional(Type.String({ maxLength: 10 })),
	pageSize: Type.Optional(Type.String({ maxLength: 10 })),
})

function queryInt(value: string | undefined): number | undefined {
	return value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined
}

function isQueueStatus(value: string): value is ModerationQueueStatus {
	return value === 'open' || value === 'resolved' || value === 'dismissed' || value === 'all'
}

function normalizeMatchText(raw: string): string {
	return raw.normalize('NFKC').toLowerCase()
}

function cleanText(raw: string | undefined, maxLength: number): string | null {
	if (raw === undefined) return null
	const trimmed = raw.trim()
	if (!trimmed) return null
	const chars = Array.from(trimmed)
	return chars.length <= maxLength ? trimmed : null
}

/**
 * Reports, moderation queue, audit logs, word filtering and account bans.
 *
 * Contributes:
 * - `permissionPolicies` (`forum-moderation.bans`) synchronously denying write actions to banned accounts;
 * - `postHooks` (`forum-moderation.filter`) enforcing active bans as a pre-write safety net and rejecting configured `blockedWords`;
 * - `entityExtensions` on `user` (`forum-moderation`) exposing `{ banned, reason, expiresAt }` while actively banned;
 * - `uiSlots` (`post.actions`, `user.profile.tabs`);
 * - `extActions` under `/api/forum/ext/forum-moderation/{report,queue,resolve,ban,unban,logs}`.
 */
@Plugin({ displayName: 'Forum Moderation', startTimeoutMs: 30_000 })
export class ForumModerationPlugin extends BasePlugin {
	private readonly config = this.configs.use(ForumModerationConfig)
	private database!: PluginDatabaseHandle<typeof ModerationDatabase>
	private readonly activeBans = new Map<string, ActiveBan>()

	constructor(
		private readonly core: ForumCorePlugin,
		private readonly api: ForumApiPlugin,
		private readonly auth: ForumAuth,
	) {
		super()
	}

	protected override async init(): Promise<void> {
		this.database = await this.ctx.require(Database).use(ModerationDatabase)
		await this.preloadActiveBans()
		// Blocked words are read on every write, so a new list applies as soon as it is saved.
		this.configs.onUpdate(this.config, () => {})

		this.ctx.effects.defer(() => {
			this.activeBans.clear()
		})
		this.ctx.effects.defer(
			this.core.registerPaletteCommands({
				id: 'forum-moderation',
				commands: [
					{
						id: 'queue',
						label: '审核队列',
						keywords: ['举报', '版主', 'moderation'],
						href: '/moderation',
						minRole: 'moderator',
					},
				],
			}),
		)

		this.ctx.effects.defer(
			this.core.registerPermissionPolicy({
				id: MODERATION_POLICY_ID,
				evaluate: ({ principal, action }) => {
					if (!BANNED_WRITE_ACTIONS.has(action)) return 'abstain'
					return this.activeBanOf(principal.userId) !== null ? 'deny' : 'abstain'
				},
			}),
		)

		this.ctx.effects.defer(
			this.core.registerPostHook({
				id: MODERATION_POST_HOOK_ID,
				beforeWrite: (event) => this.onBeforeWrite(event),
			}),
		)

		this.ctx.effects.defer(
			this.core.registerEntityExtension({
				id: MODERATION_EXT_ID,
				entity: 'user',
				load: (userIds) => this.userBanSummaries(userIds),
			}),
		)

		this.ctx.effects.defer(
			this.core.registerUiSlots({
				id: MODERATION_EXT_ID,
				slots: ['post.actions', 'user.profile.tabs'],
			}),
		)

		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: MODERATION_EXT_ID,
				action: 'report',
				method: 'POST',
				login: true,
				input: ReportInput,
				output: ReportSubmittedResult,
				handle: ({ principal, input }) => this.submitReport(principal, input),
			}),
		)

		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: MODERATION_EXT_ID,
				action: 'queue',
				method: 'GET',
				login: true,
				input: QueueInput,
				output: ModerationQueueResult,
				handle: ({ principal, input }) =>
					this.listQueue(principal, {
						status: input.status,
						page: queryInt(input.page),
						pageSize: queryInt(input.pageSize),
					}),
			}),
		)

		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: MODERATION_EXT_ID,
				action: 'resolve',
				method: 'POST',
				login: true,
				input: ResolveInput,
				output: ModerationReportItem,
				handle: ({ principal, input }) => this.resolveReport(principal, input),
			}),
		)

		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: MODERATION_EXT_ID,
				action: 'ban',
				method: 'POST',
				login: true,
				input: BanInput,
				output: BanResult,
				handle: ({ principal, input }) => this.banUser(principal, input),
			}),
		)

		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: MODERATION_EXT_ID,
				action: 'unban',
				method: 'POST',
				login: true,
				input: UnbanInput,
				output: UnbanResult,
				handle: ({ principal, input }) => this.unbanUser(principal, input),
			}),
		)

		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: MODERATION_EXT_ID,
				action: 'logs',
				method: 'GET',
				login: true,
				input: LogsInput,
				output: ModerationLogsResult,
				handle: ({ principal, input }) =>
					this.listLogs(principal, {
						page: queryInt(input.page),
						pageSize: queryInt(input.pageSize),
					}),
			}),
		)
	}

	private async preloadActiveBans(): Promise<void> {
		const rows = await this.database.read((db) =>
			db.select().from(bans).where(isNull(bans.revokedAt)),
		)
		const now = Date.now()
		this.activeBans.clear()
		for (const row of rows) {
			if (row.expiresAt === null || row.expiresAt.getTime() > now) {
				this.activeBans.set(row.userId, {
					userId: row.userId,
					reason: row.reason,
					bannedBy: row.bannedBy,
					createdAt: row.createdAt,
					expiresAt: row.expiresAt,
				})
			}
		}
	}

	private activeBanOf(userId: string | null): ActiveBan | null {
		if (userId === null) return null
		const ban = this.activeBans.get(userId)
		if (!ban) return null
		if (ban.expiresAt !== null && ban.expiresAt.getTime() <= Date.now()) {
			this.activeBans.delete(userId)
			return null
		}
		return ban
	}

	private onBeforeWrite(event: PostBeforeWriteEvent): PostHookRejection | void {
		if (this.activeBanOf(event.principal.userId) !== null) {
			return failure('forbidden', 'ban.cannot_post')
		}
		const words = this.config.blockedWords
		if (words.length === 0) return undefined

		const texts: string[] = []
		switch (event.kind) {
			case 'thread.create':
				texts.push(event.title, event.body)
				break
			case 'thread.update':
				texts.push(event.title)
				break
			case 'post.create':
			case 'post.update':
				texts.push(event.body)
				break
		}

		const normalizedTexts = texts.map(normalizeMatchText)
		for (const rawWord of words) {
			const needle = normalizeMatchText(rawWord.trim())
			if (!needle) continue
			if (normalizedTexts.some((haystack) => haystack.includes(needle))) {
				return failure('invalid', 'content.banned_words')
			}
		}
		return undefined
	}

	private userBanSummaries(userIds: readonly string[]): Promise<Map<string, UserBanStatusDto>> {
		const out = new Map<string, UserBanStatusDto>()
		for (const userId of userIds) {
			const ban = this.activeBanOf(userId)
			if (!ban) continue
			out.set(userId, {
				banned: true,
				reason: ban.reason,
				expiresAt: ban.expiresAt === null ? null : ban.expiresAt.toISOString(),
			})
		}
		return Promise.resolve(out)
	}

	private ensureStaff(principal: Principal): ForumResult<string> {
		if (principal.userId === null) {
			return Result.err(failure('unauthenticated', 'auth.required'))
		}
		if (!this.core.can(principal, 'thread.moderate')) {
			return Result.err(failure('forbidden', 'permission.denied'))
		}
		return Result.ok(principal.userId)
	}

	private async resolveUsers(
		userIds: readonly (string | null | undefined)[],
		viewer: Principal,
	): Promise<Map<string, UserDto>> {
		const uniqueIds = [
			...new Set(
				userIds.filter((userId): userId is string => userId != null && isEntityId(userId)),
			),
		]
		const byId = new Map<string, UserDto>()
		await Promise.all(
			uniqueIds.map(async (userId) => {
				const resolved = await this.core.getUser(userId, viewer)
				byId.set(
					userId,
					resolved.isOk()
						? resolved.value
						: { id: userId, handle: userId, displayName: '未知用户' },
				)
			}),
		)
		return byId
	}

	private toReportDto(
		row: ReportRow,
		usersById: ReadonlyMap<string, UserDto>,
	): ModerationReportDto {
		return {
			id: row.id,
			targetType: row.targetType,
			targetId: row.targetId,
			threadId: row.threadId,
			postId: row.postId,
			reason: row.reason,
			status: row.status,
			reporter: usersById.get(row.reporterId) ?? {
				id: row.reporterId,
				handle: row.reporterId,
				displayName: '未知用户',
			},
			targetAuthor:
				row.targetAuthorId === null
					? null
					: (usersById.get(row.targetAuthorId) ?? {
							id: row.targetAuthorId,
							handle: row.targetAuthorId,
							displayName: '未知用户',
						}),
			resolutionNote: row.resolutionNote,
			resolvedBy:
				row.resolvedBy === null
					? null
					: (usersById.get(row.resolvedBy) ?? {
							id: row.resolvedBy,
							handle: row.resolvedBy,
							displayName: '未知用户',
						}),
			resolvedAt: row.resolvedAt === null ? null : row.resolvedAt.toISOString(),
			createdAt: row.createdAt.toISOString(),
		}
	}

	/** Submits a member report against a visible post or thread, guarding against duplicate open reports. */
	async submitReport(
		principal: Principal,
		input: Readonly<{
			postId?: string
			targetId?: string
			targetType?: ModerationTargetType
			reason: string
		}>,
	): Promise<ForumResult<ReportSubmittedResult>> {
		const reporterId = principal.userId
		if (reporterId === null) {
			return Result.err(failure('unauthenticated', 'auth.required'))
		}
		if (this.activeBanOf(reporterId) !== null) {
			return Result.err(failure('forbidden', 'ban.cannot_act'))
		}

		const reason = cleanText(input.reason, REASON_MAX_LENGTH)
		if (reason === null) {
			return Result.err(
				!input.reason.trim()
					? failure('invalid', 'field.required', { field: 'report_reason' })
					: failure('invalid', 'field.too_long', {
							field: 'report_reason',
							max: REASON_MAX_LENGTH,
						}),
			)
		}

		const lookupPostId = input.postId ?? input.targetId
		if (!lookupPostId) {
			return Result.err(failure('invalid', 'report.no_target'))
		}

		const located = await this.core.locatePost(principal, lookupPostId)
		if (located.isErr()) return Result.err(located.error)

		const targetType: ModerationTargetType = input.targetType ?? 'post'
		const threadId = located.value.threadId
		const postId = located.value.postId
		const targetId = targetType === 'thread' ? threadId : postId
		const storedPostId = targetType === 'post' ? postId : null
		const targetAuthorId = located.value.resource.authorId ?? null

		return this.database.transaction(async (tx) => {
			const [duplicate] = await tx
				.select({ id: reports.id })
				.from(reports)
				.where(
					and(
						eq(reports.reporterId, reporterId),
						eq(reports.targetType, targetType),
						eq(reports.targetId, targetId),
						eq(reports.status, 'open'),
					),
				)
				.limit(1)
			if (duplicate) {
				return Result.err(failure('conflict', 'report.duplicate'))
			}

			const [created] = await tx
				.insert(reports)
				.values({
					reporterId,
					targetType,
					targetId,
					threadId,
					postId: storedPostId,
					targetAuthorId,
					reason,
					status: 'open',
				})
				.returning()
			if (!created) throw new Error('Report insert returned no row')

			await tx.insert(moderationLogs).values({
				actorId: reporterId,
				action: 'report.created',
				targetType,
				targetId,
				detail: reason,
			})

			return Result.ok({
				id: created.id,
				targetType: created.targetType,
				targetId: created.targetId,
				threadId: created.threadId,
				postId: created.postId,
				status: 'open' as const,
				createdAt: created.createdAt.toISOString(),
			})
		})
	}

	/** Lists reports for staff, filtered by status (`open | resolved | dismissed | all`). */
	async listQueue(
		principal: Principal,
		options: { status?: string; page?: number; pageSize?: number } = {},
	): Promise<ForumResult<ModerationQueuePageDto>> {
		const staff = this.ensureStaff(principal)
		if (staff.isErr()) return Result.err(staff.error)

		const rawStatus = options.status ?? 'open'
		if (!isQueueStatus(rawStatus)) {
			return Result.err(failure('invalid', 'report.bad_status'))
		}
		const { page, pageSize } = normalizePage(options)
		const filter = rawStatus === 'all' ? undefined : eq(reports.status, rawStatus)

		const { rows, total, openCount } = await this.database.read(async (db) => {
			const [totalRow] = await db.select({ value: count() }).from(reports).where(filter)
			const [openRow] = await db
				.select({ value: count() })
				.from(reports)
				.where(eq(reports.status, 'open'))
			const pageRows = await db
				.select()
				.from(reports)
				.where(filter)
				.orderBy(desc(reports.createdAt), desc(reports.id))
				.limit(pageSize)
				.offset((page - 1) * pageSize)
			return {
				rows: pageRows,
				total: totalRow?.value ?? 0,
				openCount: openRow?.value ?? 0,
			}
		})

		const usersById = await this.resolveUsers(
			rows.flatMap((row) => [row.reporterId, row.targetAuthorId, row.resolvedBy]),
			principal,
		)

		return Result.ok({
			items: rows.map((row) => this.toReportDto(row, usersById)),
			page,
			pageSize,
			total,
			openCount,
		})
	}

	/** Resolves or dismisses a report, optionally deleting the reported post or thread first. */
	async resolveReport(
		principal: Principal,
		input: Readonly<{
			reportId: string
			decision: 'resolved' | 'dismissed'
			deleteTarget?: boolean
			note?: string
		}>,
	): Promise<ForumResult<ModerationReportDto>> {
		const staff = this.ensureStaff(principal)
		if (staff.isErr()) return Result.err(staff.error)
		const actorId = staff.value

		if (!isEntityId(input.reportId)) {
			return Result.err(failure('not_found', 'entity.not_found', { entity: 'report' }))
		}
		if (input.note !== undefined && Array.from(input.note.trim()).length > NOTE_MAX_LENGTH) {
			return Result.err(
				failure('invalid', 'field.too_long', { field: 'resolution_note', max: NOTE_MAX_LENGTH }),
			)
		}
		const note = cleanText(input.note, NOTE_MAX_LENGTH)

		const [existing] = await this.database.read((db) =>
			db.select().from(reports).where(eq(reports.id, input.reportId)).limit(1),
		)
		if (!existing) {
			return Result.err(failure('not_found', 'entity.not_found', { entity: 'report' }))
		}

		const deleteTarget = input.decision === 'resolved' && input.deleteTarget === true
		if (deleteTarget) {
			if (existing.targetType === 'thread') {
				const deleted = await this.core.deleteThread(principal, existing.threadId)
				if (deleted.isErr() && deleted.error.code !== 'not_found') {
					return Result.err(deleted.error)
				}
			} else {
				const targetPostId = existing.postId ?? existing.targetId
				const deleted = await this.core.deletePost(principal, targetPostId)
				if (deleted.isErr()) {
					if (deleted.error.code === 'conflict') {
						// Reporting the opening post and choosing "delete target" deletes the whole thread.
						const threadDeleted = await this.core.deleteThread(principal, existing.threadId)
						if (threadDeleted.isErr() && threadDeleted.error.code !== 'not_found') {
							return Result.err(threadDeleted.error)
						}
					} else if (deleted.error.code !== 'not_found') {
						return Result.err(deleted.error)
					}
				}
			}
		}

		const now = new Date()
		const logAction =
			input.decision === 'dismissed'
				? 'report.dismissed'
				: deleteTarget
					? 'report.resolved_deleted'
					: 'report.resolved'

		const updated = await this.database.transaction(async (tx) => {
			const [row] = await tx
				.update(reports)
				.set({
					status: input.decision,
					resolutionNote: note,
					resolvedBy: actorId,
					resolvedAt: now,
				})
				.where(eq(reports.id, existing.id))
				.returning()
			if (!row) return null

			await tx.insert(moderationLogs).values({
				actorId,
				action: logAction,
				targetType: existing.targetType,
				targetId: existing.targetId,
				detail: note,
			})
			return row
		})
		if (!updated) return Result.err(failure('not_found', 'entity.not_found', { entity: 'report' }))

		const usersById = await this.resolveUsers(
			[updated.reporterId, updated.targetAuthorId, updated.resolvedBy],
			principal,
		)
		return Result.ok(this.toReportDto(updated, usersById))
	}

	/** Bans a user (forbidding self or admins), updates the sync ban map and revokes live sessions. */
	async banUser(
		principal: Principal,
		input: Readonly<{
			userId: string
			reason: string
			durationHours?: number
		}>,
	): Promise<ForumResult<BanResult>> {
		const staff = this.ensureStaff(principal)
		if (staff.isErr()) return Result.err(staff.error)
		const actorId = staff.value

		if (!isEntityId(input.userId)) {
			return Result.err(failure('not_found', 'entity.not_found', { entity: 'user' }))
		}
		if (actorId === input.userId) {
			return Result.err(failure('forbidden', 'ban.self'))
		}

		const reason = cleanText(input.reason, REASON_MAX_LENGTH)
		if (reason === null) {
			return Result.err(
				!input.reason.trim()
					? failure('invalid', 'field.required', { field: 'ban_reason' })
					: failure('invalid', 'field.too_long', { field: 'ban_reason', max: REASON_MAX_LENGTH }),
			)
		}

		if (
			input.durationHours !== undefined &&
			(!Number.isFinite(input.durationHours) || input.durationHours <= 0)
		) {
			return Result.err(failure('invalid', 'ban.duration'))
		}

		const targetUser = await this.core.getUser(input.userId, principal)
		if (targetUser.isErr()) return Result.err(targetUser.error)

		const targetPrincipal = await this.core.principalOf(input.userId)
		if (targetPrincipal.roles.includes('admin')) {
			return Result.err(failure('forbidden', 'ban.admin'))
		}

		const now = new Date()
		const expiresAt =
			input.durationHours === undefined
				? null
				: new Date(now.getTime() + Math.max(1, Math.round(input.durationHours * 3_600_000)))

		await this.database.transaction(async (tx) => {
			await tx
				.insert(bans)
				.values({
					userId: input.userId,
					reason,
					bannedBy: actorId,
					expiresAt,
					createdAt: now,
					revokedAt: null,
					revokedBy: null,
				})
				.onConflictDoUpdate({
					target: bans.userId,
					set: {
						reason,
						bannedBy: actorId,
						expiresAt,
						createdAt: now,
						revokedAt: null,
						revokedBy: null,
					},
				})

			await tx.insert(moderationLogs).values({
				actorId,
				action: 'user.banned',
				targetType: 'user',
				targetId: input.userId,
				detail:
					expiresAt === null
						? `${reason}（永久封禁）`
						: `${reason}（封禁至 ${expiresAt.toISOString()}）`,
			})
		})

		this.activeBans.set(input.userId, {
			userId: input.userId,
			reason,
			bannedBy: actorId,
			createdAt: now,
			expiresAt,
		})

		const revokedSessions = await this.auth.revokeUserSessions(input.userId)

		return Result.ok({
			userId: input.userId,
			banned: true,
			reason,
			expiresAt: expiresAt === null ? null : expiresAt.toISOString(),
			revokedSessions,
		})
	}

	/** Lifts an active ban on a user and updates the synchronous ban map. */
	async unbanUser(
		principal: Principal,
		input: Readonly<{ userId: string; reason?: string }>,
	): Promise<ForumResult<UnbanResult>> {
		const staff = this.ensureStaff(principal)
		if (staff.isErr()) return Result.err(staff.error)
		const actorId = staff.value

		if (!isEntityId(input.userId)) {
			return Result.err(failure('not_found', 'entity.not_found', { entity: 'user' }))
		}
		if (input.reason !== undefined && Array.from(input.reason.trim()).length > REASON_MAX_LENGTH) {
			return Result.err(
				failure('invalid', 'field.too_long', { field: 'unban_note', max: REASON_MAX_LENGTH }),
			)
		}

		const targetUser = await this.core.getUser(input.userId, principal)
		if (targetUser.isErr()) return Result.err(targetUser.error)

		const reason = cleanText(input.reason, REASON_MAX_LENGTH)
		const now = new Date()

		await this.database.transaction(async (tx) => {
			await tx
				.update(bans)
				.set({ revokedAt: now, revokedBy: actorId })
				.where(and(eq(bans.userId, input.userId), isNull(bans.revokedAt)))

			await tx.insert(moderationLogs).values({
				actorId,
				action: 'user.unbanned',
				targetType: 'user',
				targetId: input.userId,
				detail: reason,
			})
		})

		this.activeBans.delete(input.userId)

		return Result.ok({
			userId: input.userId,
			banned: false,
		})
	}

	/** Lists paginated moderation audit logs for staff. */
	async listLogs(
		principal: Principal,
		options: { page?: number; pageSize?: number } = {},
	): Promise<ForumResult<ModerationLogPageDto>> {
		const staff = this.ensureStaff(principal)
		if (staff.isErr()) return Result.err(staff.error)

		const { page, pageSize } = normalizePage(options)
		const { rows, total } = await this.database.read(async (db) => {
			const [totalRow] = await db.select({ value: count() }).from(moderationLogs)
			const pageRows = await db
				.select()
				.from(moderationLogs)
				.orderBy(desc(moderationLogs.createdAt), desc(moderationLogs.id))
				.limit(pageSize)
				.offset((page - 1) * pageSize)
			return {
				rows: pageRows,
				total: totalRow?.value ?? 0,
			}
		})

		const usersById = await this.resolveUsers(
			rows.flatMap((row) =>
				row.targetType === 'user' ? [row.actorId, row.targetId] : [row.actorId],
			),
			principal,
		)

		const items: ModerationLogDto[] = rows.map((row) => ({
			id: row.id,
			actor: usersById.get(row.actorId) ?? {
				id: row.actorId,
				handle: row.actorId,
				displayName: '未知用户',
			},
			action: row.action,
			targetType: row.targetType,
			targetId: row.targetId,
			targetUser:
				row.targetType === 'user'
					? (usersById.get(row.targetId) ?? {
							id: row.targetId,
							handle: row.targetId,
							displayName: '未知用户',
						})
					: null,
			detail: row.detail,
			createdAt: row.createdAt.toISOString(),
		}))

		return Result.ok({
			items,
			page,
			pageSize,
			total,
		})
	}
}
