import { X } from 'lucide-react'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { useLingui } from '@lingui/react/macro'

import { IconButton } from './button'

/**
 * Accessible mobile bottom sheet built on React Aria's `ModalOverlay` and `Modal`.
 * Uses `dvh` so virtual keyboards never push the header or action controls offscreen.
 */
export function BottomSheet({
	isOpen,
	onOpenChange,
	title,
	isDismissable = true,
	bodyClassName,
	children,
}: {
	isOpen: boolean
	onOpenChange: (open: boolean) => void
	title: string
	isDismissable?: boolean
	bodyClassName?: string
	children: React.ReactNode | ((close: () => void) => React.ReactNode)
}) {
	const { t } = useLingui()
	return (
		<ModalOverlay
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			isDismissable={isDismissable}
			className="bottom-sheet-overlay bg-scrim fixed inset-0 z-40 flex flex-col justify-end"
		>
			<Modal className="bottom-sheet-modal w-full outline-none">
				<Dialog className="border-line bg-panel shadow-overlay flex max-h-[85dvh] w-full flex-col rounded-t-[2px] border-t pb-[env(safe-area-inset-bottom)] outline-none">
					{({ close }) => (
						<>
							<div aria-hidden className="bg-line mx-auto mt-2 h-1 w-9 shrink-0 rounded-[2px]" />
							<div className="border-line flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2.5">
								<Heading
									slot="title"
									className="text-ink-strong min-w-0 truncate text-heading font-bold"
								>
									{title}
								</Heading>
								<IconButton label={t`关闭`} tone="ghost" size="sm" onPress={close}>
									<X aria-hidden />
								</IconButton>
							</div>
							<div className={bodyClassName ?? 'min-h-0 flex-1 overflow-y-auto px-4 py-3'}>
								{typeof children === 'function' ? children(close) : children}
							</div>
						</>
					)}
				</Dialog>
			</Modal>
		</ModalOverlay>
	)
}
