// Must come before react-lang: keeps its development inspector out of the page.
import '../openui/no-devtools'

import {
	BuiltinActionType,
	Renderer,
	type ActionEvent,
	type OpenUIError,
} from '@openuidev/react-lang'
import { Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { data, useNavigate } from 'react-router'

import type { Route } from './+types/dev-openui'
import { Button } from '../components/ui/button'
import { Crumbs, Notice, PageHeader, Panel, SectionLabel } from '../components/ui/display'
import { FORUM_SAMPLE, forumLibrary, forumSystemPrompt, isForumPath } from '../openui/library'

export function meta(): Route.MetaDescriptors {
	return [{ title: 'OpenUI 演示 · Pluxum' }, { name: 'robots', content: 'noindex' }]
}

// Development only: production builds answer 404.
export function loader() {
	if (!import.meta.env.DEV) throw data('页面不存在。', { status: 404 })
	return { prompt: forumSystemPrompt() }
}

/** Replays the sample a few characters at a time, the way a model response arrives. */
function useReplay(text: string) {
	const [shown, setShown] = useState(text)
	const [streaming, setStreaming] = useState(false)
	const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
	useEffect(() => () => clearInterval(timer.current), [])
	const start = () => {
		clearInterval(timer.current)
		let length = 0
		setShown('')
		setStreaming(true)
		timer.current = setInterval(() => {
			length = Math.min(text.length, length + 6)
			setShown(text.slice(0, length))
			if (length === text.length) {
				clearInterval(timer.current)
				setStreaming(false)
			}
		}, 30)
	}
	return { shown, streaming, start }
}

export default function DevOpenUI({ loaderData }: Route.ComponentProps) {
	const navigate = useNavigate()
	const { shown, streaming, start } = useReplay(FORUM_SAMPLE)
	const [events, setEvents] = useState<string[]>([])
	const [errors, setErrors] = useState<OpenUIError[]>([])

	const onAction = (event: ActionEvent) => {
		const url = event.params.url
		if (event.type === BuiltinActionType.OpenUrl && typeof url === 'string' && isForumPath(url)) {
			void navigate(url)
			return
		}
		// Follow-up questions go to forum-ai once it exists (M4); the demo just records them.
		setEvents((previous) => [...previous, `${event.type}: ${event.humanFriendlyMessage}`])
	}

	return (
		<>
			<Crumbs items={[{ label: '开发' }, { label: 'OpenUI 演示' }]} />
			<PageHeader
				title="OpenUI 演示"
				description="用论坛组件库渲染一段写死的 OpenUI Lang。只在开发环境可见。"
				actions={
					<Button tone="secondary" onPress={start} isDisabled={streaming}>
						<Play aria-hidden />
						模拟流式输出
					</Button>
				}
			/>
			<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
				<section>
					<SectionLabel>渲染结果</SectionLabel>
					<Panel className="p-4">
						<div data-testid="openui-output">
							<Renderer
								response={shown}
								library={forumLibrary}
								isStreaming={streaming}
								onAction={onAction}
								onError={setErrors}
							/>
						</div>
					</Panel>
					{errors.length > 0 && !streaming && (
						<Notice tone="warning" className="mt-3">
							{errors.map((error) => error.message).join('；')}
						</Notice>
					)}
				</section>
				<aside className="flex min-w-0 flex-col gap-4">
					<section>
						<SectionLabel>动作</SectionLabel>
						<Panel className="text-ink-weak min-h-16 p-3 font-mono text-meta">
							{events.length === 0
								? '按下生成的按钮后在这里显示。'
								: events.map((line, index) => (
										// oxlint-disable-next-line react/no-array-index-key -- an append-only log.
										<p key={index} className="text-ink">
											{line}
										</p>
									))}
						</Panel>
					</section>
					<section>
						<SectionLabel>OpenUI Lang</SectionLabel>
						<pre className="border-line bg-panel text-ink max-h-80 overflow-auto rounded-[2px] border p-3 font-mono text-meta whitespace-pre-wrap">
							{FORUM_SAMPLE}
						</pre>
					</section>
				</aside>
			</div>
			<details className="mt-6">
				<summary className="section-label cursor-pointer">系统提示词（library.prompt()）</summary>
				<pre className="border-line bg-panel text-ink mt-2 max-h-[480px] overflow-auto rounded-[2px] border p-3 font-mono text-meta whitespace-pre-wrap">
					{loaderData.prompt}
				</pre>
			</details>
		</>
	)
}
