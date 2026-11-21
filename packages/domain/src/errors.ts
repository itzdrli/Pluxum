// What went wrong, as data. An error carries a stable `key` and its `params`; the Chinese
// `message` is only the fallback for a client that does not know the key (older or third-party
// clients). The web app words every key itself, in the visitor's language
// (apps/web/app/lib/api-errors.ts), and a test keeps both in step.

export const ENTITY_NAMES = [
	'category',
	'user',
	'post',
	'thread',
	'floor',
	'report',
	'notification',
	'file',
] as const
export type EntityName = (typeof ENTITY_NAMES)[number]

export const FIELD_NAMES = [
	'title',
	'category_name',
	'category_description',
	'display_name',
	'search_query',
	'content',
	'slug',
	'handle',
	'report_reason',
	'ban_reason',
	'resolution_note',
	'unban_note',
] as const
export type FieldName = (typeof FIELD_NAMES)[number]

export const RATE_BUCKETS = ['threads', 'replies', 'edits'] as const
export type RateBucket = (typeof RATE_BUCKETS)[number]

/** Every error key and the parameters it takes (`undefined`: none). */
export type ErrorSpecs = {
	// Request and session
	'auth.required': undefined
	'permission.denied': undefined
	'request.invalid': undefined
	'request.unparsable': undefined
	'request.method': undefined
	'request.cross_site': undefined
	'route.not_found': undefined
	'server.internal': undefined
	'login.unavailable': undefined
	'login.not_configured': undefined
	// Things that do not exist, text that does not fit
	'entity.not_found': { entity: EntityName }
	'field.not_text': { field: FieldName }
	'field.empty': { field: FieldName }
	'field.required': { field: FieldName }
	'field.bad_chars': { field: FieldName }
	'field.too_long': { field: FieldName; max: number }
	'handle.too_short': { min: number }
	'handle.format': undefined
	'handle.taken': undefined
	'slug.format': undefined
	'slug.derive_failed': undefined
	'position.not_integer': undefined
	'role.unknown': undefined
	'account.invalid_subject': undefined
	// Search
	'search.disabled': undefined
	'search.unavailable': undefined
	// Categories and threads
	'category.slug_taken': undefined
	'category.stream_undeletable': undefined
	'category.not_empty': undefined
	'category.kind_changed': undefined
	'thread.note_no_title': undefined
	'thread.note_untitled': undefined
	'thread.convert_needs_title': undefined
	'thread.topic_not_to_stream': undefined
	'thread.locked': undefined
	'post.opening_undeletable': undefined
	// Following, solved answers
	'follow.self': undefined
	'solved.not_allowed': undefined
	'solved.note': undefined
	'solved.opening': undefined
	'reactions.useful_off': undefined
	// Moderation
	'ban.cannot_post': undefined
	'ban.cannot_act': undefined
	'ban.self': undefined
	'ban.admin': undefined
	'ban.duration': undefined
	'content.banned_words': undefined
	'report.no_target': undefined
	'report.duplicate': undefined
	'report.bad_status': undefined
	// Rate limits: `seconds` is how long to wait, rounded up
	'rate.limited': { bucket: RateBucket; seconds: number }
	// Uploads: `limit` is a ready size such as "5 MiB"; `types` is comma separated
	'upload.avatar_unreadable': undefined
	'upload.avatar_too_large': { limit: string }
	'upload.avatar_type': undefined
	'upload.file_unreadable': undefined
	'upload.file_too_large': { limit: string }
	'upload.image_mismatch': undefined
	'upload.binary_text': undefined
	'upload.type_unsupported': { types: string }
}

export type ErrorKey = keyof ErrorSpecs
export type ErrorParams = Readonly<Record<string, string | number>>

export type ErrorArgs<K extends ErrorKey> = ErrorSpecs[K] extends undefined
	? []
	: [params: ErrorSpecs[K]]

/** A key with its parameters and the Chinese fallback text. */
export type ErrorDetail = Readonly<{ key: ErrorKey; params?: ErrorParams; message: string }>

const ENTITY_TEXT: Readonly<Record<EntityName, string>> = {
	category: '版块',
	user: '用户',
	post: '帖子',
	thread: '主题',
	floor: '楼层',
	report: '举报记录',
	notification: '通知',
	file: '文件',
}

const FIELD_TEXT: Readonly<Record<FieldName, string>> = {
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
}

const BUCKET_TEXT: Readonly<Record<RateBucket, string>> = {
	threads: '发主题',
	replies: '回帖',
	edits: '编辑',
}

/** "30 秒" / "5 分钟" / "2 小时", rounded up. */
function waitText(seconds: number): string {
	if (seconds < 60) return `${seconds} 秒`
	const minutes = Math.ceil(seconds / 60)
	if (minutes < 60) return `${minutes} 分钟`
	return `${Math.ceil(minutes / 60)} 小时`
}

type Texts = { [K in ErrorKey]: (params: ErrorSpecs[K]) => string }

