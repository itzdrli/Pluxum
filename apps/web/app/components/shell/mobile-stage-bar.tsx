import type { CategoryDto } from '@pluxum/domain'
import { buttonVariants } from '@heroui/react'
import {
	ArrowDown,
	ArrowLeft,
	ArrowUpToLine,
	Check,
	ChevronsUpDown,
	Hash,
	LayoutGrid,
	Lock,
	LogIn,
	MessageSquarePlus,
	Plus,
	Send,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Form, useNavigation, useRouteLoaderData } from 'react-router'

import type { loader as forumStageLoader } from '../../routes/forum-stage'
import { Composer } from '../composer/composer'
import { MobileBarSpacer, StageLink, useStage } from '../stage/stage'
import { BottomSheet } from '../ui/bottom-sheet'
import { Button, ButtonAnchor, ButtonLink, IconButton } from '../ui/button'
import { FormError, Notice } from '../ui/display'
import { ActionMenu, type MenuItem } from '../ui/overlay'

// Every bar shares one view-transition name, so switching bars cross-fades in place.
const BAR_CLASS =
	'border-line bg-panel fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] [view-transition-name:stage-bar] lg:hidden'

/** Decides whether the mobile floor-jump control scrolls back to top or down to the latest post. */
export function resolveFloorJumpDirection(scrollY: number): 'top' | 'bottom' {
	return scrollY > 240 ? 'top' : 'bottom'
}

/**
 * Computes whether the mobile reply sheet should stay open across thread switches or post count
 * changes: closes on thread change or when `nextTotal > prevTotal`, keeps open on validation errors.
 */
export function nextMobileReplySheetOpen({
	isOpen,
	threadChanged,
	prevTotal,
	nextTotal,
}: {
	isOpen: boolean
	threadChanged: boolean
	prevTotal: number
	nextTotal: number
}): boolean {
	if (threadChanged || nextTotal > prevTotal) return false
	return isOpen
}

/** Depth 1 (`/c/:slug`) mobile thumb-zone bar with Home link, Category Switcher sheet, and post CTA. */
export function MobileCategoryBar({
	category,
	canCreateThread,
	loginToPost,
}: {
	category: CategoryDto
	canCreateThread: boolean
	loginToPost: string | undefined
}) {
	const stageData = useRouteLoaderData<typeof forumStageLoader>('routes/forum-stage')
	const categories = stageData?.categories ?? [category]
	const [switcherOpen, setSwitcherOpen] = useState(false)

	useEffect(() => {
		if (!switcherOpen) return undefined
		const mql = window.matchMedia('(min-width: 1024px)')
		const onChange = (event: MediaQueryListEvent) => {
			if (event.matches) setSwitcherOpen(false)
		}
		mql.addEventListener('change', onChange)
		return () => mql.removeEventListener('change', onChange)
	}, [switcherOpen])

	return (
		<>
			<MobileBarSpacer />
			<nav aria-label="版块快捷栏" className={BAR_CLASS}>
				<StageLink
					to="/"
					prefetch="intent"
					className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'shrink-0' })}
				>
					<LayoutGrid aria-hidden />
					<span>首页</span>
				</StageLink>

				<button
					type="button"
					onClick={() => setSwitcherOpen(true)}
					aria-label="切换版块"
					className="border-line bg-control text-ink-strong hover:bg-hover active:bg-pressed flex h-8 min-w-0 flex-1 cursor-pointer items-center justify-between gap-1.5 rounded-[2px] border px-2.5 text-[13px] font-bold"
				>
					<span className="flex min-w-0 items-center gap-1.5">
						<Hash aria-hidden size={14} className="text-accent shrink-0" />
						<span className="truncate">{category.name}</span>
					</span>
					<ChevronsUpDown aria-hidden size={14} className="text-ink-weak shrink-0" />
				</button>

				{canCreateThread ? (
					<ButtonLink
						to={`/c/${category.slug}/new`}
						prefetch="intent"
						tone="primary"
						size="sm"
						className="shrink-0"
					>
						<Plus aria-hidden />
						发帖
					</ButtonLink>
				) : (
					loginToPost !== undefined && (
						<ButtonAnchor href={loginToPost} tone="primary" size="sm" className="shrink-0">
							<LogIn aria-hidden />
							登录
						</ButtonAnchor>
					)
				)}
			</nav>

			<BottomSheet
				isOpen={switcherOpen}
				onOpenChange={setSwitcherOpen}
				title="切换版块"
				bodyClassName="min-h-0 flex-1 overflow-y-auto py-1.5"
			>
				{(close) => (
					<ul className="divide-line divide-y">
						{categories.map((cat) => {
							const isActive = cat.slug === category.slug
							return (
								<li key={cat.id}>
									<StageLink
										to={`/c/${cat.slug}`}
										prefetch="intent"
										onClick={close}
										aria-current={isActive ? 'page' : undefined}
										className={`flex min-h-11 items-center gap-2.5 border-l-2 px-4 py-2.5 transition-colors ${
											isActive
												? 'border-l-accent bg-selected text-ink-strong font-bold'
												: 'text-ink hover:bg-hover hover:text-ink-strong border-l-transparent'
										}`}
									>
										<Hash
											aria-hidden
											size={14}
											className={isActive ? 'text-accent shrink-0' : 'text-ink-weak shrink-0'}
										/>
										<span className="min-w-0 flex-1 truncate">{cat.name}</span>
										<span className="text-ink-weak shrink-0 text-[12px] tabular-nums">
											{cat.threadCount} 主题
										</span>
										{isActive && <Check aria-hidden size={14} className="text-accent shrink-0" />}
									</StageLink>
								</li>
							)
						})}
					</ul>
				)}
			</BottomSheet>
		</>
	)
}

