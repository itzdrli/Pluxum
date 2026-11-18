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
	it('confirms an address with a mailed code, then mails notifications while switched on', async () => {
		const { core, mail, smtp, signUp, configure } = await boot()
		const alice = await signUp('Alice')

		// Off by default: nothing to bind, nothing sent.
		expect((await mail.address(alice)).unwrap()).toMatchObject({ available: false, email: null })
		const early = await mail.setAddress(alice, 'alice@example.com')
		expect(early.isErr() && early.error.code).toBe('unavailable')

		expect(await configure()).toMatchObject({ ok: true, application: 'applied' })
		expect((await mail.setAddress(alice, 'not an address')).isErr()).toBe(true)
		const pending = (await mail.setAddress(alice, ' Alice@Example.COM ')).unwrap()
		expect(pending).toMatchObject({
			available: true,
			email: 'Alice@example.com',
			verified: false,
			pending: true,
		})
		expect(smtp.mails).toHaveLength(1)
		expect(smtp.mails[0]?.to).toEqual(['<Alice@example.com>'])
		const code = /验证码是 (\d{6})/.exec(textOf(smtp.mails[0]?.data ?? ''))?.[1]
		expect(code).toMatch(/^\d{6}$/)

		// Asking again within a minute is refused.
		const again = await mail.setAddress(alice, 'alice@example.com')
		expect(again.isErr() && again.error.code).toBe('rate_limited')

		// An unconfirmed address receives no notifications.
		expect(await core.deliverNotification(notice(alice.userId!, '还没验证'))).toContain(
			MAIL_CHANNEL_ID,
		)
		await mail.idle()
		expect(smtp.mails).toHaveLength(1)

		const wrong = await mail.verify(alice, code === '000000' ? '111111' : '000000')
		expect(wrong.isErr() && wrong.error.message).toBe('验证码不正确')
		expect((await mail.verify(alice, code ?? '')).unwrap()).toMatchObject({
			verified: true,
			enabled: true,
			pending: false,
		})

		await core.deliverNotification(notice(alice.userId!, 'Bob 回复了你的主题《测试》'))
		await mail.idle()
		expect(smtp.mails).toHaveLength(2)
		const text = textOf(smtp.mails[1]?.data ?? '')
		expect(text).toContain('Bob 回复了你的主题《测试》')
		expect(text).toContain('https://forum.test/t/1001/2')
		expect(smtp.mails[1]?.from).toBe('<noreply@forum.test>')

		// Switched off, then removed: no more mail.
		expect((await mail.setEnabled(alice, false)).unwrap().enabled).toBe(false)
		await core.deliverNotification(notice(alice.userId!, '关掉了'))
		await mail.idle()
		expect(smtp.mails).toHaveLength(2)
		expect((await mail.remove(alice)).unwrap().email).toBeNull()
		expect((await mail.setEnabled(alice, true)).isErr()).toBe(true)
	})

	it('logs in with the password kept in Vault, and stays off without it', async () => {
		const { host, mail, smtp, signUp, configure } = await boot({ password: 'hunter2' })
		const bob = await signUp('Bob')
		await configure({ username: 'forum' })
		// A login without a password: mail stays off.
		expect((await mail.address(bob)).unwrap().available).toBe(false)

		await host.require(ForumMailPlugin).ctx.require(Vault).kv().set(SMTP_PASSWORD_KEY, 'hunter2')
		await configure({ username: 'forum', fromName: '论坛' })
		expect((await mail.address(bob)).unwrap().available).toBe(true)
		;(await mail.setAddress(bob, 'bob@example.com')).unwrap()
		expect(smtp.logins).toEqual(['forum'])
		expect(smtp.mails).toHaveLength(1)
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
