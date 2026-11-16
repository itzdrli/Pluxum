import { GUEST, type Principal } from '@pluxum/domain'
import { describe, expect, it } from 'vitest'

import { PaletteCommandRegistry } from '../src/palette'

const member: Principal = { userId: 'u1', roles: ['guest', 'member'] }
const moderator: Principal = { userId: 'u2', roles: ['guest', 'member', 'moderator'] }

const one = (patch: Record<string, unknown>) => ({
	id: 'x',
	commands: [{ id: 'c', label: 'L', href: '/a', ...patch }],
})

describe('palette command registry', () => {
	it('lists commands by the viewer role and withdraws them with their contributor', () => {
		const registry = new PaletteCommandRegistry()
		registry.register({
			id: 'forum-search',
			commands: [{ id: 'page', label: '搜索', keywords: ['查找'], href: '/search' }],
		})
		const disposeQueue = registry.register({
			id: 'forum-moderation',
			commands: [
				{
					id: 'queue',
					label: '审核队列',
					href: '/moderation',
					minRole: 'moderator',
					group: '管理',
				},
			],
		})
		expect(registry.list(GUEST).map((command) => command.id)).toEqual(['forum-search.page'])
		expect(registry.list(member).map((command) => command.id)).toEqual(['forum-search.page'])
		expect(registry.list(moderator)).toEqual([
			{
				id: 'forum-search.page',
				label: '搜索',
				group: '前往',
				keywords: ['查找'],
				href: '/search',
				external: false,
			},
			{
				id: 'forum-moderation.queue',
				label: '审核队列',
				group: '管理',
				keywords: [],
				href: '/moderation',
				external: false,
			},
		])
		disposeQueue()
		expect(registry.list(moderator).map((command) => command.id)).toEqual(['forum-search.page'])
	})

	it('refuses unsafe or malformed contributions', () => {
		const registry = new PaletteCommandRegistry()
		expect(() => registry.register(one({ href: 'javascript:alert(1)' }))).toThrow(TypeError)
		expect(() => registry.register(one({ href: '//evil.example' }))).toThrow(TypeError)
		expect(() => registry.register(one({ label: ' ' }))).toThrow(TypeError)
		expect(() => registry.register(one({ minRole: 'owner' }))).toThrow(TypeError)
		expect(() => registry.register({ id: 'Bad Id', commands: one({}).commands })).toThrow(TypeError)
		expect(() => registry.register({ id: 'empty', commands: [] })).toThrow(TypeError)
		registry.register(one({}))
		expect(() => registry.register(one({}))).toThrow(Error)
		expect(registry.list(GUEST)[0]?.external).toBe(false)
		expect(
			new PaletteCommandRegistry().register({
				id: 'ext',
				commands: [{ id: 'c', label: 'L', href: 'https://example.com' }],
			}),
		).toBeTypeOf('function')
	})
})
