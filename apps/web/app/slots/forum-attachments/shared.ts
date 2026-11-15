import type { UserDto } from '@pluxum/domain'

export const EXT_ID = 'forum-attachments'

/** Mirrors the plugin's limits so oversized files are refused before they are read. */
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024

export type AttachmentItem = Readonly<{
	id: string
	url: string
	filename: string
	contentType: string
	size: number
	isImage: boolean
}>

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function itemOf(value: unknown): AttachmentItem | null {
	if (!isRecord(value)) return null
	const { id, url, filename, contentType, size, isImage } = value
	if (
		typeof id === 'string' &&
		typeof url === 'string' &&
		// Only the plugin's own file endpoint, never a link the data might smuggle in.
		url.startsWith(`/api/forum/ext/${EXT_ID}/files/`) &&
		typeof filename === 'string' &&
		typeof contentType === 'string' &&
		typeof size === 'number' &&
		typeof isImage === 'boolean'
	) {
		return { id, url, filename, contentType, size, isImage }
	}
	return null
}

/** The plugin's data on a post or an upload answer. It crosses the API untyped, so it is checked here. */
export function attachmentsOf(value: unknown): AttachmentItem[] {
	if (!isRecord(value) || !Array.isArray(value.items)) return []
	return value.items.map(itemOf).filter((item) => item !== null)
}

export function attachmentOf(value: unknown): AttachmentItem | null {
	return itemOf(value)
}

/** The custom avatar of a user while forum-attachments runs; undefined means the monogram. */
export function avatarUrlOf(user: UserDto): string | undefined {
	const data = user.ext?.[EXT_ID]
	if (!isRecord(data) || typeof data.avatarUrl !== 'string') return undefined
	return data.avatarUrl.startsWith(`/api/forum/ext/${EXT_ID}/files/`) ? data.avatarUrl : undefined
}

export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** A Blob as base64 without the `data:` prefix. */
export function base64Of(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.addEventListener('load', () => {
			const result = typeof reader.result === 'string' ? reader.result : ''
			resolve(result.slice(result.indexOf(',') + 1))
		})
		reader.addEventListener('error', () => reject(reader.error ?? new Error('读取文件失败')))
		reader.readAsDataURL(blob)
	})
}

export type CallResult =
	| Readonly<{ ok: true; value: unknown }>
	| Readonly<{ ok: false; error: string }>

/**
 * Calls one of the plugin's actions straight through the same-origin API forwarder. Uploads use
 * this instead of a route action: the answer (the new file's link) is needed right here.
 */
export async function callAction(action: string, input: unknown): Promise<CallResult> {
	let response: Response
	try {
		response = await fetch(`/api/forum/ext/${EXT_ID}/${action}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json' },
			body: JSON.stringify(input),
		})
	} catch {
		return { ok: false, error: '网络错误，请稍后再试。' }
	}
	const body: unknown = await response.json().catch(() => null)
	if (response.ok) return { ok: true, value: body }
	const error = isRecord(body) && isRecord(body.error) ? body.error.message : undefined
	return {
		ok: false,
		error:
			typeof error === 'string'
				? error
				: response.status === 413
					? '文件太大了。'
					: '操作失败，请稍后再试。',
	}
}

const TYPES_BY_EXTENSION: Readonly<Record<string, string>> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
	gif: 'image/gif',
	pdf: 'application/pdf',
	zip: 'application/zip',
	json: 'application/json',
	txt: 'text/plain',
	md: 'text/markdown',
	markdown: 'text/markdown',
	csv: 'text/csv',
}

/** Browsers often report no type (or a vendor one) for .md and .csv; the extension decides then. */
export function contentTypeOf(file: File): string {
	const extension = file.name.split('.').at(-1)?.toLowerCase() ?? ''
	return TYPES_BY_EXTENSION[extension] ?? (file.type || 'application/octet-stream')
}

export const ACCEPTED_FILES = Object.keys(TYPES_BY_EXTENSION)
	.map((extension) => `.${extension}`)
	.join(',')
