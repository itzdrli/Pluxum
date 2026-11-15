import { data } from 'react-router'

import type { Route } from './+types/ext-action'
import { forumApi } from '../lib/forum-api.server'

export type ExtActionResult =
	| Readonly<{ ok: true; value: unknown }>
	| Readonly<{ ok: false; error: string }>

// Slot components submit JSON here with a fetcher. Going through a route action, rather than
// calling the API from the browser, makes React Router reload the page's data afterwards, so
// everything the extension attached to the page is fresh again.
export async function action({ request, params }: Route.ActionArgs) {
	let input: unknown
	try {
		input = await request.json()
	} catch {
		const failure: ExtActionResult = { ok: false, error: '请求内容无法解析。' }
		return data(failure, { status: 400 })
	}
	const result = await forumApi.extAction(request, params.extId, params.action, input)
	if (!result.ok) {
		const failure: ExtActionResult = { ok: false, error: result.error.message }
		return data(failure, { status: result.status })
	}
	const success: ExtActionResult = { ok: true, value: result.value }
	return success
}
