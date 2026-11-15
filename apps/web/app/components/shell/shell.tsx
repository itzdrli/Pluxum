import type { MetaDto } from '@forum/domain'
import { Link, NavLink, useLocation } from 'react-router'

import { Notice } from '../ui/display'
import { ThemePicker } from './theme-picker'
import { UserMenu } from './user-menu'

// Reasons forum-api appends to `/?login=` when a login could not be completed.
const LOGIN_ERRORS: Readonly<Record<string, string>> = {
	rejected: '登录没有完成，请重试。',
	unavailable: '登录服务暂时不可用，请稍后再试。',
}

/** Width of the reading column, shared by the top bar and the page. */
export const CONTENT_WIDTH = 'mx-auto w-full max-w-[960px] px-4'

function navClass({ isActive }: { isActive: boolean }): string {
	return `flex h-8 items-center rounded-[2px] px-2.5 ${isActive ? 'bg-selected text-ink-strong' : 'text-ink-weak hover:bg-hover hover:text-ink-strong'}`
}

/** Top bar, page column and footer around every page, error pages included. */
export function Shell({ meta, children }: { meta: MetaDto | null; children: React.ReactNode }) {
	const location = useLocation()
	const here = location.pathname + location.search
	const loginError = LOGIN_ERRORS[new URLSearchParams(location.search).get('login') ?? '']
	// "版块" stays highlighted while reading inside a category or thread.
	const inForum = location.pathname === '/' || /^\/(c|t)\//.test(location.pathname)
	return (
		<div className="flex min-h-screen flex-col">
			<a
				href="#main"
				className="bg-accent text-page sr-only z-50 px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
			>
				跳到正文
			</a>
			<header className="border-line bg-panel sticky top-0 z-30 border-b">
				<div className={`${CONTENT_WIDTH} flex h-12 items-center gap-3`}>
					<Link to="/" className="text-ink-strong flex items-center gap-2 font-bold">
						<span
							aria-hidden
							className="bg-accent text-page flex size-6 items-center justify-center rounded-[2px] text-[13px]"
						>
							P
						</span>
						<span className="hidden text-[14px] min-[400px]:inline">Pluxel Forum</span>
					</Link>
					<nav aria-label="主导航" className="ml-2 flex items-center gap-1">
						<NavLink to="/" className={() => navClass({ isActive: inForum })} end>
							版块
						</NavLink>
					</nav>
					<div className="ml-auto flex items-center gap-1">
						<ThemePicker />
						<UserMenu meta={meta} here={here} />
					</div>
				</div>
			</header>
			<main id="main" className={`${CONTENT_WIDTH} flex-1 py-6`}>
				{loginError !== undefined && (
					<Notice tone="danger" className="mb-4">
						{loginError}
					</Notice>
				)}
				{children}
			</main>
			<footer className="border-line text-ink-weak border-t text-[12px]">
				<div className={`${CONTENT_WIDTH} flex h-12 items-center justify-between`}>
					<span>Pluxel Forum</span>
					<span>万物皆插件</span>
				</div>
			</footer>
		</div>
	)
}
