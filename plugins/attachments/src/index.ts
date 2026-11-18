import { createHash, randomUUID } from 'node:crypto'
import { isEntityId, type Principal } from '@pluxum/domain'
import { ForumApiPlugin, type ExtFileObject } from '@pluxum/api'
import { ForumCorePlugin, type ForumResult, type PostAfterWriteEvent } from '@pluxum/core'
import { BasePlugin, Plugin } from '@pluxel/core'
import { Result } from '@pluxel/core/better-result'
import { S3 } from '@pluxel/plugin-storage'
import { Database, type PluginDatabaseHandle } from '@pluxel/services/database'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { Type, type Static } from 'typebox'
import * as v from 'valibot'
import * as f from 'valibot-form'
import { attachments, AttachmentsDatabase, postAttachments, userAvatars } from './database'

export { ForumStorageConfig, ForumStoragePlugin, type ForumStorageBucketConfig } from './storage'

/** The extension's ID: key in `ext`, UI slot contributor ID and `/api/forum/ext/:extId` segment. */
export const ATTACHMENTS_EXT_ID = 'forum-attachments'

const MEBIBYTE = 1024 * 1024

/** Document types an admin may allow; raster images are always accepted (and checked by content). */
export const DOCUMENT_TYPES = [
	'application/pdf',
	'application/zip',
	'application/json',
	'text/plain',
	'text/markdown',
	'text/csv',
] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

const DOCUMENT_LABELS: Readonly<Record<DocumentType, string>> = {
	'application/pdf': 'PDF',
	'application/zip': 'ZIP',
	'application/json': 'JSON',
	'text/plain': 'TXT',
	'text/markdown': 'Markdown',
	'text/csv': 'CSV',
}

/** Hard ceilings: the upload actions accept base64 bodies only this large. */
const ATTACHMENT_CEILING_MIB = 20
const AVATAR_CEILING_MIB = 5

const mebibytes = (fallback: number, ceiling: number, meta: Parameters<typeof f.formMeta>[0]) =>
	v.optional(
		v.pipe(
			v.number(),
			v.minValue(0.1),
			v.maxValue(ceiling),
			f.formMeta(meta),
			f.numberMeta({ step: 0.5 }),
		),
		fallback,
	)

export const ForumAttachmentsConfig = v.object({
	bucketId: v.optional(
		v.pipe(
			v.string(),
			v.regex(/^[a-z][a-z0-9._-]{0,63}$/),
			f.formMeta({
				title: '存储桶',
				description: '附件和头像存放的桶 ID，须在 Forum Storage 中已声明。修改后需重启本插件。',
			}),
		),
		'default',
	),
	attachmentMaxMiB: mebibytes(5, ATTACHMENT_CEILING_MIB, {
		title: '附件大小上限（MiB）',
		description: `帖子中单个附件的最大体积，最多 ${ATTACHMENT_CEILING_MIB} MiB。`,
	}),
	avatarMaxMiB: mebibytes(2, AVATAR_CEILING_MIB, {
		title: '头像大小上限（MiB）',
		description: `头像图片的最大体积，最多 ${AVATAR_CEILING_MIB} MiB。`,
	}),
	documentTypes: v.optional(
		v.pipe(
			v.array(v.pipe(v.picklist(DOCUMENT_TYPES), f.picklistMeta({ labels: DOCUMENT_LABELS }))),
			f.formMeta({
				title: '允许的文档类型',
				description: '图片始终允许，这里选择额外允许的文档类型。',
			}),
			f.arrayMeta({ layout: 'picker', itemLabel: '类型', addLabel: '添加类型' }),
		),
		[...DOCUMENT_TYPES],
	),
})
export type ForumAttachmentsConfig = v.InferOutput<typeof ForumAttachmentsConfig>

/** What the upload UI checks before sending a file; the actions enforce the same values. */
export const AttachmentLimits = Type.Object({
	attachmentMaxBytes: Type.Integer({ minimum: 1 }),
	avatarMaxBytes: Type.Integer({ minimum: 1 }),
	documentTypes: Type.Array(Type.String()),
})
export type AttachmentLimits = Static<typeof AttachmentLimits>

