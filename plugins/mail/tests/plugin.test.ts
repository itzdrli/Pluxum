import type { ForumNotification, Principal } from '@pluxum/domain'
import { ForumApiPlugin } from '@pluxum/api'
import { ForumAuth, type Authentication } from '@pluxum/auth'
import { ForumCorePlugin } from '@pluxum/core'
import { Plugin } from '@pluxel/core'
import { database } from '@pluxel/services/database'
import { pglite } from '@pluxel/services/database/pglite'
import { elysia } from '@pluxel/services/elysia'
import { Vault, vault } from '@pluxel/services/vault'
import { createTestHost } from '@pluxel/test'
import { afterEach, describe, expect, it } from 'vitest'
import {
	ForumMailPlugin,
	MAIL_CHANNEL_ID,
	maskEmail,
	normalizeEmail,
	notificationMail,
	SMTP_PASSWORD_KEY,
} from '../src'
import { startSmtpServer } from './smtp-server'

@Plugin(ForumAuth)
class FakeAuth extends ForumAuth {
	override loginAvailable(): boolean {
		return true
	}
	override authenticate(): Promise<Authentication> {
		return Promise.resolve({ status: 'guest' })
	}
	override allowsOrigin(): boolean {
		return true
	}
	override beginLogin(): never {
		throw new Error('not used')
	}
	override completeLogin(): never {
		throw new Error('not used')
	}
	override logout(): never {
		throw new Error('not used')
	}
	override logoutEverywhere(): never {
		throw new Error('not used')
	}
	override revokeUserSessions(): Promise<number> {
		return Promise.resolve(0)
	}
	override backchannelLogout(): never {
		throw new Error('not used')
	}
	override testLoginAvailable(): boolean {
		return false
	}
	override testLogin(): never {
		throw new Error('not used')
	}
}

/** The readable text of a raw MIME message: every part decoded, headers included. */
function textOf(raw: string): string {
	const decoded: string[] = [raw]
	for (const part of raw.split(/\n--[^\n]+\n/)) {
		const split = part.indexOf('\n\n')
		if (split < 0) continue
		const headers = part.slice(0, split).toLowerCase()
		const body = part.slice(split + 2)
		if (headers.includes('content-transfer-encoding: base64')) {
			decoded.push(Buffer.from(body.replaceAll(/\s/g, ''), 'base64').toString('utf8'))
		} else if (headers.includes('content-transfer-encoding: quoted-printable')) {
			const bytes = body
				.replaceAll(/=\n/g, '')
				.replaceAll(/=([0-9A-F]{2})/gi, (_, hex: string) => `%${hex}`)
			try {
				decoded.push(decodeURIComponent(bytes))
			} catch {
				decoded.push(body)
			}
		}
	}
	// Encoded-word subjects: =?UTF-8?B?...?=
	for (const match of raw.matchAll(/=\?utf-8\?b\?([^?]+)\?=/gi)) {
		decoded.push(Buffer.from(match[1] ?? '', 'base64').toString('utf8'))
	}
	return decoded.join('\n')
}

const servers: Array<{ close: () => Promise<void> }> = []
afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.close()))
})

async function boot(options: { password?: string } = {}) {
	const smtp = await startSmtpServer(options)
	servers.push(smtp)
	const host = await createTestHost({
		services: [elysia(), database({ backend: pglite({ dataDir: 'memory://' }) }), vault()],
	})
	await host.commit((change) => {
		change.start(ForumCorePlugin)
		change.start(FakeAuth)
		change.start(ForumApiPlugin)
		change.start(ForumMailPlugin)
	})
	const core = host.require(ForumCorePlugin)
	const mail = host.require(ForumMailPlugin)
	const signUp = async (name: string): Promise<Principal> => {
		const user = (await core.ensureUser({ subject: `test:${name}`, displayName: name })).unwrap()
		return core.principalOf(user.id)
	}
	const configure = (set: Record<string, unknown> = {}) =>
		host.config.patch(ForumMailPlugin, {
			set: {
				enabled: true,
				host: '127.0.0.1',
				port: smtp.port,
				security: 'none',
				fromAddress: 'noreply@forum.test',
				siteUrl: 'https://forum.test',
				...set,
			},
		})
	return { host, core, mail, smtp, signUp, configure }
}

