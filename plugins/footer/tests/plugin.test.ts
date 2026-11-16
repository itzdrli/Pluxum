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

		// A saved change replaces what the footer shows right away.
		const saved = await host.config.patch(ForumFooterPlugin, {
			groups: [],
			icons: [],
			notes: ['新的附注'],
		})
		expect(saved).toMatchObject({ ok: true, saved: true, application: 'applied' })
		expect(core.footer().groups).toEqual([])
		expect(core.footer().notes).toEqual(['新的附注'])
		expect(core.footer().siteLinks).toBe(false)

		// The site links column is an option of its own.
		await host.config.patch(ForumFooterPlugin, { siteLinks: true, notes: [] })
		expect(core.footer().siteLinks).toBe(true)
		await host.config.patch(ForumFooterPlugin, { siteLinks: false })

		await host.stop(ForumFooterPlugin)
		expect(core.footer().groups).toEqual([])
		expect(core.footer().notes).toEqual([])
	})
})
