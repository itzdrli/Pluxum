import { FOOTER_ICONS } from '@pluxum/domain'
import {
	FOOTER_GROUP_MAX,
	FOOTER_LABEL_MAX,
	FOOTER_LINKS_MAX,
	FOOTER_NOTE_MAX,
	FOOTER_NOTES_MAX,
	ForumCorePlugin,
	isFooterHref,
} from '@pluxum/core'
import { BasePlugin, Plugin } from '@pluxel/core'
import * as v from 'valibot'
import * as f from 'valibot-form'

/** The contributor's ID in Pluxum Core's footer registry. */
export const FOOTER_CONTRIBUTOR_ID = 'forum-footer'

const text = (max: number) => v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(max))

const href = v.pipe(
	v.string(),
	v.trim(),
	f.formMeta({
		title: '链接',
		description: '站内路径以 / 开头，外链在新标签页打开',
	}),
	f.stringMeta({ placeholder: '/c/general 或 https://…' }),
	v.check((value: string) => isFooterHref(value), '链接须是论坛内路径（/ 开头）或 http(s) 地址'),
)

const label = v.pipe(text(FOOTER_LABEL_MAX), f.formMeta({ title: '文字' }))

const FooterLink = v.object({ label, href })

const FooterIconLink = v.object({
	icon: v.pipe(
		v.picklist(FOOTER_ICONS),
		f.formMeta({ title: '图标' }),
		f.picklistMeta({
			labels: { github: 'GitHub', rss: 'RSS', mail: '邮件', link: '链接' },
		}),
	),
	label: v.pipe(
		text(FOOTER_LABEL_MAX),
		f.formMeta({ title: '名称', description: '悬停提示和读屏文字' }),
	),
	href,
})

const FooterGroup = v.object({
	title: v.pipe(text(FOOTER_GROUP_MAX), f.formMeta({ title: '栏目标题' })),
	links: v.pipe(
		v.array(FooterLink),
		f.formMeta({ title: '链接' }),
		f.arrayMeta({ itemLabel: '链接', addLabel: '添加链接', defaultItem: { label: '', href: '/' } }),
		v.minLength(1),
		v.maxLength(FOOTER_LINKS_MAX),
	),
})

/** What the site footer shows. All of it is optional. */
export const ForumFooterConfig = v.object({
	siteLinks: v.optional(
		v.pipe(
			v.boolean(),
			f.formMeta({
				title: '显示「站内」栏',
				description: '在页脚最前面加一栏站内入口',
			}),
		),
		false,
	),
	groups: v.optional(
		v.pipe(
			v.array(FooterGroup),
			f.formMeta({
				title: '链接栏目',
				description: '页脚的文字链接栏，每栏一个标题',
			}),
			f.arrayMeta({
				itemLabel: '栏目',
				addLabel: '添加栏目',
				emptyHint: '没有栏目',
				defaultItem: { title: '', links: [{ label: '', href: '/' }] },
			}),
			v.maxLength(8),
		),
		[],
	),
	icons: v.optional(
		v.pipe(
			v.array(FooterIconLink),
			f.formMeta({ title: '图标链接', description: '页脚右下角只显示图标的链接' }),
			f.arrayMeta({
				itemLabel: '图标链接',
				addLabel: '添加图标链接',
				emptyHint: '没有图标链接',
				defaultItem: { icon: 'link', label: '', href: 'https://' },
			}),
			v.maxLength(FOOTER_LINKS_MAX),
		),
		[],
	),
	notes: v.optional(
		v.pipe(
			v.array(text(FOOTER_NOTE_MAX)),
			f.formMeta({
				title: '附注文字',
				description: '页脚底部的短句，例如版权声明、备案号、联系方式',
			}),
			f.arrayMeta({ itemLabel: '附注', addLabel: '添加附注', emptyHint: '没有附注' }),
			v.maxLength(FOOTER_NOTES_MAX),
		),
		[],
	),
})
export type ForumFooterConfig = v.InferOutput<typeof ForumFooterConfig>

type DeepReadonly<T> = T extends readonly (infer U)[]
	? readonly DeepReadonly<U>[]
	: T extends object
		? { readonly [K in keyof T]: DeepReadonly<T[K]> }
		: T

/**
 * Customises the site footer from its own settings: columns of text links, icon links and plain
 * notes. It hands them to Pluxum Core's footer registry as plain data, so no frontend code is
 * involved. A saved change replaces them at once; stopping the plugin withdraws all of them.
 */
@Plugin({ displayName: 'Pluxum Footer' })
export class ForumFooterPlugin extends BasePlugin {
	private readonly config = this.configs.use(ForumFooterConfig)
	private withdraw: (() => void) | undefined

	constructor(private readonly core: ForumCorePlugin) {
		super()
	}

	protected override init(): void {
		this.publish(this.config)
		// The listener runs before `this.config` is replaced, so it publishes what was saved.
		this.configs.onUpdate(this.config, ({ desired }) =>
			this.publish(v.parse(ForumFooterConfig, desired)),
		)
		this.ctx.effects.defer(() => {
			this.withdraw?.()
			this.withdraw = undefined
		})
	}

	/** (Re-)registers what the config holds now. An empty config registers nothing. */
	private publish({ siteLinks, groups, icons, notes }: DeepReadonly<ForumFooterConfig>): void {
		this.withdraw?.()
		this.withdraw = undefined
		if (!siteLinks && groups.length + icons.length + notes.length === 0) return
		// One registry entry per column: a contribution has a single `group` title.
		const disposers = [
			...groups.map((group, index) =>
				this.core.registerFooterLinks({
					id: `${FOOTER_CONTRIBUTOR_ID}-${index}`,
					group: group.title,
					links: group.links,
				}),
			),
			...(siteLinks || icons.length + notes.length > 0
				? [
						this.core.registerFooterLinks({
							id: `${FOOTER_CONTRIBUTOR_ID}-extras`,
							icons,
							notes,
							siteLinks,
						}),
					]
				: []),
		]
		this.withdraw = () => {
			for (const dispose of disposers) dispose()
		}
	}
}