function formatMebibytes(bytes: number): string {
	return `${Number((bytes / MEBIBYTE).toFixed(1))} MB`
}

export function attachmentFilePath(id: string): string {
	return `/api/forum/ext/${ATTACHMENTS_EXT_ID}/files/${id}`
}

export const UserAvatarSummary = Type.Object({
	avatarUrl: Type.String(),
})
export type UserAvatarSummary = Static<typeof UserAvatarSummary>

export const AvatarActionResult = Type.Object({
	avatarUrl: Type.Union([Type.String(), Type.Null()]),
})
export type AvatarActionResult = Static<typeof AvatarActionResult>

export const AttachmentItem = Type.Object({
	id: Type.String(),
	url: Type.String(),
	filename: Type.String(),
	contentType: Type.String(),
	size: Type.Integer({ minimum: 1 }),
	isImage: Type.Boolean(),
})
export type AttachmentItem = Static<typeof AttachmentItem>

export const PostAttachmentsSummary = Type.Object({
	items: Type.Array(AttachmentItem),
})
export type PostAttachmentsSummary = Static<typeof PostAttachmentsSummary>

// Base64 of 5 MiB is ~6.99M chars; cap at 8M chars in schema before byte-level validation.
const UploadAvatarInput = Type.Object({
	userId: Type.Optional(Type.String({ maxLength: 64 })),
	filename: Type.Optional(Type.String({ maxLength: 120 })),
	contentType: Type.Optional(Type.String({ maxLength: 64 })),
	dataBase64: Type.String({ maxLength: Math.ceil((AVATAR_CEILING_MIB * MEBIBYTE * 4) / 3) + 4 }),
})

const DeleteAvatarInput = Type.Object({
	userId: Type.Optional(Type.String({ maxLength: 64 })),
})

const UploadAttachmentInput = Type.Object({
	filename: Type.String({ maxLength: 120 }),
	contentType: Type.String({ maxLength: 64 }),
	dataBase64: Type.String({
		maxLength: Math.ceil((ATTACHMENT_CEILING_MIB * MEBIBYTE * 4) / 3) + 4,
	}),
})

const RASTER_IMAGES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/webp': 'webp',
	'image/gif': 'gif',
}

/** Inspects magic bytes so disguised HTML/SVG/scripts cannot pass as raster images. */
export function sniffRasterImage(
	bytes: Uint8Array,
): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | null {
	if (
		bytes.byteLength >= 8 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47 &&
		bytes[4] === 0x0d &&
		bytes[5] === 0x0a &&
		bytes[6] === 0x1a &&
		bytes[7] === 0x0a
	) {
		return 'image/png'
	}
	if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return 'image/jpeg'
	}
	if (
		bytes.byteLength >= 6 &&
		bytes[0] === 0x47 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x38 &&
		(bytes[4] === 0x37 || bytes[4] === 0x39) &&
		bytes[5] === 0x61
	) {
		return 'image/gif'
	}
	if (
		bytes.byteLength >= 12 &&
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x46 &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	) {
		return 'image/webp'
	}
	return null
}

function decodeBase64Payload(raw: string): Uint8Array | null {
	const trimmed = raw.trim()
	const payload = trimmed.startsWith('data:')
		? trimmed.slice(trimmed.indexOf(',') + 1).trim()
		: trimmed
	if (!payload || payload.length % 4 === 1 || /[^A-Za-z0-9+/=\s_-]/.test(payload)) {
		return null
	}
	try {
		const buffer = Buffer.from(payload, 'base64')
		return buffer.byteLength > 0 ? new Uint8Array(buffer) : null
	} catch {
		return null
	}
}