function notice(recipientId: string, title: string): ForumNotification {
	return {
		id: crypto.randomUUID(),
		recipientId,
		kind: 'thread.reply',
		title,
		body: '回复的摘要',
		path: '/t/1001/2',
		createdAt: new Date().toISOString(),
	}
}

describe('forum mail plugin', () => {
	it('mails notifications to the address from the identity provider unless switched off', async () => {
		const { core, mail, smtp, signUp, configure } = await boot()
		const alice = await signUp('Alice')
		const aliceId = alice.userId ?? ''

		// Off until configured; the address comes from the provider, none yet.
		expect((await mail.address(alice)).unwrap()).toEqual({
			available: false,
			email: null,
			enabled: true,
		})
		expect(await configure()).toMatchObject({ ok: true, application: 'applied' })

		// Without an address from the provider nothing is sent.
		expect(await core.deliverNotification(notice(aliceId, '没有邮箱'))).toContain(MAIL_CHANNEL_ID)
		await mail.idle()
		expect(smtp.mails).toHaveLength(0)

		await core.setContactEmail(aliceId, 'Alice@Example.COM')
		expect((await mail.address(alice)).unwrap()).toEqual({
			available: true,
			email: 'Alice@Example.COM',
			enabled: true,
		})
		await core.deliverNotification(notice(aliceId, 'Bob 回复了你的主题《测试》'))
		await mail.idle()
		expect(smtp.mails).toHaveLength(1)
		expect(smtp.mails[0]?.to).toEqual(['<Alice@example.com>'])
		const text = textOf(smtp.mails[0]?.data ?? '')
		expect(text).toContain('Bob 回复了你的主题《测试》')
		expect(text).toContain('https://forum.test/t/1001/2')
		expect(smtp.mails[0]?.from).toBe('<noreply@forum.test>')

		// Switched off: no more mail; back on: mail again.
		expect((await mail.setEnabled(alice, false)).unwrap().enabled).toBe(false)
		await core.deliverNotification(notice(aliceId, '关掉了'))
		await mail.idle()
		expect(smtp.mails).toHaveLength(1)
		expect((await mail.setEnabled(alice, true)).unwrap().enabled).toBe(true)
		await core.deliverNotification(notice(aliceId, '又开了'))
		await mail.idle()
		expect(smtp.mails).toHaveLength(2)

		// The provider stops sharing the address: nothing is sent.
		await core.setContactEmail(aliceId, null)
		await core.deliverNotification(notice(aliceId, '邮箱没了'))
		await mail.idle()
		expect(smtp.mails).toHaveLength(2)
	})

	it('logs in with the password kept in Vault, and stays off without it', async () => {
		const { host, core, mail, smtp, signUp, configure } = await boot({ password: 'hunter2' })
		const bob = await signUp('Bob')
		await core.setContactEmail(bob.userId ?? '', 'bob@example.com')
		await configure({ username: 'forum' })
		// A login without a password: mail stays off.
		expect((await mail.address(bob)).unwrap().available).toBe(false)

		await host.require(ForumMailPlugin).ctx.require(Vault).kv().set(SMTP_PASSWORD_KEY, 'hunter2')
		await configure({ username: 'forum', fromName: 'Pluxum' })
		expect((await mail.address(bob)).unwrap().available).toBe(true)
		await core.deliverNotification(notice(bob.userId ?? '', '登录发信'))
		await mail.idle()
		expect(smtp.logins).toEqual(['forum'])
		expect(smtp.mails).toHaveLength(1)
		expect(textOf(smtp.mails[0]?.data ?? '')).toContain('Pluxum')
	})
})

describe('mail composition', () => {
	it('normalises and masks addresses', () => {
		expect(normalizeEmail('  Bob@EXAMPLE.org ')).toBe('Bob@example.org')
		expect(normalizeEmail('bob@localhost')).toBeNull()
		expect(normalizeEmail('a b@example.org')).toBeNull()
		expect(maskEmail('bob@example.org')).toBe('b***@example.org')
	})

	it('escapes notification text in HTML and leaves links out without a site address', () => {
		const message = notificationMail(
			'a@example.org',
			{ ...notice('00000000-0000-4000-8000-000000000000', '<b>标题</b>'), path: '/t/1/1' },
			{ name: 'Pluxum', url: undefined },
		)
		expect(message.html).toContain('&lt;b&gt;标题&lt;/b&gt;')
		expect(message.html).not.toContain('<b>标题')
		expect(message.text).not.toContain('http')
	})
})
