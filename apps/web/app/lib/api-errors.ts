import type { I18n } from '@lingui/core'
import { select, t } from '@lingui/core/macro'
import type { ErrorKey, ErrorParams } from '@pluxum/domain'

// The forum API reports an error as a key with parameters (`@pluxum/domain` errors) beside a
// Chinese fallback `message`. This file words every key in the visitor's language. A key it does
// not know (a newer API) shows the fallback. tests/api-errors.test.ts keeps the Chinese here in
// step with the API's fallback text.

type Params = ErrorParams | undefined

const text = (params: Params, name: string): string => {
	const value = params?.[name]
	return typeof value === 'string' ? value : ''
}
const count = (params: Params, name: string): number => {
	const value = params?.[name]
	return typeof value === 'number' ? value : 0
}

/** "30 秒" / "5 分钟" / "2 小时", rounded up. */
function waitText(i18n: I18n, seconds: number): string {
	if (seconds < 60) return t(i18n)`${seconds} 秒`
	const minutes = Math.ceil(seconds / 60)
	if (minutes < 60) return t(i18n)`${minutes} 分钟`
	const hours = Math.ceil(minutes / 60)
	return t(i18n)`${hours} 小时`
}

const TEXT: Readonly<Record<ErrorKey, (i18n: I18n, params: Params) => string>> = {
	'auth.required': (i18n) => t(i18n)`请先登录`,
	'permission.denied': (i18n) => t(i18n)`没有权限执行此操作`,
	'request.invalid': (i18n) => t(i18n)`请求参数无效`,
	'request.unparsable': (i18n) => t(i18n)`请求内容无法解析`,
	'request.method': (i18n) => t(i18n)`请求方法不支持`,
	'request.cross_site': (i18n) => t(i18n)`不允许跨站请求`,
	'route.not_found': (i18n) => t(i18n)`接口不存在`,
	'server.internal': (i18n) => t(i18n)`服务器内部错误`,
	'login.unavailable': (i18n) => t(i18n)`登录服务暂时不可用，请稍后再试`,
	'login.not_configured': (i18n) => t(i18n)`登录尚未配置`,
	'entity.not_found': (i18n, params) => {
		const entity = text(params, 'entity')
		return t(i18n)`${select(entity, {
			category: '版块',
			user: '用户',
			post: '帖子',
			thread: '主题',
			floor: '楼层',
			report: '举报记录',
			notification: '通知',
			file: '文件',
			other: '内容',
		})}不存在`
	},
	'field.not_text': (i18n, params) => {
		const name = fieldLabel(i18n, text(params, 'field'))
		return t(i18n)`${name}必须是文本`
	},
	'field.empty': (i18n, params) => {
		const name = fieldLabel(i18n, text(params, 'field'))
		return t(i18n)`${name}不能为空`
	},
	'field.required': (i18n, params) => {
		const name = fieldLabel(i18n, text(params, 'field'))
		return t(i18n)`请填写${name}`
	},
	'field.bad_chars': (i18n, params) => {
		const name = fieldLabel(i18n, text(params, 'field'))
		return t(i18n)`${name}包含不允许的字符`
	},
	'field.too_long': (i18n, params) => {
		const name = fieldLabel(i18n, text(params, 'field'))
		const max = count(params, 'max')
		return t(i18n)`${name}不能超过 ${max} 个字符`
	},
	'handle.too_short': (i18n, params) => {
		const min = count(params, 'min')
		return t(i18n)`用户名至少需要 ${min} 个字符`
	},
	'handle.format': (i18n) =>
		t(i18n)`用户名需以小写字母开头，只能包含小写字母、数字、连字符和下划线，且不能以符号结尾`,
	'handle.taken': (i18n) => t(i18n)`用户名已被使用`,
	'slug.format': (i18n) => t(i18n)`标识只能包含小写字母、数字和连字符`,
	'slug.derive_failed': (i18n) => t(i18n)`无法从名称生成标识，请手动填写`,
	'position.not_integer': (i18n) => t(i18n)`排序必须是整数`,
	'role.unknown': (i18n) => t(i18n)`未知的角色`,
	'account.invalid_subject': (i18n) => t(i18n)`无效的账号标识`,
	'account.email_invalid': (i18n) => t(i18n)`邮箱地址无效`,
	'account.email_taken': (i18n) => t(i18n)`这个邮箱已经注册过了`,
	'account.password_short': (i18n, params) => {
		const min = count(params, 'min')
		return t(i18n)`密码至少需要 ${min} 个字符`
	},
	'account.password_long': (i18n, params) => {
		const max = count(params, 'max')
		return t(i18n)`密码不能超过 ${max} 个字符`
	},
	'account.credentials': (i18n) => t(i18n)`邮箱或密码不对`,
	'account.registration_closed': (i18n) => t(i18n)`本站暂不开放注册`,
	'account.reset_invalid': (i18n) => t(i18n)`重设链接无效或已过期，请重新申请`,
	'account.reset_unavailable': (i18n) =>
		t(i18n)`本站没有配置邮件，不能通过邮箱重设密码，请联系管理员`,
	'search.disabled': (i18n) => t(i18n)`搜索服务未启用`,
	'search.unavailable': (i18n) => t(i18n)`搜索服务暂时不可用`,
	'category.slug_taken': (i18n) => t(i18n)`版块标识已被使用`,
	'category.stream_undeletable': (i18n) => t(i18n)`动态版块不能删除`,
	'category.not_empty': (i18n) => t(i18n)`版块内已有主题，不能删除`,
	'category.kind_changed': (i18n) => t(i18n)`版块类型已变化，请重试`,
	'thread.note_no_title': (i18n) => t(i18n)`动态不需要标题`,
	'thread.note_untitled': (i18n) => t(i18n)`动态没有标题`,
	'thread.convert_needs_title': (i18n) => t(i18n)`转为主题帖需要一个标题`,
	'thread.topic_not_to_stream': (i18n) => t(i18n)`主题帖不能移到动态里`,
	'thread.locked': (i18n) => t(i18n)`主题已锁定，不能回复`,
	'post.opening_undeletable': (i18n) => t(i18n)`主楼不能单独删除，请删除整个主题`,
	'follow.self': (i18n) => t(i18n)`不能关注自己`,
	'solved.not_allowed': (i18n) => t(i18n)`只有楼主或版主可以采纳答案`,
	'solved.note': (i18n) => t(i18n)`动态不能采纳答案`,
	'solved.opening': (i18n) => t(i18n)`主楼不能被采纳为答案`,
	'reactions.useful_off': (i18n) => t(i18n)`这个版块没有开启「有用」`,
	'ban.cannot_post': (i18n) => t(i18n)`账号已被封禁，无法发帖或编辑内容`,
	'ban.cannot_act': (i18n) => t(i18n)`账号已被封禁，无法执行此操作`,
	'ban.self': (i18n) => t(i18n)`不能封禁自己`,
	'ban.admin': (i18n) => t(i18n)`不能封禁管理员`,
	'ban.duration': (i18n) => t(i18n)`封禁时长必须大于 0`,
	'content.banned_words': (i18n) => t(i18n)`内容包含违禁词，请修改后再提交`,
	'report.no_target': (i18n) => t(i18n)`缺少举报目标`,
	'report.duplicate': (i18n) => t(i18n)`你已举报过该内容，正在等待处理`,
	'report.bad_status': (i18n) => t(i18n)`无效的举报状态筛选`,
	'rate.limited': (i18n, params) => {
		const bucket = text(params, 'bucket')
		const what = t(i18n)`${select(bucket, {
			threads: '发主题',
			replies: '回帖',
			edits: '编辑',
			logins: '登录',
			signups: '注册',
			resets: '重设密码',
			other: '操作',
		})}`
		const wait = waitText(i18n, count(params, 'seconds'))
		return t(i18n)`${what}太频繁了，请 ${wait}后再试`
	},
	'upload.avatar_unreadable': (i18n) => t(i18n)`图片数据无法解析`,
	'upload.avatar_too_large': (i18n, params) => {
		const limit = text(params, 'limit')
		return t(i18n)`头像图片不能超过 ${limit}`
	},
	'upload.avatar_type': (i18n) => t(i18n)`头像仅支持 PNG、JPEG、WebP 或 GIF 图片`,
	'upload.file_unreadable': (i18n) => t(i18n)`文件内容无法解析`,
	'upload.file_too_large': (i18n, params) => {
		const limit = text(params, 'limit')
		return t(i18n)`附件大小不能超过 ${limit}`
	},
	'upload.image_mismatch': (i18n) => t(i18n)`图片文件内容与格式不符`,
	'upload.binary_text': (i18n) => t(i18n)`文本附件包含无效的二进制字符`,
	'upload.type_unsupported': (i18n, params) => {
		const types = new Intl.ListFormat(i18n.locale, { type: 'conjunction', style: 'narrow' }).format(
			text(params, 'types').split(','),
		)
		return t(i18n)`不支持的文件类型（支持 ${types}）`
	},
}

