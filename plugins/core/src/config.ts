import { FOOTER_ICONS } from '@pluxum/domain'
import * as v from 'valibot'
import * as f from 'valibot-form'
import { FOOTER_GROUP_MAX, FOOTER_LABEL_MAX, FOOTER_LINKS_MAX, isFooterHref } from './footer'

const SITE = { id: 'site', title: '站点', order: 0 }
const FOOTER = { id: 'footer', title: '页脚', order: 1 }

const text = (max: number) => v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(max))

const href = v.pipe(
	v.string(),
	v.trim(),
	f.formMeta({
		title: '链接',
		description: '论坛内路径（/ 开头）在当前页打开，其他地址在新标签页打开。',
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
		f.formMeta({ title: '名称', description: '鼠标悬停和读屏软件读出的文字。' }),
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

/**
 * Forum Core's settings: the site's name and blurbs, and the footer's own links. Every value is
 * read per request, so a saved change shows on the next page load.
 */
export const ForumCoreConfig = v.object({
	site: v.optional(
		v.pipe(
			v.object({
				name: v.optional(
					v.pipe(
						text(40),
						f.formMeta({ title: '站点名称', description: '显示在顶栏、页面标题和分享卡片上。' }),
					),
					'Pluxum',
				),
				tagline: v.optional(
					v.pipe(
						v.string(),
						v.trim(),
						v.maxLength(80),
						f.formMeta({ title: '标语', description: '页脚中站点名称旁的一行字，可留空。' }),
					),
					'万物皆插件 · 基于 Pluxel',
				),
				description: v.optional(
					v.pipe(
						v.string(),
						v.trim(),
						v.maxLength(200),
						f.formMeta({
							title: '站点简介',
							description: '首页的 meta description，用于搜索引擎摘要。',
						}),
						f.stringMeta({ control: 'textarea', rows: 2 }),
					),
					'万物皆插件的论坛',
				),
			}),
			f.formMeta({ title: '站点信息', section: SITE }),
			f.objectMeta({ variant: 'stack' }),
		),
		{},
	),
	footer: v.optional(
		v.pipe(
			v.object({
				groups: v.optional(
					v.pipe(
						v.array(FooterGroup),
						f.formMeta({
							title: '链接栏目',
							description:
								'页脚左侧的文字链接栏，每栏一个标题。没有栏目时页脚保持一行。插件注册的同名栏目会并入。',
						}),
						f.arrayMeta({
							itemLabel: '栏目',
							addLabel: '添加栏目',
							defaultItem: { title: '', links: [{ label: '', href: '/' }] },
						}),
						v.maxLength(8),
					),
					[],
				),
				icons: v.optional(
					v.pipe(
						v.array(FooterIconLink),
						f.formMeta({ title: '图标链接', description: '页脚右下角只显示图标的链接。' }),
						f.arrayMeta({
							itemLabel: '图标链接',
							addLabel: '添加图标链接',
							defaultItem: { icon: 'link', label: '', href: 'https://' },
						}),
						v.maxLength(FOOTER_LINKS_MAX),
					),
					[{ icon: 'github', label: 'GitHub', href: 'https://github.com/itzdrli/Pluxum' }],
				),
				notes: v.optional(
					v.pipe(
						v.array(text(120)),
						f.formMeta({
							title: '附注',
							description: '页脚底部的短句，例如许可证、备案号、版权声明。',
						}),
						f.arrayMeta({ itemLabel: '附注', addLabel: '添加附注' }),
						v.maxLength(6),
					),
					[],
				),
			}),
			f.formMeta({ title: '页脚', section: FOOTER }),
			f.objectMeta({ variant: 'stack' }),
		),
		{},
	),
})
export type ForumCoreConfig = v.InferOutput<typeof ForumCoreConfig>
