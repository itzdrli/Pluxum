import { ForumCorePlugin } from '@pluxum/core'
import { BasePlugin, Plugin } from '@pluxel/core'
import { renderMarkdown } from './render'

export { renderMarkdown } from './render'

export const MARKDOWN_RENDERER_ID = 'forum-markdown.marked'

/**
 * Renders posts as Markdown by contributing the forum's content renderer. Stopping this plugin
 * turns every post back into plain text; nothing is stored, so starting it again restores them.
 */
@Plugin({ displayName: 'Forum Markdown' })
export class ForumMarkdownPlugin extends BasePlugin {
	constructor(private readonly core: ForumCorePlugin) {
		super()
	}

	protected override init(): void {
		this.ctx.effects.defer(
			this.core.registerContentRenderer({
				id: MARKDOWN_RENDERER_ID,
				format: 'markdown',
				render: renderMarkdown,
			}),
		)
	}
}