/** The field an error is about, as a noun for the error sentence. */
function fieldLabel(i18n: I18n, field: string): string {
	return t(i18n)`${select(field, {
		title: '标题',
		category_name: '版块名称',
		category_description: '版块简介',
		display_name: '昵称',
		search_query: '搜索词',
		content: '内容',
		slug: '标识',
		handle: '用户名',
		report_reason: '举报原因',
		ban_reason: '封禁原因',
		resolution_note: '处理备注',
		unban_note: '解封说明',
		other: '内容',
	})}`
}

function isErrorKey(key: unknown): key is ErrorKey {
	return typeof key === 'string' && Object.hasOwn(TEXT, key)
}

/**
 * The text of an API error in the visitor's language: by its key when this build knows it, else
 * the API's own (Chinese) message.
 */
export function apiErrorText(
	i18n: I18n,
	error: Readonly<{ key?: string | undefined; params?: ErrorParams | undefined; message: string }>,
): string {
	return isErrorKey(error.key) ? TEXT[error.key](i18n, error.params) : error.message
}

/**
 * The error text of a failed API response body read in the browser, or null when the body is not
 * an API error.
 */
export function apiErrorTextOfBody(i18n: I18n, body: unknown): string | null {
	if (typeof body !== 'object' || body === null || !('error' in body)) return null
	const error: unknown = body.error
	if (typeof error !== 'object' || error === null) return null
	if (!('message' in error) || typeof error.message !== 'string') return null
	const params: unknown = 'params' in error ? error.params : undefined
	return apiErrorText(i18n, {
		key: 'key' in error && typeof error.key === 'string' ? error.key : undefined,
		params: isParams(params) ? params : undefined,
		message: error.message,
	})
}

function isParams(value: unknown): value is ErrorParams {
	return (
		typeof value === 'object' &&
		value !== null &&
		Object.values(value).every((entry) => typeof entry === 'string' || typeof entry === 'number')
	)
}
