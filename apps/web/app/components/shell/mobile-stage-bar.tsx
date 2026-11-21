import type { CategoryDto } from '@pluxum/domain'
import { buttonVariants } from '@heroui/react'
import { Trans, useLingui } from '@lingui/react/macro'
import { ArrowLeft, Check, ChevronsUpDown, Hash, Lock, PenLine, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Form, useNavigation, useRouteLoaderData } from 'react-router'

import type { loader as forumStageLoader } from '../../routes/forum-stage'
import { Composer } from '../composer/composer'
import { MobileBarSpacer, StageLink, useStage } from '../stage/stage'
import { BottomSheet } from '../ui/bottom-sheet'
import { Button, ButtonAnchor, ButtonLink } from '../ui/button'
import { FormError, Notice } from '../ui/display'
import { ActionMenu, type MenuItem } from '../ui/overlay'
import { STREAM_LABEL } from '../../lib/stream'

// Every bar shares one view-transition name, so switching bars cross-fades in place. Its controls
// are all `md` (40px on touch screens): one height across the bar, no per-control sizes.
const BAR_CLASS =
	'stage-bar border-line bg-panel fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] [view-transition-name:stage-bar] lg:hidden'

/** The bar's back control: an arrow only, its destination named for assistive technology. */
function BarBack({ to, label }: { to: string; label: string }) {
	return (
		<StageLink
			to={to}
			prefetch="intent"
			aria-label={label}
			title={label}
			className={buttonVariants({
				variant: 'ghost',
				isIconOnly: true,
				className: 'shrink-0',
			})}
		>
			<ArrowLeft aria-hidden />
		</StageLink>
	)
}

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

/** Depth 1 (`/c/:slug`) mobile thumb-zone bar: back home, category switcher sheet, post CTA. */
export function MobileCategoryBar({
	category,
	canCreateThread,
	loginToPost,
}: {
	category: CategoryDto
	canCreateThread: boolean
	loginToPost: string | undefined
}) {
	const { t, i18n } = useLingui()
	const stageData = useRouteLoaderData<typeof forumStageLoader>('routes/forum-stage')
	const categories = stageData?.categories ?? [category]
	const categoryName = category.kind === 'stream' ? i18n._(STREAM_LABEL) : category.name
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
			<nav aria-label={t`版块快捷栏`} className={BAR_CLASS}>
				<BarBack to="/" label={t`返回首页`} />

				<button
					type="button"
					onClick={() => setSwitcherOpen(true)}
					aria-label={t`切换版块，当前：${categoryName}`}
					className="border-line bg-control text-ink-strong hover:bg-hover active:bg-pressed h-control flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-1.5 rounded-[2px] border px-3 text-ui font-bold"
				>
					<span className="flex min-w-0 items-center gap-1.5">
						<Hash aria-hidden size={14} className="text-accent shrink-0" />
						<span className="truncate">{categoryName}</span>
					</span>
					<ChevronsUpDown aria-hidden size={14} className="text-ink-weak shrink-0" />
				</button>

				{canCreateThread ? (
					<ButtonLink
						to={`/c/${category.slug}/new`}
						prefetch="intent"
						tone="primary"
						className="shrink-0"
					>
						<Plus aria-hidden />
						<Trans>发帖</Trans>
					</ButtonLink>
				) : (
					loginToPost !== undefined && (
						<ButtonAnchor href={loginToPost} tone="primary" className="shrink-0">
							<Trans>登录</Trans>
						</ButtonAnchor>
					)
				)}
			</nav>

			<BottomSheet
				isOpen={switcherOpen}
				onOpenChange={setSwitcherOpen}
				title={t`切换版块`}
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
										<span className="text-ink-weak shrink-0 text-meta tabular-nums">
											{cat.threadCount}
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
 * sheet trigger, and one menu holding the floor jump and the thread's actions.
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
	const { t, i18n } = useLingui()
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

	// Jumping through the floors is an occasional move, so it sits in the menu with the rest.
	const barMenu: MenuItem[] = [
		{
			id: 'floor-jump',
			label: jumpDirection === 'top' ? t`回到顶部` : t`跳到最新回复`,
			onAction: handleFloorJump,
		},
		...menu,
	]

	return (
		<>
			<MobileBarSpacer />
			<nav aria-label={t`主题快捷栏`} className={BAR_CLASS}>
				<BarBack to={stage.listHref ?? '/'} label={i18n._(stage.backLabel)} />

				{canReply ? (
					<button
						type="button"
						onClick={() => setReplyOpen(true)}
						className="border-line bg-page text-ink-weak hover:border-ink-weak hover:text-ink h-control flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-[2px] border px-3 text-ui"
					>
						<PenLine aria-hidden size={14} className="shrink-0" />
						<span className="truncate">
							<Trans>写回复…</Trans>
						</span>
					</button>
				) : locked ? (
					<span className="text-ink-weak h-control flex min-w-0 flex-1 items-center justify-center gap-1.5 text-meta">
						<Lock aria-hidden size={13} className="shrink-0" />
						<span className="truncate">
							<Trans>主题已锁定</Trans>
						</span>
					</span>
				) : loginHref !== undefined ? (
					<ButtonAnchor href={loginHref} tone="primary" className="min-w-0 flex-1">
						<Trans>登录后回复</Trans>
					</ButtonAnchor>
				) : (
					<div className="flex-1" />
				)}

				<ActionMenu label={t`主题操作`} items={barMenu} size="md" />
			</nav>

			{canReply && (
				<BottomSheet isOpen={replyOpen} onOpenChange={setReplyOpen} title={t`发表回复`}>
					{(close) => (
						<Form method="post" className="flex flex-col gap-3">
							<input type="hidden" name="intent" value="reply" />
							{locked && (
								<Notice icon={Lock}>
									<Trans>主题已锁定，仅版主可回复</Trans>
								</Notice>
							)}
							<FormError message={replyError} />
							<Composer
								key={`${threadId}-${postsTotal}`}
								label={t`回复内容`}
								hideLabel
								required
								maxLength={bodyMax}
								rows={4}
								placeholder={t`写下你的回复`}
								autoFocus
								deferRich
							/>
							{/* Pinned to the sheet's bottom edge, so a short screen (a phone held sideways) never
							    scrolls the send button out of reach. */}
							<div className="border-line-soft bg-panel sticky bottom-0 -mx-4 -mb-3 flex justify-end gap-2 border-t px-4 py-3">
								<Button tone="ghost" onPress={close}>
									<Trans>取消</Trans>
								</Button>
								<Button type="submit" tone="primary" isPending={submitting}>
									<Trans>发表回复</Trans>
								</Button>
							</div>
						</Form>
					)}
				</BottomSheet>
			)}
		</>
	)
}
