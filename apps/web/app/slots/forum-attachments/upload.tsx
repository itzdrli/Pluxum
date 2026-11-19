import { Paperclip } from 'lucide-react'
import { useRef, useState } from 'react'
import { useLingui } from '@lingui/react/macro'

import type { InsertAttachment } from '../slots'
import {
	acceptedFiles,
	acceptedLabel,
	attachmentOf,
	base64Of,
	callAction,
	contentTypeOf,
	formatSize,
	useUploadLimits,
} from './shared'

/**
 * `composer.toolbar`: uploads files into the post, images shown in place and other files as links.
 * The forum keeps a file once the post that references it is saved; the reference ties them.
 */
export function UploadButton({ insert }: { insert: InsertAttachment }) {
	const { t, i18n } = useLingui()
	const input = useRef<HTMLInputElement>(null)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const limits = useUploadLimits()
	const maxSize = formatSize(limits.attachmentMaxBytes)
	const accepted = acceptedLabel(i18n, limits)

	async function upload(files: readonly File[]) {
		setError(null)
		setBusy(true)
		try {
			const tooLarge = files.find((file) => file.size > limits.attachmentMaxBytes)
			const tooLargeName = tooLarge?.name ?? ''
			if (tooLarge !== undefined) setError(t`“${tooLargeName}”超过 ${maxSize}。`)
			const results = await Promise.all(
				files
					.filter((file) => file.size <= limits.attachmentMaxBytes)
					.map(async (file) =>
						callAction(i18n, 'upload', {
							filename: file.name,
							contentType: contentTypeOf(file),
							dataBase64: await base64Of(file),
						}),
					),
			)
			// Links go in the order the files were picked.
			for (const result of results) {
				const item = result.ok ? attachmentOf(result.value) : null
				if (item === null) setError(result.ok ? t`上传失败，请稍后再试。` : result.error)
				else insert({ kind: item.isImage ? 'image' : 'link', text: item.filename, href: item.url })
			}
		} catch {
			setError(t`读取文件失败。`)
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
				accept={acceptedFiles(limits)}
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
				title={t`${accepted}，单个不超过 ${maxSize}`}
			>
				<Paperclip aria-hidden />
				{busy ? t`上传中…` : t`附件`}
			</button>
			{error !== null && (
				<span role="alert" className="text-danger truncate text-meta">
					{error}
				</span>
			)}
		</span>
	)
}
