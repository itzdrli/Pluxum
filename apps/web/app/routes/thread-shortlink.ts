import { redirect } from 'react-router'

import type { Route } from './+types/thread-shortlink'
import { forumApi, orThrow } from '../lib/forum-api.server'

// Shortlink `/t/:id` resolves the thread's category slug and redirects into the nested stage URL.
export async function loader({ request, params }: Route.LoaderArgs) {
	const detail = orThrow(await forumApi.thread(request, params.id, 1))
	const { search } = new URL(request.url)
	return redirect(`/c/${detail.category.slug}/t/${detail.thread.id}${search}`)
}
