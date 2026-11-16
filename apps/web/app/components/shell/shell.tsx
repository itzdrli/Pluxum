import { LIMITS, type MetaDto } from '@pluxum/domain'
import { Search } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Form, Link, NavLink, useLocation } from 'react-router'

import { RAIL_WIDTH, StageMotionSync, useStage } from '../stage/stage'
import { ButtonLink } from '../ui/button'
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

function navClass({ isActive }: { isActive: boolean }): string {
	return `h-control flex items-center rounded-[2px] px-2.5 ${isActive ? 'bg-selected text-ink-strong' : 'text-ink-weak hover:bg-hover hover:text-ink-strong'}`
}

/** Top bar, page column and footer around every page, error pages included. */
export function Shell({ meta, children }: { meta: MetaDto | null; children: React.ReactNode }) {
	const location = useLocation()
	const here = location.pathname + location.search
	const searchParams = new URLSearchParams(location.search)
	const loginError = LOGIN_ERRORS[searchParams.get('login') ?? '']
	// Which columns and how tall: every page declares its part through `handle.stage`.
	const stage = useStage()
	const isSplitStage = stage.split
	const isSearchPage = location.pathname === '/search' || location.pathname.startsWith('/search/')
	const siteName = siteOf({ meta }).name
	const searchAvailable = meta?.search.available === true
	const headerQuery = isSearchPage ? (searchParams.get('q') ?? '') : ''
	// "版块" stays highlighted on the home page and while reading inside a category.
	const inForum = location.pathname === '/' || stage.nav || location.pathname.startsWith('/t/')
	const mainClass = isSplitStage
		? 'flex min-h-0 w-full flex-1 flex-col'
		: `${CONTENT_WIDTH} flex-1 py-4 lg:py-6`
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
				<div className="h-bar flex w-full items-center pr-4 lg:pr-6">
					<div
						className={`flex h-full shrink-0 items-center gap-3 pl-4 lg:pl-[14px] ${
							stage.nav ? `${RAIL_WIDTH} border-line-soft lg:border-r` : ''
						}`}
					>
						<Link
							to="/"
							viewTransition
							aria-label={`${siteName} 首页`}
							className="text-ink-strong flex shrink-0 items-center gap-2 font-bold"
						>
							<LogoMark className="size-6 shrink-0" />
							<span className="text-title max-md:hidden">{siteName}</span>
						</Link>
					</div>
					{/* Phones reach the forum through the logo; the one nav entry is for wide screens. */}
					<nav aria-label="主导航" className="flex items-center gap-1 px-3 max-md:hidden">
						<NavLink to="/" viewTransition className={() => navClass({ isActive: inForum })} end>
							版块
						</NavLink>
					</nav>
					<div className="ml-auto flex items-center gap-1">
						{searchAvailable && !isSearchPage && (
							<>
								<HeaderSearch query={headerQuery} />
								<ButtonLink
									to="/search"
									tone="ghost"
									aria-label="搜索"
									title="搜索"
									className="button--icon-only md:hidden"
								>
									<Search aria-hidden />
								</ButtonLink>
							</>
						)}
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

/** The header's search box on wide screens; `/` focuses it from anywhere outside a field. */
function HeaderSearch({ query }: { query: string }) {
	const input = useRef<HTMLInputElement>(null)
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== '/' || event.defaultPrevented || event.metaKey || event.ctrlKey) return
			const active = document.activeElement
			if (
				active instanceof HTMLElement &&
				(active.tagName === 'INPUT' ||
					active.tagName === 'TEXTAREA' ||
					active.tagName === 'SELECT' ||
					active.isContentEditable)
			) {
				return
			}
			event.preventDefault()
			input.current?.focus()
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [])
	return (
		<Form
			method="get"
			action="/search"
			role="search"
			className="relative mr-1 flex items-center max-md:hidden"
		>
			<Search
				aria-hidden
				size={14}
				className="text-ink-weak pointer-events-none absolute left-2.5"
			/>
			<input
				ref={input}
				key={query}
				type="search"
				name="q"
				defaultValue={query}
				maxLength={LIMITS.searchQueryMax}
				placeholder="搜索"
				aria-label="搜索论坛"
				aria-keyshortcuts="/"
				className="peer border-line bg-page text-ink-strong placeholder:text-ink-weak/60 hover:border-ink-weak focus:border-accent h-control w-48 rounded-[2px] border pr-8 pl-8 text-ui outline-none lg:w-64"
			/>
			<kbd
				aria-hidden
				className="border-line text-ink-weak pointer-events-none absolute right-2 inline-flex h-5 min-w-5 items-center justify-center rounded-[2px] border px-1 font-mono text-micro peer-focus:hidden"
			>
				/
			</kbd>
		</Form>
	)
}
