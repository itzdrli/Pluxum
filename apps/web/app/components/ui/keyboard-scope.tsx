import { HotkeysProvider } from '@tanstack/react-hotkeys'
import { useId, type ReactNode } from 'react'

/**
 * Gives an open dialog the keyboard: while it is mounted, the page's single-key shortcuts (J / K,
 * R, C…) sleep and only hotkeys registered inside it fire. Wrap a dialog's contents, which mount
 * only while it is open; each instance gets its own scope, so a dialog opened from another works.
 */
export function KeyboardScope({ children }: { children: ReactNode }) {
	return (
		<HotkeysProvider scope={`dialog-${useId()}`} exclusive>
			{children}
		</HotkeysProvider>
	)
}
