import { ForumCorePlugin } from '@pluxum/core'
import { BasePlugin, Plugin } from '@pluxel/core'

/** The extension's ID: the key the frontend looks its component up under. */
export const OUTLINE_EXT_ID = 'forum-outline'

/**
 * A table of contents beside long threads, as an extension of the forum: it only fills the
 * `thread.sidebar` slot, and the frontend component builds the outline from the headings of the
 * posts on screen. Short threads without headings show nothing and the column folds away. Stopping
 * the plugin removes the outline; nothing is stored.
 */
@Plugin({ displayName: 'Forum Outline' })
export class ForumOutlinePlugin extends BasePlugin {
	constructor(private readonly core: ForumCorePlugin) {
		super()
	}

	protected override init(): void {
		this.ctx.effects.defer(
			this.core.registerUiSlots({ id: OUTLINE_EXT_ID, slots: ['thread.sidebar'] }),
		)
	}
}
