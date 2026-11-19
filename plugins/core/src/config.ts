import * as v from 'valibot'
import * as f from 'valibot-form'
import { LIMITS } from '@pluxum/domain'

const SITE = { id: 'site', title: '站点', order: 0 }
const SOCIAL = { id: 'social', title: '动态与热度', order: 1 }

const text = (max: number) => v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(max))

/**
 * Forum Core's settings: the site's name and blurbs, the note length limit and how fast "hot"
 * forgets. The footer is the Forum Footer plugin's. Every value is read per request, so a saved
 * change shows on the next page load.
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
						f.formMeta({ title: '标语', description: '页脚中站点名称下方的一行字，可留空。' }),
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
	social: v.optional(
		v.pipe(
			v.object({
				noteBodyMax: v.optional(
					v.pipe(
						v.number(),
						v.integer(),
						v.minValue(20),
						v.maxValue(LIMITS.postBodyMax),
						f.formMeta({
							title: '动态字数上限',
							description: '一条动态正文最多多少个字。主题帖和回复不受影响。',
						}),
						f.numberMeta({ step: 50 }),
					),
					LIMITS.noteBodyMax,
				),
				hotGravity: v.optional(
					v.pipe(
						v.number(),
						v.minValue(0.5),
						v.maxValue(3),
						f.formMeta({
							title: '热门衰减',
							description:
								'“热门”按 (回复数 + 互动分) ÷ (发布后小时数 + 2) 的这个次方排序。越大，新帖越容易排在前面。',
						}),
						f.numberMeta({ step: 0.1 }),
					),
					1.5,
				),
			}),
			f.formMeta({ title: '动态与热度', section: SOCIAL }),
			f.objectMeta({ variant: 'stack' }),
		),
		{},
	),
})
export type ForumCoreConfig = v.InferOutput<typeof ForumCoreConfig>
