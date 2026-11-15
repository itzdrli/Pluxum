// The forum's OpenUI component library: what a model may put on screen when the forum's AI
// features (M4, forum-ai) answer in OpenUI Lang. Every component renders with the forum's own
// components and tokens, so generated answers look like the rest of the site.
//
// Model output is untrusted. Links are limited to paths on this forum, text is rendered as text,
// and actions only reach the host page's `onAction`, which decides what to do with them.
import './no-devtools'

import {
	action,
	type ComponentRenderProps,
	createLibrary,
	defineComponent,
	useIsStreaming,
	useTriggerAction,
} from '@openuidev/react-lang'
import { ArrowUpRight, MessageSquare, Quote, Sparkles } from 'lucide-react'
import { Fragment } from 'react'
import { Link } from 'react-router'
import { z } from 'zod/v4'

import { Button } from '../components/ui/button'
import { Avatar, Notice, Tag } from '../components/ui/display'

/** A path on this forum: one leading slash, so never another origin (`//host`, `/\host`). */
export function isForumPath(value: string): boolean {
	return /^\/(?![/\\])[^\s]*$/.test(value)
}

const forumPath = z
	.string()
	.describe('A path on this forum starting with "/", e.g. "/t/<thread id>" or "/c/<category slug>"')

/** Renders `href` as a client-side link when it is a forum path, as plain text otherwise. */
function SafeLink({
	href,
	className,
	children,
}: {
	href: string
	className?: string
	children: React.ReactNode
}) {
	if (!isForumPath(href)) return <span className={className}>{children}</span>
	return (
		<Link to={href} className={className}>
			{children}
		</Link>
	)
}

const Paragraph = defineComponent({
	name: 'Paragraph',
	description: 'A paragraph of plain text. Use for explanations; keep each paragraph short.',
	props: z.object({ text: z.string().describe('Plain text; no Markdown') }),
	component: ({ props }) => <p className="text-ink leading-relaxed">{props.text}</p>,
})

const Heading = defineComponent({
	name: 'Heading',
	description: 'A small section heading that groups the blocks after it.',
	props: z.object({ text: z.string() }),
	component: ({ props }) => <h3 className="section-label mt-1">{props.text}</h3>,
})

const Summary = defineComponent({
	name: 'Summary',
	description: 'Key points of a thread or discussion, as a titled list of short sentences.',
	props: z.object({
		title: z.string().describe('What is being summarised, e.g. "讨论要点"'),
		points: z.array(z.string()).describe('One sentence per point, most important first'),
	}),
	component: ({ props }) => (
		<section className="border-line bg-control/50 rounded-[2px] border p-3">
			<h3 className="text-ink-strong mb-2 flex items-center gap-1.5 font-bold">
				<Sparkles aria-hidden size={14} className="text-accent" />
				{props.title}
			</h3>
			<ul className="text-ink flex list-disc flex-col gap-1 pl-5">
				{(props.points ?? []).map((point, index) => (
					// oxlint-disable-next-line react/no-array-index-key -- points are plain strings that may repeat.
					<li key={index}>{point}</li>
				))}
			</ul>
		</section>
	),
})

const BulletList = defineComponent({
	name: 'BulletList',
	description: 'A plain list of short items.',
	props: z.object({ items: z.array(z.string()) }),
	component: ({ props }) => (
		<ul className="text-ink flex list-disc flex-col gap-1 pl-5">
			{(props.items ?? []).map((item, index) => (
				// oxlint-disable-next-line react/no-array-index-key -- items are plain strings that may repeat.
				<li key={index}>{item}</li>
			))}
		</ul>
	),
})

const ThreadCard = defineComponent({
	name: 'ThreadCard',
	description: 'A reference to a forum thread the answer relies on or recommends.',
	props: z.object({
		href: forumPath,
		title: z.string(),
		category: z.string().optional().describe('Name of the category the thread is in'),
		replies: z.number().optional().describe('Number of replies'),
		excerpt: z.string().optional().describe('One or two sentences on why it is relevant'),
	}),
	component: ({ props }) => (
		<SafeLink
			href={props.href}
			className="border-line bg-panel hover:bg-hover group flex flex-col gap-1 rounded-[2px] border px-3 py-2.5"
		>
			<span className="flex items-start justify-between gap-2">
				<span className="text-ink-strong font-bold break-words">{props.title}</span>
				<ArrowUpRight
					aria-hidden
					size={14}
					className="text-ink-weak group-hover:text-accent mt-0.5 shrink-0"
				/>
			</span>
			{props.excerpt !== undefined && <span className="text-ink break-words">{props.excerpt}</span>}
			{(props.category !== undefined || props.replies !== undefined) && (
				<span className="text-ink-weak flex items-center gap-2 text-[12px]">
					{props.category !== undefined && <Tag>{props.category}</Tag>}
					{props.replies !== undefined && (
						<span className="flex items-center gap-1 tabular-nums">
							<MessageSquare aria-hidden size={12} />
							{props.replies}
						</span>
					)}
				</span>
			)}
		</SafeLink>
	),
})

