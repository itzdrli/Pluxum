import { describe, expect, it } from 'vitest'
import {
	defaultRolePolicy,
	evaluatePolicies,
	GUEST,
	isEntityId,
	LIMITS,
	normalizePage,
	slugify,
	validatePostBody,
	validateSearchQuery,
	validateSlug,
	validateThreadTitle,
	type ForumAction,
	type ForumResource,
	type PermissionPolicy,
	type Principal,
} from '@pluxum/domain'

const member: Principal = { userId: 'u-member', roles: ['member'] }
const moderator: Principal = { userId: 'u-mod', roles: ['member', 'moderator'] }
const admin: Principal = { userId: 'u-admin', roles: ['admin'] }

const can = (principal: Principal, action: ForumAction, resource: ForumResource = {}) =>
	evaluatePolicies([defaultRolePolicy], { principal, action, resource })

describe('default role policy', () => {
	it('lets everyone read and only members write', () => {
		expect(can(GUEST, 'thread.view')).toBe(true)
		expect(can(GUEST, 'thread.create')).toBe(false)
		expect(can(GUEST, 'post.create')).toBe(false)
		expect(can(member, 'thread.create')).toBe(true)
		expect(can(member, 'post.create')).toBe(true)
	})

	it('limits edits and deletes to the author or staff', () => {
		expect(can(member, 'post.edit', { authorId: 'u-member' })).toBe(true)
		expect(can(member, 'post.edit', { authorId: 'u-other' })).toBe(false)
		expect(can(member, 'thread.delete', { authorId: 'u-other' })).toBe(false)
		expect(can(moderator, 'post.delete', { authorId: 'u-other' })).toBe(true)
		// A guest never matches an anonymous author.
		expect(can(GUEST, 'post.edit', { authorId: null })).toBe(false)
	})

	it('freezes a locked thread for members but not for staff', () => {
		expect(can(member, 'post.create', { locked: true })).toBe(false)
		expect(can(member, 'post.edit', { authorId: 'u-member', locked: true })).toBe(false)
		expect(can(moderator, 'post.create', { locked: true })).toBe(true)
	})

	it('reserves moderation for staff and category management for admins', () => {
		expect(can(member, 'thread.moderate')).toBe(false)
		expect(can(moderator, 'thread.moderate')).toBe(true)
		expect(can(moderator, 'category.manage')).toBe(false)
		expect(can(admin, 'category.manage')).toBe(true)
		expect(can(member, 'user.edit', { userId: 'u-member' })).toBe(true)
		expect(can(member, 'user.edit', { userId: 'u-other' })).toBe(false)
		expect(can(moderator, 'user.edit', { userId: 'u-other' })).toBe(false)
		expect(can(admin, 'user.edit', { userId: 'u-other' })).toBe(true)
		expect(can(GUEST, 'user.edit', { userId: null })).toBe(false)
	})
})

const allow: PermissionPolicy = () => 'allow'
const deny: PermissionPolicy = () => 'deny'
const abstain: PermissionPolicy = () => 'abstain'
const broken: PermissionPolicy = () => {
	throw new Error('boom')
}

describe('evaluatePolicies', () => {
	const request = { principal: member, action: 'thread.create', resource: {} } as const

	it('denies when nobody has an opinion', () => {
		expect(evaluatePolicies([], request)).toBe(false)
		expect(evaluatePolicies([abstain], request)).toBe(false)
	})

	it('lets any deny override an allow regardless of order', () => {
		expect(evaluatePolicies([allow, abstain], request)).toBe(true)
		expect(evaluatePolicies([allow, deny], request)).toBe(false)
		expect(evaluatePolicies([deny, allow], request)).toBe(false)
	})

	it('treats a throwing policy as a deny', () => {
		expect(evaluatePolicies([allow, broken], request)).toBe(false)
	})
})

describe('content rules', () => {
	it('normalizes titles and rejects empty or oversized ones', () => {
		expect(validateThreadTitle('  Hello   world ')).toEqual({ ok: true, value: 'Hello world' })
		expect(validateThreadTitle('   ').ok).toBe(false)
		expect(validateThreadTitle('字'.repeat(LIMITS.threadTitleMax)).ok).toBe(true)
		expect(validateThreadTitle('字'.repeat(LIMITS.threadTitleMax + 1)).ok).toBe(false)
		expect(validateSearchQuery('  乒乓球拍  ')).toEqual({ ok: true, value: '乒乓球拍' })
		expect(validateSearchQuery('   ').ok).toBe(false)
	})

	it('keeps post formatting while normalizing line endings', () => {
		expect(validatePostBody('\r\n\r\n  code\r\nline two  \n\n')).toEqual({
			ok: true,
			value: '  code\nline two',
		})
		expect(validatePostBody(' \n ').ok).toBe(false)
		expect(validatePostBody('a\0b').ok).toBe(false)
	})

	it('validates and derives slugs', () => {
		expect(validateSlug('general-chat').ok).toBe(true)
		expect(validateSlug('General').ok).toBe(false)
		expect(validateSlug('-x').ok).toBe(false)
		expect(slugify('  Général Chat! ')).toBe('general-chat')
		expect(slugify('综合讨论')).toBe('')
	})

	it('recognizes entity IDs', () => {
		expect(isEntityId('3f2b8c1e-9d4a-4c1b-8e2f-0a1b2c3d4e5f')).toBe(true)
		expect(isEntityId('42')).toBe(false)
		expect(isEntityId(undefined)).toBe(false)
	})

	it('clamps paging input', () => {
		expect(normalizePage()).toEqual({ page: 1, pageSize: LIMITS.pageSizeDefault })
		expect(normalizePage({ page: 0, pageSize: 1000 })).toEqual({
			page: 1,
			pageSize: LIMITS.pageSizeMax,
		})
		expect(normalizePage({ page: 3, pageSize: 5 })).toEqual({ page: 3, pageSize: 5 })
		expect(normalizePage({ page: Number.NaN })).toEqual({ page: 1, pageSize: 20 })
	})
})
