import { ForumCorePlugin } from '@pluxum/core'
import { database } from '@pluxel/services/database'
import { pglite } from '@pluxel/services/database/pglite'
import { createTestHost } from '@pluxel/test'
import { describe, expect, it } from 'vitest'
import { ForumOutlinePlugin, OUTLINE_EXT_ID } from '../src'

describe('forum outline plugin', () => {
	it('fills the thread sidebar while it runs and leaves with it', async () => {
		await using host = await createTestHost({
			services: [database({ backend: pglite({ dataDir: 'memory://' }) })],
		})
		await host.commit((change) => {
			change.start(ForumCorePlugin)
			change.start(ForumOutlinePlugin)
		})
		const core = host.require(ForumCorePlugin)
		expect(core.uiSlots()).toEqual([{ slot: 'thread.sidebar', extId: OUTLINE_EXT_ID }])
		await host.stop(ForumOutlinePlugin)
		expect(core.uiSlots()).toEqual([])
	})
})
