import type { ForumNotification } from '@pluxum/domain'

/** A message ready for the transport: plain text plus an equivalent HTML part. */
export type MailMessage = Readonly<{
	to: string
	subject: string
	text: string
	html: string
}>

/** Who the mail is from and where links point; taken from the plugin and site settings. */
export type MailSite = Readonly<{
	/** The site's name, from Forum Core's settings. */
	name: string
	/** Absolute origin of the public forum, or undefined when not configured (no links then). */
	url: string | undefined
}>

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/u

export const EMAIL_MAX = 254

/** A trimmed, lower-cased address when it looks deliverable, else null. */
export function normalizeEmail(input: string): string | null {
	const value = input.trim()
	if (value.length === 0 || value.length > EMAIL_MAX || !EMAIL.test(value)) return null
	const at = value.lastIndexOf('@')
	// The domain is case-insensitive; the local part is left as typed.
	return `${value.slice(0, at)}@${value.slice(at + 1).toLowerCase()}`
}

/** `a***@example.com`: enough to recognise one's own address, not to harvest it. */
export function maskEmail(email: string): string {
	const at = email.lastIndexOf('@')
	if (at < 1) return '***'
	return `${email[0]}***${email.slice(at)}`
}

const ESCAPES: Readonly<Record<string, string>> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;',
}

function escapeHtml(value: string): string {
	return value.replaceAll(/[&<>"']/g, (char) => ESCAPES[char] ?? char)
}

/** Joins the site origin and a forum path; undefined without an origin or a forum path. */
export function linkTo(site: MailSite, path: string | undefined): string | undefined {
	if (
		site.url === undefined ||
		path === undefined ||
		!path.startsWith('/') ||
		path.startsWith('//')
	) {
		return undefined
	}
	return new URL(path, site.url).toString()
}

/** Subject lines stay on one line and within what mail clients show. */
function subjectOf(value: string): string {
	const single = value.replaceAll(/\s+/gu, ' ').trim()
	const chars = Array.from(single)
	return chars.length <= 120 ? single : `${chars.slice(0, 119).join('')}…`
}

function layout(site: MailSite, paragraphs: readonly string[], footer: string): string {
	const body = paragraphs.map((paragraph) => `<p style="margin:0 0 16px">${paragraph}</p>`).join('')
	return (
		'<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f4;' +
		"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Noto Sans SC',sans-serif;" +
		'color:#1f1f1d;font-size:15px;line-height:1.6">' +
		'<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:24px 28px">' +
		`<p style="margin:0 0 20px;font-weight:600">${escapeHtml(site.name)}</p>` +
		body +
		`<p style="margin:24px 0 0;color:#77756f;font-size:13px">${footer}</p>` +
		'</div></body></html>'
	)
}

/** The mail for one forum notification. */
export function notificationMail(
	to: string,
	notification: ForumNotification,
	site: MailSite,
): MailMessage {
	const link = linkTo(site, notification.path)
	const settings = linkTo(site, `/u/${notification.recipientId}`)
	const lines = [notification.title, ...(notification.body ? [notification.body] : [])]
	const footerText = settings
		? `不想再收到邮件？在个人资料页关闭邮件通知：${settings}`
		: '不想再收到邮件？在论坛的个人资料页关闭邮件通知。'
	const text = [...lines, ...(link ? [`查看：${link}`] : []), '', '—', site.name, footerText].join(
		'\n\n',
	)
	const html = layout(
		site,
		[
			escapeHtml(notification.title),
			...(notification.body
				? [`<span style="color:#55534e">${escapeHtml(notification.body)}</span>`]
				: []),
			...(link
				? [
						`<a href="${escapeHtml(link)}" style="display:inline-block;padding:8px 16px;` +
							'background:#1f1f1d;color:#fff;border-radius:6px;text-decoration:none">查看</a>',
					]
				: []),
		],
		settings
			? `不想再收到邮件？<a href="${escapeHtml(settings)}" style="color:#77756f">在个人资料页关闭邮件通知</a>。`
			: '不想再收到邮件？在论坛的个人资料页关闭邮件通知。',
	)
	return { to, subject: subjectOf(notification.title), text, html }
}

/** The mail carrying the code that confirms an address. */
export function confirmationMail(
	to: string,
	code: string,
	minutes: number,
	site: MailSite,
): MailMessage {
	const subject = `${site.name} 邮箱验证码：${code}`
	const text = [
		`你的验证码是 ${code}，${minutes} 分钟内有效。`,
		`在 ${site.name} 的个人资料页输入它，就能用这个邮箱接收通知。`,
		'如果不是你本人操作，忽略这封邮件即可。',
	].join('\n\n')
	const html = layout(
		site,
		[
			`你的验证码是 <strong style="font-size:22px;letter-spacing:4px">${escapeHtml(code)}</strong>，${minutes} 分钟内有效。`,
			`在 ${escapeHtml(site.name)} 的个人资料页输入它，就能用这个邮箱接收通知。`,
		],
		'如果不是你本人操作，忽略这封邮件即可。',
	)
	return { to, subject: subjectOf(subject), text, html }
}

/** The mail Workbench sends to check the SMTP settings. */
export function testMail(to: string, site: MailSite): MailMessage {
	const text = `这是一封测试邮件：${site.name} 的 SMTP 设置可以正常发信。`
	return {
		to,
		subject: subjectOf(`${site.name} 测试邮件`),
		text,
		html: layout(site, [escapeHtml(text)], '由 Workbench 发送。'),
	}
}
