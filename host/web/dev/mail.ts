import { defineDevConsole } from '@pluxel/host-vite/console'
import { Vault } from '@pluxel/services/vault'
import { ForumMailPlugin, SMTP_PASSWORD_KEY } from '@pluxum/mail'

// The same writes as the Workbench "配置" form and the plugin's "邮件" tab, for scripting.
// The password goes into the mail plugin's own Vault namespace, so the plugin must be running.
//
// vp exec pluxel dev run host/web/dev/mail.ts                      → config and password status
// vp exec pluxel dev run host/web/dev/mail.ts --export configure \
//   --input '{"set":{"enabled":true,"host":"smtp.example.com",...},"password":"..."}'
//                                                                   → save config (+ password)

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export default defineDevConsole(async (dev) => {
	const mail = dev.plugins.isRunning(ForumMailPlugin)
		? dev.plugins.require(ForumMailPlugin)
		: undefined
	const record = mail ? await mail.ctx.require(Vault).kv().get(SMTP_PASSWORD_KEY) : undefined
	return {
		running: mail !== undefined,
		config: await dev.config.get(ForumMailPlugin),
		password: record ? (record.exists ? record.source : 'none') : 'unknown',
	}
})

export const configure = defineDevConsole(async (dev) => {
	const input = dev.input
	if (!isRecord(input)) throw new Error('--input must be an object')
	const { password, set } = input
	if (password !== undefined) {
		if (typeof password !== 'string' || password === '') throw new Error('"password" must be text')
		const vault = dev.plugins.require(ForumMailPlugin).ctx.require(Vault)
		await vault.kv().set(SMTP_PASSWORD_KEY, password)
		await vault.flush()
	}
	// Saving the config reconnects the transport, which also picks up the new password.
	const saved = isRecord(set) ? await dev.config.patch(ForumMailPlugin, { set }) : undefined
	return { passwordSet: password !== undefined, saved }
})
