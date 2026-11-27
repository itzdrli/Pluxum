import type { Script } from '@pluxel/agent-sdk/host'
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

export default (async (sdk) => {
	const mail = sdk.plugin(ForumMailPlugin.nodeAddress())
	const status = await mail.status()
	const running = status?.lifecycleState === 'running'
	const record = running
		? await (await mail.context()).vault.kv().get(SMTP_PASSWORD_KEY)
		: undefined
	return {
		running,
		config: await mail.config.get(),
		password: record ? (record.exists ? record.source : 'none') : 'unknown',
	}
}) satisfies Script

export const configure = (async (sdk, run) => {
	const input = run.input
	if (!isRecord(input)) throw new Error('--input must be an object')
	const { password, set } = input
	const mail = sdk.plugin(ForumMailPlugin.nodeAddress())
	if (password !== undefined) {
		if (typeof password !== 'string' || password === '') throw new Error('"password" must be text')
		const { vault } = await mail.context()
		await vault.kv().set(SMTP_PASSWORD_KEY, password)
		await vault.flush()
	}
	// Saving the config reconnects the transport, which also picks up the new password.
	const saved = isRecord(set) ? await mail.config.patch({ set }) : undefined
	return { passwordSet: password !== undefined, saved }
}) satisfies Script
