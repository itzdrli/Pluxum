import { AlertDialog, Dropdown } from '@heroui/react'
import type { LucideIcon } from 'lucide-react'
import { Ellipsis } from 'lucide-react'
import { useRef } from 'react'
import { Form } from 'react-router'

import { Button, type ButtonSize } from './button'

export type MenuItem = Readonly<{
	id: string
	label: string
	icon?: LucideIcon
	danger?: boolean
	onAction: () => void
}>

/** An overflow menu ("…") of actions on one thing. Renders nothing when there are no actions. */
export function ActionMenu({
	label,
	items,
	size = 'sm',
}: {
	label: string
	items: readonly MenuItem[]
	size?: ButtonSize
}) {
	if (items.length === 0) return null
	return (
		<Dropdown>
			<Dropdown.Trigger
				aria-label={label}
				className={`button button--ghost button--icon-only button--${size} hover-reveal`}
			>
				<Ellipsis aria-hidden />
			</Dropdown.Trigger>
			<Dropdown.Popover placement="bottom end" className="min-w-36">
				<Dropdown.Menu
					onAction={(key) => items.find((item) => item.id === key)?.onAction()}
					aria-label={label}
				>
					{items.map((item) => (
						<Dropdown.Item
							key={item.id}
							id={item.id}
							textValue={item.label}
							variant={item.danger ? 'danger' : 'default'}
						>
							{item.icon !== undefined && <item.icon aria-hidden size={14} />}
							{item.label}
						</Dropdown.Item>
					))}
				</Dropdown.Menu>
			</Dropdown.Popover>
		</Dropdown>
	)
}

/**
 * Asks before a destructive action, then posts `fields` to the current route's action. Controlled:
 * the caller opens it (usually from an ActionMenu item).
 */
export function ConfirmDialog({
	isOpen,
	onOpenChange,
	title,
	body,
	confirmLabel,
	fields,
}: {
	isOpen: boolean
	onOpenChange: (open: boolean) => void
	title: string
	body: string
	confirmLabel: string
	fields: Readonly<Record<string, string>>
}) {
	const form = useRef<HTMLFormElement>(null)
	return (
		<AlertDialog isOpen={isOpen} onOpenChange={onOpenChange}>
			<AlertDialog.Backdrop isKeyboardDismissDisabled={false}>
				<AlertDialog.Container size="sm">
					<AlertDialog.Dialog>
						<AlertDialog.Header>
							<AlertDialog.Heading className="text-ink-strong text-[15px] font-bold">
								{title}
							</AlertDialog.Heading>
						</AlertDialog.Header>
						<AlertDialog.Body className="text-ink">{body}</AlertDialog.Body>
						<AlertDialog.Footer>
							<Form ref={form} method="post" className="flex justify-end gap-2">
								{Object.entries(fields).map(([name, value]) => (
									<input key={name} type="hidden" name={name} value={value} />
								))}
								<Button tone="ghost" onPress={() => onOpenChange(false)}>
									取消
								</Button>
								{/* The submit event fires synchronously, so the dialog may close right after. */}
								<Button
									tone="danger"
									onPress={() => {
										form.current?.requestSubmit()
										onOpenChange(false)
									}}
								>
									{confirmLabel}
								</Button>
							</Form>
						</AlertDialog.Footer>
					</AlertDialog.Dialog>
				</AlertDialog.Container>
			</AlertDialog.Backdrop>
		</AlertDialog>
	)
}
