import { createHost } from '@pluxel/host'
import { pluginNodeAddressOf } from '@pluxel/core'
import { elysia, createElysiaHandler } from '@pluxel/services/elysia'
import { describe, expect, it } from 'vitest'
import { ForumApiPlugin } from '@forum/forum-api'

describe('ForumApiPlugin', () => {
	it('serves /api/forum/ping while running and withdraws it when stopped', async () => {
		const host = await createHost({ plugins: [ForumApiPlugin], services: [elysia()] })
		try {
			await host.startNode(pluginNodeAddressOf(ForumApiPlugin))
			const handler = createElysiaHandler(host)
			const ping = () => handler(new Request('http://test.local/api/forum/ping'))

			const ok = await ping()
			expect(ok.status).toBe(200)
			const body = await ok.json()
			expect(body).toMatchObject({ status: 'ok', service: 'forum-api' })
			expect(Number.isNaN(Date.parse(body.time))).toBe(false)

			await host.stopNode(pluginNodeAddressOf(ForumApiPlugin))
			expect((await ping()).status).toBe(404)
		} finally {
			await host.close()
		}
	})
})