const PostQuote = defineComponent({
	name: 'PostQuote',
	description: 'Quotes part of a specific post, with its author and a link to it.',
	props: z.object({
		href: forumPath.describe('Path to the post, e.g. "/t/<thread id>#post-<post id>"'),
		author: z.string(),
		excerpt: z.string().describe('The quoted words, verbatim'),
	}),
	component: ({ props }) => (
		<figure className="border-line bg-panel rounded-[2px] border px-3 py-2.5">
			<blockquote className="text-ink flex gap-2 break-words">
				<Quote aria-hidden size={14} className="text-ink-weak mt-1 shrink-0" />
				<span>{props.excerpt}</span>
			</blockquote>
			<figcaption className="text-ink-weak mt-2 flex items-center gap-2 text-[12px]">
				<Avatar name={props.author ?? '?'} size="sm" />
				<span className="text-ink">{props.author}</span>
				<SafeLink href={props.href} className="hover:text-accent ml-auto">
					查看原帖
				</SafeLink>
			</figcaption>
		</figure>
	),
})

const LinkItem = defineComponent({
	name: 'LinkItem',
	description: 'One link inside a LinkList.',
	props: z.object({ label: z.string(), href: forumPath }),
	component: ({ props }) => (
		<SafeLink href={props.href} className="text-accent hover:underline">
			{props.label}
		</SafeLink>
	),
})

const LinkList = defineComponent({
	name: 'LinkList',
	description: 'A compact list of links to places on the forum.',
	props: z.object({ links: z.array(LinkItem.ref) }),
	component: ({ props, renderNode }) => (
		<ul className="flex flex-col gap-1">
			{(props.links ?? []).map((link, index) => (
				// oxlint-disable-next-line react/no-array-index-key -- generated nodes carry no stable id.
				<li key={index}>{renderNode(link)}</li>
			))}
		</ul>
	),
})

const actionButtonProps = z.object({
	label: z.string(),
	action: action(),
	primary: z.boolean().optional().describe('true for the single most likely next step'),
})

function ActionButtonView({ props }: ComponentRenderProps<z.infer<typeof actionButtonProps>>) {
	const trigger = useTriggerAction()
	const streaming = useIsStreaming()
	return (
		<Button
			tone={props.primary === true ? 'primary' : 'secondary'}
			size="sm"
			isDisabled={streaming}
			onPress={() => void trigger(props.label, undefined, props.action)}
		>
			{props.label}
		</Button>
	)
}

const ActionButton = defineComponent({
	name: 'ActionButton',
	description:
		'A button the reader can press: @ToAssistant("…") offers a follow-up question, @OpenUrl("/…") opens a forum page.',
	props: actionButtonProps,
	component: ActionButtonView,
})

const Actions = defineComponent({
	name: 'Actions',
	description: 'A row of ActionButtons, placed last.',
	props: z.object({ buttons: z.array(ActionButton.ref) }),
	component: ({ props, renderNode }) => (
		<div className="flex flex-wrap gap-2">
			{(props.buttons ?? []).map((button, index) => (
				// oxlint-disable-next-line react/no-array-index-key -- generated nodes carry no stable id.
				<Fragment key={index}>{renderNode(button)}</Fragment>
			))}
		</div>
	),
})

const Caution = defineComponent({
	name: 'Caution',
	description: 'A short warning, e.g. when information may be outdated or the forum has no answer.',
	props: z.object({ text: z.string() }),
	component: ({ props }) => <Notice tone="warning">{props.text}</Notice>,
})

const blocks = [
	Heading,
	Paragraph,
	Summary,
	BulletList,
	ThreadCard,
	PostQuote,
	LinkList,
	Caution,
	Actions,
]

const Answer = defineComponent({
	name: 'Answer',
	description: 'The whole answer: blocks shown top to bottom.',
	props: z.object({
		blocks: z.array(z.union(blocks.map((block) => block.ref))),
	}),
	component: ({ props, renderNode }) => (
		<div className="flex flex-col gap-3">
			{(props.blocks ?? []).map((block, index) => (
				// oxlint-disable-next-line react/no-array-index-key -- generated nodes carry no stable id; blocks only append while streaming.
				<Fragment key={index}>{renderNode(block)}</Fragment>
			))}
		</div>
	),
})

export const forumLibrary = createLibrary({
	id: 'forum',
	root: 'Answer',
	components: [Answer, ...blocks, LinkItem, ActionButton],
})

/** System prompt for the forum's AI features; M4 hands it to the backend. */
export function forumSystemPrompt(): string {
	return forumLibrary.prompt({
		preamble:
			'You are the assistant of a Chinese-language discussion forum. Answer in Simplified Chinese, based on the forum content you are given.',
		additionalRules: [
			'Only link to paths on this forum, starting with "/". Never invent thread or post IDs.',
			'Prefer ThreadCard and PostQuote over retelling a discussion.',
			'Keep answers short: at most one Summary and three ThreadCards.',
		],
		examples: [FORUM_SAMPLE],
	})
}

/** A fixed answer used by the development demo and as the prompt example. */
export const FORUM_SAMPLE = `root = Answer([intro, summary, refs, quote, more, next])
intro = Paragraph("关于在论坛里接入登录，目前的讨论集中在两个主题里。")
summary = Summary("讨论要点", ["登录走 Zitadel 的 OIDC，授权码加 PKCE。", "会话存在 Redis，可以退出所有设备。", "Workbench 的登录另外配置。"])
refs = ThreadCard("/c/general", "欢迎来到 Pluxum", "综合讨论", 3, "介绍论坛目前能做什么。")
quote = PostQuote("/c/general", "管理员", "写操作会检查 Origin 头，跨站请求一律拒绝。")
more = LinkList([LinkItem("全部版块", "/"), LinkItem("综合讨论", "/c/general")])
next = Actions([ActionButton("Workbench 怎么登录？", @ToAssistant("Workbench 怎么登录？"), true), ActionButton("打开版块列表", @OpenUrl("/"))])`
