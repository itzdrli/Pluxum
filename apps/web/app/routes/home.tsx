import { Card, Chip } from '@heroui/react'

import type { Route } from './+types/home'
import { fetchPing } from '../lib/forum-api.server'

export function meta(): Route.MetaDescriptors {
	return [{ title: 'Pluxel Forum' }, { name: 'description', content: '万物皆插件的论坛' }]
}

// Runs on the server (SSR and client navigations): reaches the Pluxel host directly.
export async function loader({ request }: Route.LoaderArgs) {
	return { api: await fetchPing(request.signal) }
}

export default function Home({ loaderData }: Route.ComponentProps) {
	const { api } = loaderData
	return (
		<Card>
			<Card.Header>
				<Card.Title>论坛前台骨架</Card.Title>
				<Card.Description>
					React Router SSR + HeroUI，API 经同源转发到 Pluxel host。
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<div className="flex items-center gap-3 text-sm">
					<span className="text-muted">API</span>
					{api.ok ? (
						<span data-testid="ping-status" className="flex items-center gap-2">
							<Chip color="success" size="sm">
								{api.ping.service} · {api.ping.status}
							</Chip>
							<code className="font-mono">{api.ping.time}</code>
						</span>
					) : (
						<span data-testid="ping-status">
							<Chip color="danger" size="sm">
								不可用：{api.reason}
							</Chip>
						</span>
					)}
				</div>
			</Card.Content>
		</Card>
	)
}
