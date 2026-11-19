// The Lingui Vite plugin compiles a .po file on import and exposes its catalog as `messages`.
declare module '*.po' {
	import type { Messages } from '@lingui/core'

	export const messages: Messages
}
