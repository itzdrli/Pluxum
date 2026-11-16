import type { PostDto } from '@pluxum/domain'
import { Download, FileText } from 'lucide-react'

import { attachmentsOf, EXT_ID, formatSize } from './shared'

/**
 * `post.footer`: previews of linked images the text does not show itself (older posts linked them),
 * and download cards for other files. A click on a preview opens the post's image viewer.
 */
export function AttachmentsFooter({ post }: { post: PostDto }) {
	const items = attachmentsOf(post.ext[EXT_ID])
	if (post.deleted || items.length === 0) return null
	// Images the text already shows in place are not repeated here.
	const images = items.filter(
		(item) => item.isImage && !post.bodyHtml.includes(`src="${item.url}"`),
	)
	const files = items.filter((item) => !item.isImage)
	if (images.length === 0 && files.length === 0) return null
	return (
		<div className="flex flex-col gap-2 px-4 pb-3" data-testid="post-attachments" data-lightbox>
			{images.length > 0 && (
				<ul className="flex flex-wrap gap-2" aria-label="图片">
					{images.map((image) => (
						<li key={image.id}>
							<a
								href={image.url}
								target="_blank"
								rel="noopener"
								className="border-line bg-control block overflow-hidden rounded-[2px] border"
								title={image.filename}
							>
								<img
									src={image.url}
									alt={image.filename}
									loading="lazy"
									decoding="async"
									className="block max-h-60 w-auto max-w-full object-contain sm:max-w-80"
								/>
							</a>
						</li>
					))}
				</ul>
			)}
			{files.length > 0 && (
				<ul className="flex flex-col gap-1.5 sm:max-w-md" aria-label="附件">
					{files.map((file) => (
						<li key={file.id}>
							<a
								href={file.url}
								download={file.filename}
								className="border-line bg-control hover:bg-hover active:bg-pressed flex min-w-0 items-center gap-2.5 rounded-[2px] border px-3 py-2"
							>
								<FileText aria-hidden size={16} className="text-ink-weak shrink-0" />
								<span className="text-ink-strong min-w-0 flex-1 truncate">{file.filename}</span>
								<span className="text-ink-weak shrink-0 text-meta tabular-nums">
									{formatSize(file.size)}
								</span>
								<Download aria-hidden size={14} className="text-ink-weak shrink-0" />
							</a>
						</li>
					))}
				</ul>
			)}
		</div>
	)
}
