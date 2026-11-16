import { Paperclip } from 'lucide-react'
import { useRef, useState } from 'react'

import type { InsertAttachment } from '../slots'
import {
	ACCEPTED_FILES,
	ATTACHMENT_MAX_BYTES,
	attachmentOf,
	base64Of,
	callAction,
	contentTypeOf,
} from './shared'

/**
 * `composer.toolbar`: uploads files into the post, images shown in place and other files as links.
 * The forum keeps a file once the post that references it is saved; the reference ties them.
 */
export function UploadButton({ insert }: { insert: InsertAttachment }) {
	const input = useRef<HTMLInputElement>(null)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	async function upload(files: readonly File[]) {
		setError(null)
		setBusy(true)
		try {
			const tooLarge = files.find((file) => file.size > ATTACHMENT_MAX_BYTES)
			if (tooLarge !== undefined) setError(`“${tooLarge.name}”超过 5 MB。`)
			const results = await Promise.all(
				files
					.filter((file) => file.size <= ATTACHMENT_MAX_BYTES)
					.map(async (file) =>
						callAction('upload', {
							filename: file.name,
							contentType: contentTypeOf(file),
							dataBase64: await base64Of(file),
						}),
					),
			)
			// Links go in the order the files were picked.
			for (const result of results) {
				const item = result.ok ? attachmentOf(result.value) : null
				if (item === null) setError(result.ok ? '上传失败，请稍后再试。' : result.error)
				else insert({ kind: item.isImage ? 'image' : 'link', text: item.filename, href: item.url })
			}
		} catch {
			setError('读取文件失败。')
		} finally {
			setBusy(false)
		}
	}

	return (
		<span className="flex min-w-0 items-center gap-2">
			<input
				ref={input}
				type="file"
				multiple
				accept={ACCEPTED_FILES}
				hidden
				onChange={(event) => {
					const files = [...(event.currentTarget.files ?? [])]
					event.currentTarget.value = ''
					if (files.length > 0) void upload(files)
				}}
			/>
			<button
				type="button"
				className="button button--ghost button--sm text-ink-weak"
				disabled={busy}
				aria-busy={busy}
				onClick={() => input.current?.click()}
				title="图片、PDF、ZIP、文本，单个不超过 5 MB"
			>
				<Paperclip aria-hidden />
				{busy ? '上传中…' : '附件'}
			</button>
			{error !== null && (
				<span role="alert" className="text-danger truncate text-meta">
					{error}
				</span>
			)}
		</span>
	)
}
