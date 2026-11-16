import * as v from 'valibot'
import * as f from 'valibot-form'

const SITE = { id: 'site', title: '站点', order: 0 }

const text = (max: number) => v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(max))

/**
 * Forum Core's settings: the site's name and blurbs. The footer is the Forum Footer plugin's. Every value is
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
})
export type ForumCoreConfig = v.InferOutput<typeof ForumCoreConfig>
