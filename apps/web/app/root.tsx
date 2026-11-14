import { Chip } from '@heroui/react'
import {
	isRouteErrorResponse,
	Link,
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
} from 'react-router'

import type { Route } from './+types/root'
import './app.css'
import { forumApi } from './lib/forum-api.server'

const ROLE_LABELS = { guest: '游客', member: '成员', moderator: '版主', admin: '管理员' } as const

// Who is browsing and what the forum allows; child routes read it through useRouteLoaderData.
export async function loader({ request }: Route.LoaderArgs) {
	const meta = await forumApi.meta(request)
	// The shell still renders when the API is down; the page below reports the failure itself.
	return { meta: meta.ok ? meta.value : null }
}

export function Layout({ children }: { children: React.ReactNode }) {
	return (
		// Dark Graphite theme only for now; HeroUI reads both the class and data-theme.
		<html lang="zh-CN" className="dark" data-theme="dark">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<Meta />
				<Links />
			</head>
			<body className="bg-background text-foreground min-h-screen font-sans antialiased">
				{children}
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	)
}

export default function App({ loaderData }: Route.ComponentProps) {
	const viewer = loaderData.meta?.viewer
	// Roles are listed weakest first; the header shows the strongest one.
	const role = viewer?.roles.at(-1)
	return (
		<div className="flex min-h-screen flex-col">
			<header className="border-border bg-surface border-b">
				<div className="mx-auto flex h-12 w-full max-w-4xl items-center justify-between px-5">
					<Link to="/" className="text-foreground text-base font-bold">
						Pluxel Forum
					</Link>
					{viewer?.user ? (
						<span data-testid="viewer" className="flex items-center gap-2 text-sm">
							{viewer.user.displayName}
							{role !== undefined && role !== 'member' && (
								<Chip size="sm" color="accent">
									{ROLE_LABELS[role]}
								</Chip>
							)}
						</span>
					) : (
						<span data-testid="viewer" className="text-muted text-sm">
							未登录
						</span>
					)}
				</div>
			</header>
			<main className="mx-auto w-full max-w-4xl px-5 py-6">
				<Outlet />
			</main>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	let message = '出错了'
	let details = '发生了意外错误。'
	let stack: string | undefined
	if (isRouteErrorResponse(error)) {
		message = String(error.status)
		// Loaders pass the forum API's own message along as the response body.
		details =
			typeof error.data === 'string' && error.data !== ''
				? error.data
				: error.status === 404
					? '页面不存在。'
					: details
	} else if (import.meta.env.DEV && error instanceof Error) {
		details = error.message
		stack = error.stack
	}
	return (
		<main className="mx-auto max-w-4xl px-5 py-12">
			<h1 className="text-xl font-bold">{message}</h1>
			<p className="text-muted mt-2">{details}</p>
			<a href="/" className="text-accent mt-4 inline-block text-sm">
				返回首页
			</a>
			{stack && (
				<pre className="mt-4 overflow-x-auto p-4 text-sm">
					<code>{stack}</code>
				</pre>
			)}
		</main>
	)
}
