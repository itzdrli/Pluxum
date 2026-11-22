import { ForumCorePlugin } from '@pluxum/core'
import { BasePlugin, Plugin } from '@pluxel/core'

/** The extension's ID: the key the frontend looks its component up under. */
export const OUTLINE_EXT_ID = 'forum-outline'

/**
 * A floor timeline beside threads, as an extension of the forum: it only fills the `thread.sidebar`
 * slot, and the frontend component lists the floors on screen along a vertical line, lights the
 * one being read and jumps to the one clicked. A thread with a single floor shows nothing and the
 * column folds away. Stopping the plugin removes the timeline; nothing is stored.
 */
@Plugin({ displayName: 'Pluxum Outline' })
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
