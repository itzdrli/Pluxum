import { Modal } from '@heroui/react'
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import { IconButton } from './button'

export type LightboxImage = Readonly<{ src: string; alt: string }>

type Open = (images: readonly LightboxImage[], index: number) => void

const LightboxContext = createContext<Open | null>(null)

/**
 * Opens images in a viewer over the page instead of leaving it. Without the provider (or before
 * hydration) callers get null and the plain link to the file still works.
 */
export function useLightbox(): Open | null {
	return useContext(LightboxContext)
}

/**
 * The images a click inside `container` should open: every forum image in the post bodies and
 * attachment strips within it, in page order, starting at the clicked one. Null when the click
 * was not a plain left click on such an image (a middle or modified click keeps the browser's
 * own behaviour, a new tab).
 */
export function imagesForClick(
	event: React.MouseEvent<HTMLElement>,
	container: HTMLElement,
): { images: LightboxImage[]; index: number } | null {
	if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
		return null
	}
	const target = event.target
	if (!(target instanceof HTMLImageElement) || !target.matches(VIEWABLE)) return null
	const all = [...container.querySelectorAll<HTMLImageElement>(VIEWABLE)]
	return {
		images: all.map((image) => ({ src: image.currentSrc || image.src, alt: image.alt })),
		index: Math.max(0, all.indexOf(target)),
	}
}

/** Images a post shows that the viewer opens: in rendered bodies (not the editor) and attachment strips. */
const VIEWABLE = '.post-body:not(.composer-editor) img, [data-lightbox] img'

export function LightboxProvider({ children }: { children: React.ReactNode }) {
	const [state, setState] = useState<{ images: readonly LightboxImage[]; index: number } | null>(
		null,
	)
	const open = useCallback<Open>((images, index) => {
		if (images.length > 0) setState({ images, index })
	}, [])
	const value = useMemo(() => open, [open])
	return (
		<LightboxContext.Provider value={value}>
			{children}
			<Viewer state={state} onChange={setState} />
		</LightboxContext.Provider>
	)
}

function Viewer({
	state,
	onChange,
}: {
	state: { images: readonly LightboxImage[]; index: number } | null
	onChange: (next: { images: readonly LightboxImage[]; index: number } | null) => void
}) {
	const count = state?.images.length ?? 0
	const current = state?.images[state.index]
	const step = useCallback(
		(by: number) => {
			if (state !== null && count > 1) {
				onChange({ ...state, index: (state.index + by + count) % count })
			}
		},
		[state, count, onChange],
	)
	// Arrow keys page through the images while the viewer is open.
	useEffect(() => {
		if (state === null) return undefined
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'ArrowLeft') step(-1)
			if (event.key === 'ArrowRight') step(1)
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [state, step])
	// A horizontal swipe pages too (phones have no side buttons over the picture). The click that
	// ends a swipe must not count as a click beside the picture, which closes the viewer.
	const swipe = useRef<{ x: number; y: number } | null>(null)
	const swiped = useRef(false)
	return (
		<Modal isOpen={state !== null} onOpenChange={(open) => !open && onChange(null)}>
			<Modal.Backdrop variant="blur" className="lightbox-backdrop">
				<Modal.Container size="full" className="lightbox">
					<Modal.Dialog aria-label={current?.alt || '图片'} className="lightbox-dialog">
						<div className="flex items-center gap-2 px-3 py-2">
							<p className="min-w-0 flex-1 truncate text-ui text-white/85">
								{current?.alt}
								{count > 1 && state !== null && (
									<span className="ml-2 text-white/60 tabular-nums">
										{state.index + 1} / {count}
									</span>
								)}
							</p>
							{current !== undefined && (
								<a
									href={current.src}
									download
									className="button button--ghost button--icon-only button--sm lightbox-control"
									aria-label="下载原图"
								>
									<Download aria-hidden />
								</a>
							)}
							<IconButton
								label="关闭"
								size="sm"
								className="lightbox-control"
								onPress={() => onChange(null)}
							>
								<X aria-hidden />
							</IconButton>
						</div>
						<div
							className="relative flex min-h-0 flex-1 touch-pan-y items-center justify-center px-2 pb-4 sm:px-14"
							onPointerDown={(event) => {
								swipe.current = { x: event.clientX, y: event.clientY }
								swiped.current = false
							}}
							onPointerUp={(event) => {
								const start = swipe.current
								swipe.current = null
								if (start === null || count < 2) return
								const dx = event.clientX - start.x
								const dy = event.clientY - start.y
								if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) {
									swiped.current = true
									step(dx < 0 ? 1 : -1)
								}
							}}
							// A click beside the picture closes, as on the backdrop.
							onClick={(event) => {
								if (swiped.current) {
									swiped.current = false
									return
								}
								if (event.target === event.currentTarget) onChange(null)
							}}
						>
							{current !== undefined && (
								<img
									key={current.src}
									src={current.src}
									alt={current.alt}
									className="max-h-full max-w-full rounded-[2px] object-contain select-none"
								/>
							)}
							{/* Wide screens: beside the picture, in the side margins it leaves free. */}
							{count > 1 && (
								<>
									<IconButton
										label="上一张"
										className="lightbox-control lightbox-nav left-2 max-sm:hidden"
										onPress={() => step(-1)}
									>
										<ChevronLeft aria-hidden />
									</IconButton>
									<IconButton
										label="下一张"
										className="lightbox-control lightbox-nav right-2 max-sm:hidden"
										onPress={() => step(1)}
									>
										<ChevronRight aria-hidden />
									</IconButton>
								</>
							)}
						</div>
						{/* Phones: a picture fills the width, so the buttons go below it instead of over it. */}
						{count > 1 && state !== null && (
							<div className="flex items-center justify-center gap-6 px-3 pt-1 pb-[max(12px,env(safe-area-inset-bottom))] sm:hidden">
								<IconButton label="上一张" className="lightbox-control" onPress={() => step(-1)}>
									<ChevronLeft aria-hidden />
								</IconButton>
								<span className="min-w-12 text-center text-ui text-white/70 tabular-nums">
									{state.index + 1} / {count}
								</span>
								<IconButton label="下一张" className="lightbox-control" onPress={() => step(1)}>
									<ChevronRight aria-hidden />
								</IconButton>
							</div>
						)}
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	)
}