/**
 * Depth 2 mobile thumb-zone bar of a thread, whichever list opened it: back to that list, reply
 * sheet trigger, floor jump, and thread menu.
 */
export function MobileThreadBar({
	threadId,
	postsTotal,
	canReply,
	locked,
	loginHref,
	replyError,
	bodyMax,
	menu,
}: {
	threadId: string
	postsTotal: number
	canReply: boolean
	locked: boolean
	loginHref: string | undefined
	replyError: string | undefined
	bodyMax: number | undefined
	menu: readonly MenuItem[]
}) {
	const stage = useStage()
	const submitting = useNavigation().formData?.get('intent') === 'reply'
	const [replyOpen, setReplyOpen] = useState(false)
	const [trackedThreadId, setTrackedThreadId] = useState(threadId)
	const [prevTotal, setPrevTotal] = useState(postsTotal)

	if (trackedThreadId !== threadId || prevTotal !== postsTotal) {
		const nextOpen = nextMobileReplySheetOpen({
			isOpen: replyOpen,
			threadChanged: trackedThreadId !== threadId,
			prevTotal,
			nextTotal: postsTotal,
		})
		if (trackedThreadId !== threadId) setTrackedThreadId(threadId)
		if (prevTotal !== postsTotal) setPrevTotal(postsTotal)
		if (nextOpen !== replyOpen) setReplyOpen(nextOpen)
	}

	useEffect(() => {
		if (!replyOpen) return undefined
		const mql = window.matchMedia('(min-width: 1024px)')
		const onChange = (event: MediaQueryListEvent) => {
			if (event.matches) setReplyOpen(false)
		}
		mql.addEventListener('change', onChange)
		return () => mql.removeEventListener('change', onChange)
	}, [replyOpen])

	const [jumpDirection, setJumpDirection] = useState<'top' | 'bottom'>('bottom')
	useEffect(() => {
		const mql = window.matchMedia('(min-width: 1024px)')
		const update = () => {
			if (mql.matches) return
			setJumpDirection(resolveFloorJumpDirection(window.scrollY))
		}
		update()
		window.addEventListener('scroll', update, { passive: true })
		return () => window.removeEventListener('scroll', update)
	}, [])

	const handleFloorJump = () => {
		const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
			? 'auto'
			: 'smooth'
		if (jumpDirection === 'top') {
			window.scrollTo({ top: 0, behavior })
			return
		}
		const posts = document.querySelectorAll<HTMLElement>('li[id^="post-"]')
		const lastPost = posts[posts.length - 1]
		const target = lastPost ?? document.querySelector<HTMLElement>('main')
		if (target !== null && typeof target.scrollIntoView === 'function') {
			target.scrollIntoView({ block: 'end', behavior })
		} else {
			window.scrollTo({ top: document.documentElement.scrollHeight, behavior })
		}
	}

	return (
		<>
			<MobileBarSpacer />
			<nav aria-label="主题快捷栏" className={BAR_CLASS}>
				<StageLink
					to={stage.listHref ?? '/'}
					prefetch="intent"
					className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'shrink-0' })}
				>
					<ArrowLeft aria-hidden />
					<span>{stage.backLabel}</span>
				</StageLink>

				{canReply ? (
					<button
						type="button"
						onClick={() => setReplyOpen(true)}
						className="border-line bg-page text-ink-weak hover:border-ink-weak hover:text-ink flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-[2px] border px-2.5 text-[13px]"
					>
						<MessageSquarePlus aria-hidden size={14} className="text-accent shrink-0" />
						<span className="truncate">写回复…</span>
					</button>
				) : locked ? (
					<span className="text-ink-weak flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 text-[12px]">
						<Lock aria-hidden size={13} className="shrink-0" />
						<span className="truncate">主题已锁定</span>
					</span>
				) : loginHref !== undefined ? (
					<ButtonAnchor href={loginHref} tone="primary" size="sm" className="min-w-0 flex-1">
						<LogIn aria-hidden />
						登录后回复
					</ButtonAnchor>
				) : (
					<div className="flex-1" />
				)}

				<div className="flex shrink-0 items-center gap-1">
					<IconButton
						label={jumpDirection === 'top' ? '回到顶部' : '跳到底部'}
						tone="ghost"
						size="sm"
						onPress={handleFloorJump}
					>
						{jumpDirection === 'top' ? <ArrowUpToLine aria-hidden /> : <ArrowDown aria-hidden />}
					</IconButton>
					{menu.length > 0 && <ActionMenu label="主题操作" items={menu} size="sm" />}
				</div>
			</nav>

			{canReply && (
				<BottomSheet isOpen={replyOpen} onOpenChange={setReplyOpen} title="发表回复">
					{(close) => (
						<Form method="post" className="flex flex-col gap-3">
							<input type="hidden" name="intent" value="reply" />
							{locked && <Notice icon={Lock}>主题已锁定，只有版主和管理员还能回复。</Notice>}
							<FormError message={replyError} />
							<Composer
								key={`${threadId}-${postsTotal}`}
								label="回复内容"
								hideLabel
								required
								maxLength={bodyMax}
								rows={4}
								placeholder="写下你的回复"
								autoFocus
								deferRich
							/>
							<div className="flex justify-end gap-2">
								<Button tone="ghost" size="sm" onPress={close}>
									取消
								</Button>
								<Button type="submit" tone="primary" size="sm" isPending={submitting}>
									<Send aria-hidden />
									发表回复
								</Button>
							</div>
						</Form>
					)}
				</BottomSheet>
			)}
		</>
	)
}
