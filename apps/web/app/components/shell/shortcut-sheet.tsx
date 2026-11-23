import { Modal } from '@heroui/react'
import type { MetaDto } from '@pluxum/domain'
import { useAppHotkeys, useFormatForDisplay, useHotkey } from '@tanstack/react-hotkeys'
import type { Hotkey, HotkeyChord } from '@tanstack/react-hotkeys'
import { useSyncExternalStore } from 'react'
import { useRouteLoaderData } from 'react-router'
import { Trans, useLingui } from '@lingui/react/macro'

import {
	appHotkeys,
	HOTKEY_GROUPS,
	HOTKEY_IDS,
	HOTKEY_TEXT,
	type HotkeyId,
} from '../../lib/hotkeys'
import type { loader as rootLoader } from '../../root'
import { KeyboardScope } from '../ui/keyboard-scope'

// Open or shut, shared by the `?` key and the palette's 「快捷键」 command.
let sheetOpen = false
const listeners = new Set<() => void>()
function setSheetOpen(open: boolean) {
	sheetOpen = open
	for (const listener of listeners) listener()
}
function subscribe(listener: () => void) {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

export function openShortcutSheet() {
	setSheetOpen(true)
}

/** The extension each plugin shortcut needs; without it running the shortcut is left out. */
const NEEDS_EXTENSION: Partial<Record<HotkeyId, string>> = {
	'post.like': 'forum-reactions',
	'post.accept': 'forum-solved',
	'thread.markRead': 'forum-reads',
	'go.notifications': 'forum-notifications',
	'go.messages': 'forum-messages',
}
const NEEDS_SIGN_IN = new Set<HotkeyId>([
	'thread.new',
	'thread.reply',
	'post.like',
	'post.accept',
	'thread.markRead',
	'go.notifications',
	'go.messages',
])

/** The shortcuts this visitor can use here: plugins that run, sign-in where it matters. */
export function availableHotkeys(meta: MetaDto | null | undefined): HotkeyId[] {
	const running = new Set((meta?.uiSlots ?? []).map((slot) => slot.extId))
	const signedIn = meta?.viewer.user != null
	return HOTKEY_IDS.filter((id) => {
		const extension = NEEDS_EXTENSION[id]
		if (extension !== undefined && !running.has(extension)) return false
		return signedIn || !NEEDS_SIGN_IN.has(id)
	})
}

/** A shortcut as key caps: `⌘ K`, `G` `H`. */
export function HotkeyKeys({
	hotkey,
	className = '',
}: {
	hotkey: Hotkey | null
	className?: string
}) {
	const format = useFormatForDisplay()
	if (hotkey === null) return null
	const steps: readonly HotkeyChord[] = typeof hotkey === 'string' ? [hotkey] : hotkey
	const parts = steps.flatMap((step) => format(step, { parts: true }))
	return (
		<span className={`inline-flex shrink-0 items-center gap-1 ${className}`}>
			{parts.map((part, index) => (
				<kbd
					// oxlint-disable-next-line react/no-array-index-key -- key caps have no identity but their order.
					key={index}
					className="border-line text-ink-weak inline-flex h-5 min-w-5 items-center justify-center rounded-[2px] border px-1 font-mono text-micro"
				>
					{part}
				</kbd>
			))}
		</span>
	)
}

/** The `?` sheet: every shortcut the visitor can use, by group. */
export function ShortcutSheet() {
	const open = useSyncExternalStore(
		subscribe,
		() => sheetOpen,
		() => false,
	)
	useHotkey(appHotkeys['help.open'], () => setSheetOpen(true))
	if (!open) return null
	return <SheetDialog onClose={() => setSheetOpen(false)} />
}

function SheetDialog({ onClose }: { onClose: () => void }) {
	const { i18n } = useLingui()
	const meta = useRouteLoaderData<typeof rootLoader>('root')?.meta
	const effective = useAppHotkeys()
	const ids = availableHotkeys(meta)
	return (
		<Modal isOpen onOpenChange={(next) => !next && onClose()}>
			<Modal.Backdrop isKeyboardDismissDisabled={false}>
				<Modal.Container size="md">
					<Modal.Dialog>
						<KeyboardScope>
							<CloseWithSameKey onClose={onClose} />
							<Modal.Header>
								<Modal.Heading className="text-ink-strong text-heading font-bold">
									<Trans>快捷键</Trans>
								</Modal.Heading>
							</Modal.Header>
							<Modal.Body className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
								{HOTKEY_GROUPS.map((group) => {
									const items = ids.filter((id) => HOTKEY_TEXT[id].group === group.id)
									if (items.length === 0) return null
									return (
										<section key={group.id} className="flex flex-col gap-1">
											<h3 className="section-label pb-1">{i18n._(group.label)}</h3>
											{items.map((id) => (
												<p key={id} className="text-ink flex items-center justify-between gap-3">
													<span>{i18n._(HOTKEY_TEXT[id].label)}</span>
													<HotkeyKeys hotkey={effective[id].hotkey} />
												</p>
											))}
										</section>
									)
								})}
							</Modal.Body>
						</KeyboardScope>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	)
}

/** `?` again closes the sheet (the page's `?` sleeps while the sheet owns the keyboard). */
function CloseWithSameKey({ onClose }: { onClose: () => void }) {
	useHotkey(appHotkeys['help.open'], onClose)
	return null
}
