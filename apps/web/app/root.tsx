import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router'

import type { Route } from './+types/root'
import './app.css'

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

export default function App() {
	return (
		<div className="flex min-h-screen flex-col">
			<header className="border-border bg-surface flex h-12 items-center border-b px-5">
				<a href="/" className="text-foreground text-base font-bold">
					Pluxel Forum
				</a>
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
		message = error.status === 404 ? '404' : '错误'
		details = error.status === 404 ? '页面不存在。' : error.statusText || details
	} else if (import.meta.env.DEV && error instanceof Error) {
		details = error.message
		stack = error.stack
	}
	return (
		<main className="mx-auto max-w-4xl px-5 py-12">
			<h1 className="text-xl font-bold">{message}</h1>
			<p className="text-muted mt-2">{details}</p>
			{stack && (
				<pre className="mt-4 overflow-x-auto p-4 text-sm">
					<code>{stack}</code>
				</pre>
			)}
		</main>
	)
}
