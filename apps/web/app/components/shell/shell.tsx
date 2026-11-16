import type { MetaDto } from '@pluxum/domain'
import { Link, useLocation } from 'react-router'

import { PaletteTrigger } from '../palette/palette-trigger'
import { RAIL_WIDTH, StageMotionSync, useStage } from '../stage/stage'
import { Notice } from '../ui/display'
import { ShellSlots } from '../../slots/slots'
import { siteOf } from '../../lib/site'
import { LogoMark } from './logo-mark'
import { SiteFooter } from './site-footer'
import { UserMenu } from './user-menu'

// Reasons forum-api appends to `/?login=` when a login could not be completed.
const LOGIN_ERRORS: Readonly<Record<string, string>> = {
	rejected: '登录没有完成，请重试。',
	unavailable: '登录服务暂时不可用，请稍后再试。',
}

/** Width of the reading column for standard standalone pages. */
export const CONTENT_WIDTH = 'mx-auto w-full max-w-[1040px] px-4'

/** Top bar, page column and footer around every page, error pages included. */
export function Shell({ meta, children }: { meta: MetaDto | null; children: React.ReactNode }) {
	const location = useLocation()
	const here = location.pathname + location.search
	const searchParams = new URLSearchParams(location.search)
	const loginError = LOGIN_ERRORS[searchParams.get('login') ?? '']
	// Which columns and how tall: every page declares its part through `handle.stage`.
	const stage = useStage()
	const isSplitStage = stage.split
	const siteName = siteOf({ meta }).name
	const mainClass = isSplitStage
		? 'flex min-h-0 w-full flex-1 flex-col'
		: `${CONTENT_WIDTH} flex-1 py-5 lg:py-8`
	return (
		<div
			className={`flex min-h-screen flex-col${isSplitStage ? ' lg:h-dvh lg:overflow-hidden' : ''}`}
		>
			<StageMotionSync />
			<a
				href="#main"
				className="bg-accent text-page sr-only z-50 px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
			>
				跳到正文
			</a>
			<header className="border-line-soft bg-sunken sticky top-0 z-30 shrink-0 border-b [view-transition-name:site-header]">
				{/* Full width. Where the category column shows, the brand cell is as wide as that column and
				    shares its edge line, so the logo sits over the column's icons and one vertical runs
				    from the bar down the page. */}
				{/* The bar's controls are a step larger than the page's, and it keeps more air at the edges. */}
				<div className="h-bar flex w-full items-center pr-5 [--h-control:40px] [--icon:20px] lg:pr-8">
					<div
						className={`flex h-full shrink-0 items-center gap-3 pl-5 lg:pl-[22px] ${
							stage.nav ? `${RAIL_WIDTH} border-line-soft lg:border-r` : ''
						}`}
					>
						<Link
							to="/"
							viewTransition
							aria-label={`${siteName} 首页`}
							className="text-ink-strong flex shrink-0 items-center gap-2 font-bold"
						>
							<LogoMark className="size-8 shrink-0" />
							<span className="text-heading max-md:hidden">{siteName}</span>
						</Link>
					</div>
					<div className="ml-auto flex items-center gap-1">
						<PaletteTrigger />
						<ShellSlots meta={meta} />
						<UserMenu meta={meta} here={here} />
					</div>
				</div>
			</header>
			<main id="main" className={mainClass}>
				{loginError !== undefined && (
					<Notice tone="danger" className={isSplitStage ? 'mx-4 mt-3 lg:mx-6' : 'mb-4'}>
						{loginError}
					</Notice>
				)}
				{children}
			</main>
			{!isSplitStage ? (
				<SiteFooter />
			) : (
				// The category column carries the footer on wide screens; a page beside it still needs one on phones.
				stage.depth === 0 && (
					<div className="lg:hidden">
						<SiteFooter />
					</div>
				)
			)}
		</div>
	)
}
