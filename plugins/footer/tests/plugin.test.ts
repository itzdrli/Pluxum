import { ForumCorePlugin } from '@pluxum/core'
import { createTestHost } from '@pluxel/test'
import { database } from '@pluxel/services/database'
import { pglite } from '@pluxel/services/database/pglite'
import { describe, expect, it } from 'vitest'
import { ForumFooterPlugin } from '../src'

describe('forum footer plugin', () => {
	it('puts its configured links and notes in the core footer, and withdraws them when stopped', async () => {
		const host = await createTestHost({
			services: [database({ backend: pglite({ dataDir: 'memory://' }) })],
		})
		await host.commit((change) => {
			change.start(ForumCorePlugin)
			change.start(ForumFooterPlugin, {
				initialConfig: {
					groups: [{ title: '社区', links: [{ label: '版规', href: '/t/rules' }] }],
					icons: [{ icon: 'mail', label: '联系', href: 'https://example.com/contact' }],
					notes: ['© 2026 Pluxum'],
				},
			})
		})
		const core = host.require(ForumCorePlugin)
		const footer = core.footer()
		expect(footer.groups).toEqual([{ title: '社区', links: [{ label: '版规', href: '/t/rules' }] }])
		expect(footer.icons.map((icon) => icon.href)).toContain('https://example.com/contact')
		expect(footer.notes).toEqual(['© 2026 Pluxum'])

		await host.stop(ForumFooterPlugin)
		expect(core.footer().groups).toEqual([])
		expect(core.footer().notes).toEqual([])
	})
})