function sanitizeFilename(input: string, fallback: string): string {
	const cleaned = input
		.replaceAll(/[\p{Cc}/\\<>:"|?*]/gu, '')
		.trim()
		.replaceAll(/\s+/g, ' ')
	if (!cleaned) return fallback
	return Array.from(cleaned).slice(0, 100).join('')
}

function safeS3Segment(filename: string): string {
	const safe = filename.replaceAll(/[^A-Za-z0-9._-]/g, '_').slice(0, 64)
	return safe || 'file'
}

const FILE_REF_PATTERN =
	/\/api\/forum\/ext\/forum-attachments\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi

export function extractAttachmentIds(body: string): string[] {
	const found: string[] = []
	const seen = new Set<string>()
	for (const match of body.matchAll(FILE_REF_PATTERN)) {
		const id = match[1]?.toLowerCase()
		if (id && !seen.has(id)) {
			seen.add(id)
			found.push(id)
		}
	}
	return found
}

/**
 * Avatars and post attachments backed by the official `S3` capability (`@pluxel/plugin-storage`).
 *
 * Stopping this plugin in Workbench withdraws:
 * - the `user` and `post` entity extensions (avatars revert to monograms, post attachment cards disappear);
 * - the `user.profile.tabs`, `composer.toolbar` and `post.footer` UI slots;
 * - the `/api/forum/ext/forum-attachments/*` upload actions and file serving endpoint.
 */
@Plugin({ displayName: 'Forum Attachments', startTimeoutMs: 30_000 })
export class ForumAttachmentsPlugin extends BasePlugin {
	private readonly config = this.configs.use(ForumAttachmentsConfig)
	private database!: PluginDatabaseHandle<typeof AttachmentsDatabase>

	constructor(
		private readonly core: ForumCorePlugin,
		private readonly api: ForumApiPlugin,
		private readonly s3: S3,
	) {
		super()
	}

	protected override async init(): Promise<void> {
		// Fail fast if the configured bucket is not present in the active S3 catalog.
		this.s3.bucket(this.config.bucketId)
		this.database = await this.ctx.require(Database).use(AttachmentsDatabase)
		// Limits are read on every upload; a new bucket only takes effect on restart.
		this.configs.onUpdate(this.config, ({ applied, desired }) => {
			if (desired.bucketId !== applied.bucketId) {
				throw new Error('bucketId changes apply on restart')
			}
		})

		this.ctx.effects.defer(
			this.core.registerEntityExtension({
				id: ATTACHMENTS_EXT_ID,
				entity: 'user',
				load: (userIds) => this.userAvatarsOf(userIds),
			}),
		)
		this.ctx.effects.defer(
			this.core.registerEntityExtension({
				id: ATTACHMENTS_EXT_ID,
				entity: 'post',
				load: (postIds) => this.postAttachmentsOf(postIds),
			}),
		)
		this.ctx.effects.defer(
			this.core.registerUiSlots({
				id: ATTACHMENTS_EXT_ID,
				slots: ['user.profile.tabs', 'composer.toolbar', 'post.footer'],
			}),
		)
		this.ctx.effects.defer(
			this.core.registerPostHook({
				id: `${ATTACHMENTS_EXT_ID}.posts`,
				afterWrite: (event) => this.onPostAfterWrite(event),
			}),
		)
		this.ctx.effects.defer(
			this.api.registerExtFile({
				extId: ATTACHMENTS_EXT_ID,
				read: ({ fileId, ifNoneMatch }) => this.readFile(fileId, ifNoneMatch),
			}),
		)
		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: ATTACHMENTS_EXT_ID,
				action: 'upload-avatar',
				method: 'POST',
				login: true,
				input: UploadAvatarInput,
				output: AvatarActionResult,
				handle: ({ principal, input }) => this.uploadAvatar(principal, input),
			}),
		)
		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: ATTACHMENTS_EXT_ID,
				action: 'delete-avatar',
				method: 'POST',
				login: true,
				input: DeleteAvatarInput,
				output: AvatarActionResult,
				handle: ({ principal, input }) => this.deleteAvatar(principal, input.userId),
			}),
		)
		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: ATTACHMENTS_EXT_ID,
				action: 'limits',
				method: 'GET',
				login: false,
				input: Type.Object({}),
				output: AttachmentLimits,
				handle: async () => Result.ok(this.limits()),
			}),
		)
		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: ATTACHMENTS_EXT_ID,
				action: 'upload',
				method: 'POST',
				login: true,
				input: UploadAttachmentInput,
				output: AttachmentItem,
				handle: ({ principal, input }) => this.uploadAttachment(principal, input),
			}),
		)
	}

	/** Current upload limits, in bytes. */
	limits(): AttachmentLimits {
		return {
			attachmentMaxBytes: Math.floor(this.config.attachmentMaxMiB * MEBIBYTE),
			avatarMaxBytes: Math.floor(this.config.avatarMaxMiB * MEBIBYTE),
			documentTypes: [...this.config.documentTypes],
		}
	}

	/** Batch-loads avatar URLs for the given user IDs in a single query. */
	async userAvatarsOf(userIds: readonly string[]): Promise<Map<string, UserAvatarSummary>> {
		const out = new Map<string, UserAvatarSummary>()
		if (userIds.length === 0) return out
		const rows = await this.database.read((db) =>
			db
				.select({
					userId: userAvatars.userId,
					attachmentId: userAvatars.attachmentId,
				})
				.from(userAvatars)
				.where(inArray(userAvatars.userId, [...userIds])),
		)
		for (const row of rows) {
			out.set(row.userId, { avatarUrl: attachmentFilePath(row.attachmentId) })
		}
		return out
	}

	/** Batch-loads linked attachments for the given post IDs in a single query. */
	async postAttachmentsOf(
		postIds: readonly string[],
	): Promise<Map<string, PostAttachmentsSummary>> {
		const out = new Map<string, PostAttachmentsSummary>()
		if (postIds.length === 0) return out
		const rows = await this.database.read((db) =>
			db
				.select({
					postId: postAttachments.postId,
					id: attachments.id,
					filename: attachments.filename,
					contentType: attachments.contentType,
					size: attachments.size,
				})
				.from(postAttachments)
				.innerJoin(attachments, eq(attachments.id, postAttachments.attachmentId))
				.where(inArray(postAttachments.postId, [...postIds]))
				.orderBy(asc(postAttachments.position), asc(attachments.createdAt)),
		)
		for (const row of rows) {
			const group = out.get(row.postId) ?? { items: [] }
			group.items.push({
				id: row.id,
				url: attachmentFilePath(row.id),
				filename: row.filename,
				contentType: row.contentType,
				size: row.size,
				isImage: RASTER_IMAGES.has(row.contentType),
			})
			out.set(row.postId, group)
		}
		return out
	}

	/** Sets a user's avatar, replacing and cleaning up any previous avatar. */
	async uploadAvatar(
		principal: Principal,
		input: Static<typeof UploadAvatarInput>,
	): Promise<ForumResult<AvatarActionResult>> {
		const actorId = principal.userId
		if (actorId === null) return Result.err({ code: 'unauthenticated', message: '请先登录' })
		const targetUserId = input.userId ?? actorId
		if (!isEntityId(targetUserId)) return Result.err({ code: 'not_found', message: '用户不存在' })
		if (!this.core.can(principal, 'user.edit', { userId: targetUserId })) {
			return Result.err({ code: 'forbidden', message: '没有权限执行此操作' })
		}
		const targetUser = await this.core.getUser(targetUserId, principal)
		if (targetUser.isErr()) return Result.err(targetUser.error)

		const bytes = decodeBase64Payload(input.dataBase64)
		if (!bytes) return Result.err({ code: 'invalid', message: '图片数据无法解析' })
		const { avatarMaxBytes } = this.limits()
		if (bytes.byteLength > avatarMaxBytes) {
			return Result.err({
				code: 'invalid',
				message: `头像图片不能超过 ${formatMebibytes(avatarMaxBytes)}`,
			})
		}
		const sniffed = sniffRasterImage(bytes)
		if (!sniffed) {
			return Result.err({
				code: 'invalid',
				message: '头像仅支持 PNG、JPEG、WebP 或 GIF 图片',
			})
		}

		const id = randomUUID()
		const ext = IMAGE_EXTENSIONS[sniffed] ?? 'bin'
		const filename = sanitizeFilename(input.filename ?? `avatar.${ext}`, `avatar.${ext}`)
		const objectKey = `avatars/${targetUserId}/${id}.${ext}`
		const sha256 = createHash('sha256').update(bytes).digest('hex')

		await this.s3.bucket(this.config.bucketId).client.putAnyObject(objectKey, bytes, sniffed)

		let previousObjectKey: string | undefined
		try {
			previousObjectKey = await this.database.transaction(async (tx) => {
				const [existing] = await tx
					.select({
						attachmentId: userAvatars.attachmentId,
						objectKey: attachments.objectKey,
					})
					.from(userAvatars)
					.innerJoin(attachments, eq(attachments.id, userAvatars.attachmentId))
					.where(eq(userAvatars.userId, targetUserId))

				await tx.insert(attachments).values({
					id,
					uploaderId: actorId,
					purpose: 'avatar',
					objectKey,
					filename,
					contentType: sniffed,
					size: bytes.byteLength,
					sha256,
				})
				await tx
					.insert(userAvatars)
					.values({ userId: targetUserId, attachmentId: id })
					.onConflictDoUpdate({
						target: userAvatars.userId,
						set: { attachmentId: id, updatedAt: new Date() },
					})

				if (existing) {
					await tx.delete(attachments).where(eq(attachments.id, existing.attachmentId))
				}
				return existing?.objectKey
			})
		} catch (error) {
			await this.s3
				.bucket(this.config.bucketId)
				.client.deleteObject(objectKey)
				.catch(() => {})
			throw error
		}

		if (previousObjectKey) {
			await this.s3
				.bucket(this.config.bucketId)
				.client.deleteObject(previousObjectKey)
				.catch(() => {})
		}

		return Result.ok({ avatarUrl: attachmentFilePath(id) })
	}

	/** Removes a user's custom avatar so their profile reverts to the monogram. */
	async deleteAvatar(
		principal: Principal,
		requestedUserId?: string,
	): Promise<ForumResult<AvatarActionResult>> {
		const actorId = principal.userId
		if (actorId === null) return Result.err({ code: 'unauthenticated', message: '请先登录' })
		const targetUserId = requestedUserId ?? actorId
		if (!isEntityId(targetUserId)) return Result.err({ code: 'not_found', message: '用户不存在' })
		if (!this.core.can(principal, 'user.edit', { userId: targetUserId })) {
			return Result.err({ code: 'forbidden', message: '没有权限执行此操作' })
		}

		const removed = await this.database.transaction(async (tx) => {
			const [existing] = await tx
				.select({
					attachmentId: userAvatars.attachmentId,
					objectKey: attachments.objectKey,
				})
				.from(userAvatars)
				.innerJoin(attachments, eq(attachments.id, userAvatars.attachmentId))
				.where(eq(userAvatars.userId, targetUserId))
			if (!existing) return undefined
			await tx.delete(userAvatars).where(eq(userAvatars.userId, targetUserId))
			await tx.delete(attachments).where(eq(attachments.id, existing.attachmentId))
			return existing.objectKey
		})

		if (removed) {
			await this.s3
				.bucket(this.config.bucketId)
				.client.deleteObject(removed)
				.catch(() => {})
		}
		return Result.ok({ avatarUrl: null })
	}

	/** Uploads a post attachment (image or allowed document) and returns its reference DTO. */
	async uploadAttachment(
		principal: Principal,
		input: Static<typeof UploadAttachmentInput>,
	): Promise<ForumResult<AttachmentItem>> {
		const uploaderId = principal.userId
		if (uploaderId === null) return Result.err({ code: 'unauthenticated', message: '请先登录' })

		const bytes = decodeBase64Payload(input.dataBase64)
		if (!bytes) return Result.err({ code: 'invalid', message: '文件内容无法解析' })
		const limits = this.limits()
		if (bytes.byteLength > limits.attachmentMaxBytes) {
			return Result.err({
				code: 'invalid',
				message: `附件大小不能超过 ${formatMebibytes(limits.attachmentMaxBytes)}`,
			})
		}

		const requestedType = input.contentType.trim().toLowerCase()
		const sniffedImage = sniffRasterImage(bytes)
		let contentType: string
		if (sniffedImage !== null) {
			contentType = sniffedImage
		} else if (RASTER_IMAGES.has(requestedType)) {
			return Result.err({ code: 'invalid', message: '图片文件内容与格式不符' })
		} else if (limits.documentTypes.includes(requestedType)) {
			if (
				(requestedType.startsWith('text/') || requestedType === 'application/json') &&
				bytes.includes(0)
			) {
				return Result.err({ code: 'invalid', message: '文本附件包含无效的二进制字符' })
			}
			contentType = requestedType
		} else {
			const allowed = [
				'PNG/JPEG/WebP/GIF',
				...this.config.documentTypes.map((type) => DOCUMENT_LABELS[type]),
			]
			return Result.err({
				code: 'invalid',
				message: `不支持的文件类型（支持 ${allowed.join('、')}）`,
			})
		}

		const id = randomUUID()
		const filename = sanitizeFilename(input.filename, `attachment-${id.slice(0, 8)}`)
		const objectKey = `attachments/${id}/${safeS3Segment(filename)}`
		const sha256 = createHash('sha256').update(bytes).digest('hex')

		await this.s3.bucket(this.config.bucketId).client.putAnyObject(objectKey, bytes, contentType)

		try {
			await this.database.transaction((tx) =>
				tx.insert(attachments).values({
					id,
					uploaderId,
					purpose: 'attachment',
					objectKey,
					filename,
					contentType,
					size: bytes.byteLength,
					sha256,
				}),
			)
		} catch (error) {
			await this.s3
				.bucket(this.config.bucketId)
				.client.deleteObject(objectKey)
				.catch(() => {})
			throw error
		}

		return Result.ok({
			id,
			url: attachmentFilePath(id),
			filename,
			contentType,
			size: bytes.byteLength,
			isImage: RASTER_IMAGES.has(contentType),
		})
	}

	/** Reads an attachment or avatar from S3 for `GET /api/forum/ext/forum-attachments/files/:id`. */
	async readFile(
		fileId: string,
		ifNoneMatch?: string | null,
	): Promise<ForumResult<ExtFileObject | 'not_modified'>> {
		if (!isEntityId(fileId)) return Result.err({ code: 'not_found', message: '文件不存在' })
		const [row] = await this.database.read((db) =>
			db.select().from(attachments).where(eq(attachments.id, fileId)),
		)
		if (!row) return Result.err({ code: 'not_found', message: '文件不存在' })

		const etag = `"${row.sha256}"`
		if (
			ifNoneMatch &&
			ifNoneMatch
				.split(',')
				.map((part) => part.trim())
				.includes(etag)
		) {
			return Result.ok('not_modified')
		}

		const data = await this.s3
			.bucket(this.config.bucketId)
			.client.getObjectArrayBuffer(row.objectKey)
		if (!data) return Result.err({ code: 'not_found', message: '文件不存在' })

		return Result.ok({
			body: data,
			contentType: row.contentType,
			size: row.size,
			filename: row.filename,
			etag,
			immutable: true,
		})
	}

	private async onPostAfterWrite(event: PostAfterWriteEvent): Promise<void> {
		if (
			event.kind === 'thread.created' ||
			event.kind === 'post.created' ||
			event.kind === 'post.updated'
		) {
			const ids = extractAttachmentIds(event.body)
			await this.syncPostAttachments(event.postId, ids)
			return
		}
		if (event.kind === 'post.deleted') {
			await this.database.transaction((tx) =>
				tx.delete(postAttachments).where(eq(postAttachments.postId, event.postId)),
			)
		}
	}

	private async syncPostAttachments(
		postId: string,
		attachmentIds: readonly string[],
	): Promise<void> {
		await this.database.transaction(async (tx) => {
			await tx.delete(postAttachments).where(eq(postAttachments.postId, postId))
			if (attachmentIds.length === 0) return
			const existing = await tx
				.select({ id: attachments.id })
				.from(attachments)
				.where(
					and(inArray(attachments.id, [...attachmentIds]), eq(attachments.purpose, 'attachment')),
				)
			const validIds = new Set(existing.map((row) => row.id))
			const ordered = attachmentIds.filter((id) => validIds.has(id))
			if (ordered.length === 0) return
			await tx.insert(postAttachments).values(
				ordered.map((attachmentId, position) => ({
					postId,
					attachmentId,
					position,
				})),
			)
		})
	}
}
