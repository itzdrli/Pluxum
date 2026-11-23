import { isNoticeKey, type ForumNotification, type NoticeKey } from '@pluxum/domain'

export const MAIL_LOCALES = ['zh-CN', 'en'] as const
export type MailLocale = (typeof MAIL_LOCALES)[number]
export const DEFAULT_MAIL_LOCALE: MailLocale = 'zh-CN'

const TOKENS = /\{([^{}]*)\}/gu

type TemplateValues = { siteName: string; title?: string; body?: string }

export function validTemplate(template: string, allowed: readonly string[]): boolean {
	return (
		Array.from(template.matchAll(TOKENS)).every((match) => allowed.includes(match[1] ?? '')) &&
		!/[{}]/u.test(template.replaceAll(TOKENS, ''))
	)
}

export function renderTemplate(template: string, values: TemplateValues): string {
	// A single pass: braces in user content are not interpreted as template placeholders.
	return template
		.replaceAll(TOKENS, (_, key: string) => {
			switch (key) {
				case 'siteName':
					return values.siteName
				case 'title':
					return values.title ?? ''
				case 'body':
					return values.body ?? ''
				default:
					return ''
			}
		})
		.trim()
}

export type MailTemplates = Readonly<{
	notificationSubject: string
	notificationBody: string
	viewLabel: string
	footer: string
	settingsLabel: string
	testSubject: string
	testBody: string
}>

export const DEFAULT_TEMPLATES: Readonly<Record<MailLocale, MailTemplates>> = {
	'zh-CN': {
		notificationSubject: '{title}',
		notificationBody: '{title}\n\n{body}',
		viewLabel: '查看',
		footer: '不想再收到邮件？在论坛的个人资料页关闭邮件通知。',
		settingsLabel: '管理邮件通知',
		testSubject: '{siteName} 测试邮件',
		testBody: '这是一封测试邮件：{siteName} 的 SMTP 设置可以正常发信。',
	},
	en: {
		notificationSubject: '{title}',
		notificationBody: '{title}\n\n{body}',
		viewLabel: 'View',
		footer: 'Don’t want these emails? Turn off email notifications on your forum profile.',
		settingsLabel: 'Manage email notifications',
		testSubject: '{siteName} test email',
		testBody: 'This is a test email: the SMTP settings of {siteName} work.',
	},
}

const EN_TITLES: Record<NoticeKey, (actor: string, title: string) => string> = {
	'notice.reply.topic': (actor, title) => `${actor} replied to your thread “${title}”`,
	'notice.reply.note': (actor) => `${actor} replied to your note`,
	'notice.reply.in_topic': (actor, title) => `${actor} replied to you in “${title}”`,
	'notice.reply.in_note': (actor) => `${actor} replied to you in a note`,
	'notice.mention.in_topic': (actor, title) => `${actor} mentioned you in “${title}”`,
	'notice.mention.in_note': (actor) => `${actor} mentioned you in a note`,
	'notice.follow': (actor) => `${actor} followed you`,
	'notice.accepted': (actor) => `${actor} accepted your answer`,
	'notice.message': (actor) => `${actor} sent you a message`,
}

export function mailNoticeTitle(notification: ForumNotification, locale: MailLocale): string {
	const { titleKey, titleParams } = notification
	if (locale === 'en' && isNoticeKey(titleKey) && titleParams !== undefined) {
		const { actor, title } = titleParams
		if (typeof actor === 'string')
			return EN_TITLES[titleKey](actor, typeof title === 'string' ? title : '')
	}
	return notification.title
}
