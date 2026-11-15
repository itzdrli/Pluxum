import { LIMITS, type MetaDto } from '@pluxum/domain'
import { Search } from 'lucide-react'
import { Form, Link, NavLink, useLocation } from 'react-router'

import { Notice } from '../ui/display'
import { ShellSlots } from '../../slots/slots'
import { ThemePicker } from './theme-picker'
import { UserMenu } from './user-menu'

// Reasons forum-api appends to `/?login=` when a login could not be completed.
const LOGIN_ERRORS: Readonly<Record<string, string>> = {
	rejected: '登录没有完成，请重试。',
	unavailable: '登录服务暂时不可用，请稍后再试。',
}

/** Width of the reading column for standard standalone pages. */
export const CONTENT_WIDTH = 'mx-auto w-full max-w-[1040px] px-4'

function navClass({ isActive }: { isActive: boolean }): string {
	return `flex h-8 items-center rounded-[2px] px-2.5 ${isActive ? 'bg-selected text-ink-strong' : 'text-ink-weak hover:bg-hover hover:text-ink-strong'}`
}

/** Top bar, page column and footer around every page, error pages included. */
export function Shell({ meta, children }: { meta: MetaDto | null; children: React.ReactNode }) {
	const location = useLocation()
	const here = location.pathname + location.search
	const searchParams = new URLSearchParams(location.search)
	const loginError = LOGIN_ERRORS[searchParams.get('login') ?? '']
	const isHome = location.pathname === '/'
	const isSplitStage = location.pathname.startsWith('/c/')
	const isSearchPage = location.pathname === '/search'
	const searchAvailable = meta?.search.available === true
	const headerQuery = isSearchPage ? (searchParams.get('q') ?? '') : ''
	// "版块" stays highlighted while reading inside a category or thread.
	const inForum = isHome || isSplitStage || location.pathname.startsWith('/t/')
	const mainClass = isSplitStage
		? 'flex min-h-0 w-full flex-1 flex-col'
		: isHome
			? 'mx-auto w-full max-w-[1520px] flex-1 px-4 py-6 lg:px-6'
			: `${CONTENT_WIDTH} flex-1 py-6`
	return (
		<div
			className={`flex min-h-screen flex-col${isSplitStage ? ' lg:h-dvh lg:overflow-hidden' : ''}`}
		>
			<a
				href="#main"
				className="bg-accent text-page sr-only z-50 px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
			>
				跳到正文
			</a>
			<header className="border-line bg-panel sticky top-0 z-30 shrink-0 border-b">
				<div className="mx-auto flex h-12 w-full max-w-[1760px] items-center gap-3 px-4 lg:px-6">
					<Link to="/" className="text-ink-strong flex items-center gap-2 font-bold">
						<span
							aria-hidden
							className="bg-accent text-page flex size-6 items-center justify-center rounded-[2px] text-[13px]"
						>
							P
						</span>
						<span className="hidden text-[14px] min-[400px]:inline">Pluxum</span>
					</Link>
					<nav aria-label="主导航" className="ml-2 flex items-center gap-1">
						<NavLink to="/" className={() => navClass({ isActive: inForum })} end>
							版块
						</NavLink>
						{searchAvailable && (
							<NavLink to="/search" className={navClass}>
								搜索
							</NavLink>
						)}
					</nav>
					<div className="ml-auto flex items-center gap-1.5">
						{searchAvailable && !isSearchPage && (
							<Form
								method="get"
								action="/search"
								role="search"
								className="relative hidden items-center md:flex"
							>
								<Search
									aria-hidden
									size={14}
									className="text-ink-weak pointer-events-none absolute left-2.5"
								/>
								<input
									key={headerQuery}
									type="search"
									name="q"
									defaultValue={headerQuery}
									maxLength={LIMITS.searchQueryMax}
									placeholder="搜索帖子…"
									aria-label="搜索论坛"
									className="border-line bg-page text-ink-strong placeholder:text-ink-weak/60 hover:border-ink-weak focus:border-accent h-7 w-44 rounded-[2px] border pr-2.5 pl-8 text-[13px] outline-none lg:w-56"
								/>
							</Form>
						)}
						<ShellSlots meta={meta} />
						<ThemePicker />
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
			{!isSplitStage && (
				<footer className="border-line text-ink-weak border-t text-[12px]">
					<div className="mx-auto flex h-12 w-full max-w-[1760px] items-center justify-between px-4 lg:px-6">
						<span>Pluxum</span>
						<span>万物皆插件</span>
					</div>
				</footer>
			)}
		</div>
	)
}
