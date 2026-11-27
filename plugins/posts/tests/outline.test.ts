import { ForumCorePlugin } from '@pluxum/core'
import { pglite } from '@pluxel/services/pg/pglite'
import { createTestHost } from '@pluxel/test'
import { describe, expect, it } from 'vitest'
import { ForumOutlinePlugin, OUTLINE_EXT_ID } from '../src'

describe('forum outline plugin', () => {
	it('fills the thread sidebar while it runs and leaves with it', async () => {
		await using host = await createTestHost({
			services: [pglite({ dataDir: 'memory://' })],
		})
		await host.commit((change) => {
			change.start(ForumCorePlugin.nodeAddress())
			change.start(ForumOutlinePlugin.nodeAddress())
		})
		const core = host.require(ForumCorePlugin.nodeAddress())
		expect(core.uiSlots()).toEqual([{ slot: 'thread.sidebar', extId: OUTLINE_EXT_ID }])
		await host.stop(ForumOutlinePlugin.nodeAddress())
		expect(core.uiSlots()).toEqual([])
	})
})
