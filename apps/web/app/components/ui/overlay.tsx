import { AlertDialog, Dropdown } from '@heroui/react'
import type { LucideIcon } from 'lucide-react'
import { Ellipsis } from 'lucide-react'
import { useRef } from 'react'
import { Form } from 'react-router'
import { Trans } from '@lingui/react/macro'

import { Button, type ButtonSize } from './button'
import { KeyboardScope } from './keyboard-scope'

export type MenuItem = Readonly<{
	id: string
	label: string
	icon?: LucideIcon
	danger?: boolean
	/** Shown greyed out, e.g. an action already taken ("已举报"). */
	disabled?: boolean
	onAction: () => void
}>

/**
 * An overflow menu ("…") of actions on one thing. Renders nothing when there are no actions.
 * Items are text only; `icon` shows on `danger` items alone.
 */
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
					disabledKeys={items.filter((item) => item.disabled === true).map((item) => item.id)}
					aria-label={label}
				>
					{items.map((item) => (
						<Dropdown.Item
							key={item.id}
							id={item.id}
							textValue={item.label}
							variant={item.danger ? 'danger' : 'default'}
							// The variant alone leaves the text in the menu's colour; a destructive item reads as one,
							// blended toward the strong ink so it stays legible on the dark themes' panels.
							className={
								item.danger
									? 'text-[color-mix(in_srgb,var(--c-danger)_55%,var(--c-text-strong))]'
									: undefined
							}
						>
							{/* Menus are text; only a destructive item keeps its icon as a warning. */}
							{item.danger === true && item.icon !== undefined && (
								<item.icon aria-hidden size={14} />
							)}
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
	body?: string
	confirmLabel: string
	fields: Readonly<Record<string, string>>
}) {
	const form = useRef<HTMLFormElement>(null)
	return (
		<AlertDialog isOpen={isOpen} onOpenChange={onOpenChange}>
			<AlertDialog.Backdrop isKeyboardDismissDisabled={false}>
				<AlertDialog.Container size="sm">
					<AlertDialog.Dialog>
						<KeyboardScope>
							<AlertDialog.Header>
								<AlertDialog.Heading className="text-ink-strong text-heading font-bold">
									{title}
								</AlertDialog.Heading>
							</AlertDialog.Header>
							{body !== undefined && (
								<AlertDialog.Body className="text-ink">{body}</AlertDialog.Body>
							)}
							<AlertDialog.Footer>
								<Form ref={form} method="post" className="flex justify-end gap-2">
									{Object.entries(fields).map(([name, value]) => (
										<input key={name} type="hidden" name={name} value={value} />
									))}
									<Button tone="ghost" onPress={() => onOpenChange(false)}>
										<Trans>取消</Trans>
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
						</KeyboardScope>
					</AlertDialog.Dialog>
				</AlertDialog.Container>
			</AlertDialog.Backdrop>
		</AlertDialog>
	)
}
