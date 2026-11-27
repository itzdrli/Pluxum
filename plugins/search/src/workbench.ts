import { workbench } from '@pluxel/workbench'
import * as v from 'valibot'
import * as f from 'valibot-form'

const IndexStatus = v.pipe(
	v.object({
		documents: v.pipe(v.number(), v.integer(), f.formMeta({ title: '已索引的帖子' })),
		customWords: v.pipe(v.number(), v.integer(), f.formMeta({ title: '自定义词数量' })),
		rebuild: v.pipe(
			v.picklist(['idle', 'running']),
			f.formMeta({ title: '重建' }),
			f.picklistMeta({ labels: { idle: '空闲', running: '进行中' } }),
		),
		lastRebuild: v.pipe(
			v.nullable(
				v.object({
					finishedAt: v.pipe(v.string(), f.formMeta({ title: '完成时间' })),
					outcome: v.pipe(
						v.picklist(['succeeded', 'failed']),
						f.formMeta({ title: '结果' }),
						f.picklistMeta({ labels: { succeeded: '成功', failed: '失败' } }),
					),
					indexed: v.pipe(v.nullable(v.number()), f.formMeta({ title: '写入条数' })),
					durationMs: v.pipe(v.number(), f.formMeta({ title: '耗时（毫秒）' })),
				}),
			),
			f.formMeta({ title: '上次重建' }),
		),
	}),
	f.formMeta({ title: '索引状态' }),
)
export type SearchIndexStatus = v.InferOutput<typeof IndexStatus>

const SegmentInput = v.object({
	text: v.pipe(
		v.string(),
		v.trim(),
		v.minLength(1),
		v.maxLength(200),
		f.formMeta({
			title: '文本',
			description: '用当前的词典切分这段文字，检查自定义词是否被当作一个整体',
		}),
	),
})

export const SearchWorkbench = workbench.define(import.meta.url, {
	index: workbench.content({
		document: './workbench.md',
		slots: {
			status: workbench.data(IndexStatus),
			rebuild: workbench.action({
				label: '重建索引',
				confirm: '重新切分并写入全部帖子的索引。帖子很多时需要一段时间，期间搜索照常可用。继续吗？',
			}),
			segment: workbench.action({ label: '试分词', input: SegmentInput, form: 'embedded' }),
		},
		placement: { kind: 'tab', label: '索引', icon: 'search', order: 10 },
	}),
})
