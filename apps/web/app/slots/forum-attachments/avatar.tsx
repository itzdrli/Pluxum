import type { UserProfileDto } from '@pluxum/domain'
import { ImageUp } from 'lucide-react'
import { useRef, useState } from 'react'
import { useRevalidator } from 'react-router'

import { Button } from '../../components/ui/button'
import { Panel, SectionLabel } from '../../components/ui/display'
import { AVATAR_MAX_BYTES, avatarUrlOf, base64Of, callAction } from './shared'

const AVATAR_PIXELS = 256

/**
 * The image cut to a centred square of AVATAR_PIXELS, as WebP where the browser can encode it
 * (PNG otherwise). Avatars show small, so this keeps uploads light; an animated GIF keeps only
 * its first frame.
 */
async function squareAvatar(file: File): Promise<Blob> {
	const bitmap = await createImageBitmap(file)
	try {
		const side = Math.min(bitmap.width, bitmap.height)
		const target = Math.min(AVATAR_PIXELS, side)
		const canvas = document.createElement('canvas')
		canvas.width = target
		canvas.height = target
		const context = canvas.getContext('2d')
		if (context === null) throw new Error('canvas unavailable')
		context.imageSmoothingQuality = 'high'
		context.drawImage(
			bitmap,
			(bitmap.width - side) / 2,
			(bitmap.height - side) / 2,
			side,
			side,
			0,
			0,
			target,
			target,
		)
		const blob = await new Promise<Blob | null>((resolve) => {
			canvas.toBlob(resolve, 'image/webp', 0.9)
		})
		if (blob === null) throw new Error('encode failed')
		return blob
	} finally {
		bitmap.close()
	}
}

/** `user.profile.tabs`: changing or removing the avatar, for whoever may edit the profile. */
export function AvatarEditor({ profile }: { profile: UserProfileDto }) {
	const input = useRef<HTMLInputElement>(null)
	const revalidator = useRevalidator()
	const [busy, setBusy] = useState<'upload' | 'remove' | null>(null)
	const [error, setError] = useState<string | null>(null)
	if (!profile.can.edit) return null
	const hasAvatar = avatarUrlOf(profile.user) !== undefined
	const userId = profile.user.id

	async function run(kind: 'upload' | 'remove', work: () => Promise<string | null>) {
		setError(null)
		setBusy(kind)
		try {
			const failure = await work()
			if (failure === null) await revalidator.revalidate()
			else setError(failure)
		} catch {
			setError(kind === 'upload' ? '这张图片无法读取。' : '操作失败，请稍后再试。')
		} finally {
			setBusy(null)
		}
	}

	function upload(file: File) {
		void run('upload', async () => {
			if (!file.type.startsWith('image/')) return '请选择图片文件。'
			const image = await squareAvatar(file)
			if (image.size > AVATAR_MAX_BYTES) return '图片太大了。'
			const result = await callAction('upload-avatar', {
				userId,
				filename: `avatar.${image.type === 'image/webp' ? 'webp' : 'png'}`,
				contentType: image.type,
				dataBase64: await base64Of(image),
			})
			return result.ok ? null : result.error
		})
	}

	function remove() {
		void run('remove', async () => {
			const result = await callAction('delete-avatar', { userId })
			return result.ok ? null : result.error
		})
	}

	return (
		<section aria-labelledby="avatar-heading">
			<SectionLabel>
				<span id="avatar-heading">头像</span>
			</SectionLabel>
			<Panel className="flex flex-wrap items-center gap-3 px-4 py-3">
				<p className="text-ink-weak min-w-0 flex-1 basis-48 text-meta">
					PNG、JPEG、WebP 或 GIF，会裁成正方形。没有头像时显示昵称首字。
				</p>
				<input
					ref={input}
					type="file"
					accept="image/png,image/jpeg,image/webp,image/gif"
					hidden
					onChange={(event) => {
						const file = event.currentTarget.files?.[0]
						event.currentTarget.value = ''
						if (file !== undefined) upload(file)
					}}
				/>
				<div className="flex items-center gap-2">
					{hasAvatar && (
						<Button
							tone="ghost"
							size="sm"
							isPending={busy === 'remove'}
							isDisabled={busy !== null}
							onPress={remove}
						>
							移除
						</Button>
					)}
					<Button
						size="sm"
						isPending={busy === 'upload'}
						isDisabled={busy !== null}
						onPress={() => input.current?.click()}
					>
						<ImageUp aria-hidden />
						{hasAvatar ? '更换头像' : '上传头像'}
					</Button>
				</div>
				{error !== null && (
					<p role="alert" className="text-danger w-full text-meta">
						{error}
					</p>
				)}
			</Panel>
		</section>
	)
}