/** The Chinese fallback of every key. */
export const ERROR_TEXT: Texts = {
	'auth.required': () => '请先登录',
	'permission.denied': () => '没有权限执行此操作',
	'request.invalid': () => '请求参数无效',
	'request.unparsable': () => '请求内容无法解析',
	'request.method': () => '请求方法不支持',
	'request.cross_site': () => '不允许跨站请求',
	'route.not_found': () => '接口不存在',
	'server.internal': () => '服务器内部错误',
	'login.unavailable': () => '登录服务暂时不可用，请稍后再试',
	'login.not_configured': () => '登录尚未配置',
	'entity.not_found': ({ entity }) => `${ENTITY_TEXT[entity]}不存在`,
	'field.not_text': ({ field }) => `${FIELD_TEXT[field]}必须是文本`,
	'field.empty': ({ field }) => `${FIELD_TEXT[field]}不能为空`,
	'field.required': ({ field }) => `请填写${FIELD_TEXT[field]}`,
	'field.bad_chars': ({ field }) => `${FIELD_TEXT[field]}包含不允许的字符`,
	'field.too_long': ({ field, max }) => `${FIELD_TEXT[field]}不能超过 ${max} 个字符`,
	'handle.too_short': ({ min }) => `用户名至少需要 ${min} 个字符`,
	'handle.format': () =>
		'用户名需以小写字母开头，只能包含小写字母、数字、连字符和下划线，且不能以符号结尾',
	'handle.taken': () => '用户名已被使用',
	'slug.format': () => '标识只能包含小写字母、数字和连字符',
	'slug.derive_failed': () => '无法从名称生成标识，请手动填写',
	'position.not_integer': () => '排序必须是整数',
	'role.unknown': () => '未知的角色',
	'account.invalid_subject': () => '无效的账号标识',
	'search.disabled': () => '搜索服务未启用',
	'search.unavailable': () => '搜索服务暂时不可用',
	'category.slug_taken': () => '版块标识已被使用',
	'category.stream_undeletable': () => '动态版块不能删除',
	'category.not_empty': () => '版块内已有主题，不能删除',
	'category.kind_changed': () => '版块类型已变化，请重试',
	'thread.note_no_title': () => '动态不需要标题',
	'thread.note_untitled': () => '动态没有标题',
	'thread.convert_needs_title': () => '转为主题帖需要一个标题',
	'thread.topic_not_to_stream': () => '主题帖不能移到动态里',
	'thread.locked': () => '主题已锁定，不能回复',
	'post.opening_undeletable': () => '主楼不能单独删除，请删除整个主题',
	'follow.self': () => '不能关注自己',
	'solved.not_allowed': () => '只有楼主或版主可以采纳答案',
	'solved.note': () => '动态不能采纳答案',
	'solved.opening': () => '主楼不能被采纳为答案',
	'reactions.useful_off': () => '这个版块没有开启「有用」',
	'ban.cannot_post': () => '账号已被封禁，无法发帖或编辑内容',
	'ban.cannot_act': () => '账号已被封禁，无法执行此操作',
	'ban.self': () => '不能封禁自己',
	'ban.admin': () => '不能封禁管理员',
	'ban.duration': () => '封禁时长必须大于 0',
	'content.banned_words': () => '内容包含违禁词，请修改后再提交',
	'report.no_target': () => '缺少举报目标',
	'report.duplicate': () => '你已举报过该内容，正在等待处理',
	'report.bad_status': () => '无效的举报状态筛选',
	'rate.limited': ({ bucket, seconds }) =>
		`${BUCKET_TEXT[bucket]}太频繁了，请 ${waitText(seconds)}后再试`,
	'upload.avatar_unreadable': () => '图片数据无法解析',
	'upload.avatar_too_large': ({ limit }) => `头像图片不能超过 ${limit}`,
	'upload.avatar_type': () => '头像仅支持 PNG、JPEG、WebP 或 GIF 图片',
	'upload.file_unreadable': () => '文件内容无法解析',
	'upload.file_too_large': ({ limit }) => `附件大小不能超过 ${limit}`,
	'upload.image_mismatch': () => '图片文件内容与格式不符',
	'upload.binary_text': () => '文本附件包含无效的二进制字符',
	'upload.type_unsupported': ({ types }) =>
		`不支持的文件类型（支持 ${types.split(',').join('、')}）`,
}

/** An error key with its parameters and fallback text: `errorDetail('entity.not_found', { entity: 'user' })`. */
export function errorDetail<K extends ErrorKey>(key: K, ...args: ErrorArgs<K>): ErrorDetail {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `args` holds exactly what ErrorSpecs[K] asks for: nothing, or the params.
	const params = args[0] as ErrorSpecs[K]
	const text: (params: ErrorSpecs[K]) => string = ERROR_TEXT[key]
	return params === undefined
		? { key, message: text(params) }
		: { key, params, message: text(params) }
}

/** A failure of `code` for `key`: `failure('not_found', 'entity.not_found', { entity: 'user' })`. */
export function failure<C extends string, K extends ErrorKey>(
	code: C,
	key: K,
	...args: ErrorArgs<K>
): Readonly<{ code: C; message: string; key: K; params?: ErrorParams }> {
	const detail = errorDetail(key, ...args)
	return detail.params === undefined
		? { code, message: detail.message, key }
		: { code, message: detail.message, key, params: detail.params }
}

/** The same, from an `ErrorDetail` already made (what the validators return). */
export function failureOf<C extends string>(
	code: C,
	detail: ErrorDetail,
): Readonly<{ code: C; message: string; key: ErrorKey; params?: ErrorParams }> {
	return detail.params === undefined
		? { code, message: detail.message, key: detail.key }
		: { code, message: detail.message, key: detail.key, params: detail.params }
}
