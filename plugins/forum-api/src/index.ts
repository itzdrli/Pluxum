import { BasePlugin, Plugin } from '@pluxel/core'
import { t } from 'elysia'
import { ElysiaApp } from '@pluxel/services/elysia'

/** Public prefix for every forum HTTP route; the Nuxt frontend proxies this path. */
export const FORUM_API_PREFIX = '/api/forum'

const pingResponse = t.Object({
	status: t.Literal('ok'),
	service: t.Literal('forum-api'),
	time: t.String(),
})

/**
 * Fixed HTTP ingress for the forum. Domain plugins never mount routes themselves;
 * dynamic extensions will contribute handlers through registries owned here (M3).
 */
@Plugin({ displayName: 'Forum API' })
export class ForumApiPlugin extends BasePlugin {
	protected override init(): void {
		this.ctx.require(ElysiaApp).group(FORUM_API_PREFIX, (app) =>
			app.get('/ping', { response: pingResponse }, () => ({
				status: 'ok' as const,
				service: 'forum-api' as const,
				time: new Date().toISOString(),
			})),
		)
	}
}
