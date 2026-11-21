import type { MetaDto } from '@pluxum/domain'
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { Link, useLocation } from 'react-router'

import { PaletteTrigger } from '../palette/palette-trigger'
import { StageMotionSync, useStage } from '../stage/stage'
import { Notice } from '../ui/display'
import { ShellSlots } from '../../slots/slots'
import { siteOf } from '../../lib/site'
import { BrandMark } from './logo-mark'
import { SiteFooter } from './site-footer'
import { UserMenu } from './user-menu'

// Reasons forum-api appends to `/?login=` when a login could not be completed.
const LOGIN_ERRORS: Readonly<Record<string, MessageDescriptor>> = {
	rejected: msg`登录没有完成，请重试。`,
	unavailable: msg`登录服务暂时不可用，请稍后再试。`,
}

/** Width of the reading column for standard standalone pages. */
export const CONTENT_WIDTH = 'mx-auto w-full max-w-[1040px] px-4'

/** Top bar, page column and footer around every page, error pages included. */
export function Shell({ meta, children }: { meta: MetaDto | null; children: React.ReactNode }) {
	const { t, i18n } = useLingui()
	const location = useLocation()
	const here = location.pathname + location.search
	const searchParams = new URLSearchParams(location.search)
	const loginErrorMessage = LOGIN_ERRORS[searchParams.get('login') ?? '']
	const loginError = loginErrorMessage === undefined ? undefined : i18n._(loginErrorMessage)
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
				<Trans>跳到正文</Trans>
			</a>
			{/* Wide screens with the rail have no top bar: the rail carries the way home, search and the
			    account, and each pane opens with a head of its own. Phones, and pages without the rail
			    (error pages), keep it. */}
			<header
				className={`border-line-soft bg-sunken sticky top-0 z-30 shrink-0 border-b [view-transition-name:site-header] [@media(max-height:500px)_and_(pointer:coarse)]:static ${stage.nav ? 'lg:hidden' : ''}`}
			>
				{/* The bar's controls are a step larger than the page's, and it keeps more air at the edges. */}
				<div className="h-bar flex w-full items-center pr-5 pl-5 [--h-control:40px] [--icon:20px] lg:pr-8 lg:pl-[22px]">
					<Link
						to="/"
						viewTransition
						aria-label={t`${siteName} 首页`}
						className="text-ink-strong flex shrink-0 items-center gap-2 font-bold"
					>
						<BrandMark className="size-8 shrink-0" />
						<span className="text-heading max-md:hidden">{siteName}</span>
					</Link>
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
