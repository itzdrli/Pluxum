import type { ForumNotification } from '@pluxum/domain'
import {
	DEFAULT_MAIL_LOCALE,
	DEFAULT_TEMPLATES,
	mailNoticeTitle,
	renderTemplate,
	type MailLocale,
	type MailTemplates,
} from './templates'

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

const EMAIL_MAX = 254

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

function layout(site: MailSite, locale: MailLocale, body: string, footer = ''): string {
	const footerHtml =
		footer === '' ? '' : `<p style="margin:24px 0 0;color:#77756f;font-size:13px">${footer}</p>`
	return (
		`<!doctype html><html lang="${locale}"><body style="margin:0;padding:24px;background:#f6f6f4;` +
		"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Noto Sans SC',sans-serif;" +
		'color:#1f1f1d;font-size:15px;line-height:1.6">' +
		'<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:24px 28px">' +
		`<p style="margin:0 0 20px;font-weight:600">${escapeHtml(site.name)}</p>` +
		body +
		footerHtml +
		'</div></body></html>'
	)
}

function bodyHtml(text: string): string {
	return `<p style="margin:0 0 16px">${escapeHtml(text).replaceAll(/\r\n?|\n/g, '<br>')}</p>`
}

/** The mail for one forum notification. Templates are plain text, even in the HTML part. */
export function notificationMail(
	to: string,
	notification: ForumNotification,
	site: MailSite,
	locale: MailLocale = DEFAULT_MAIL_LOCALE,
	templates: MailTemplates = DEFAULT_TEMPLATES[locale],
): MailMessage {
	const link = linkTo(site, notification.path)
	const settings = linkTo(site, `/u/${notification.recipientId}`)
	const defaults = DEFAULT_TEMPLATES[locale]
	const values = {
		siteName: site.name,
		title: mailNoticeTitle(notification, locale),
		body: notification.body,
	}
	const render = (field: keyof MailTemplates) =>
		renderTemplate(templates[field] || defaults[field], values)
	const body = render('notificationBody')
	const view = render('viewLabel')
	const footer = render('footer')
	const settingsLabel = render('settingsLabel')
	const text = [
		body,
		...(link ? [`${view}: ${link}`] : []),
		`—\n${site.name}`,
		footer,
		...(settings ? [`${settingsLabel}: ${settings}`] : []),
	]
		.filter(Boolean)
		.join('\n\n')
	const button = link
		? `<p style="margin:0 0 16px"><a href="${escapeHtml(link)}" style="display:inline-block;padding:8px 16px;background:#1f1f1d;color:#fff;border-radius:6px;text-decoration:none">${escapeHtml(view)}</a></p>`
		: ''
	const settingsHtml = settings
		? `<br><a href="${escapeHtml(settings)}" style="color:#77756f">${escapeHtml(settingsLabel)}</a>`
		: ''
	return {
		to,
		subject: subjectOf(render('notificationSubject') || values.title || site.name),
		text,
		html: layout(site, locale, bodyHtml(body) + button, escapeHtml(footer) + settingsHtml),
	}
}

/** The mail Workbench sends to check the SMTP settings. */
export function testMail(
	to: string,
	site: MailSite,
	locale: MailLocale,
	templates: MailTemplates,
): MailMessage {
	const defaults = DEFAULT_TEMPLATES[locale]
	const values = { siteName: site.name }
	const text = renderTemplate(templates.testBody || defaults.testBody, values)
	return {
		to,
		subject: subjectOf(renderTemplate(templates.testSubject || defaults.testSubject, values)),
		text,
		html: layout(site, locale, bodyHtml(text)),
	}
}
