import { isEntityId, parseFloorNumber } from '@pluxum/domain'
import { data, redirect } from 'react-router'
import { t } from '@lingui/core/macro'

import type { Route } from './+types/thread-shortlink'
import { i18nFromRequest } from '../lib/i18n.server'
import { forumApi, orThrow } from '../lib/forum-api.server'

// Shortlink `/t/:id` resolves the thread's canonical category slug and ref, then redirects into
// the nested stage URL. `/t/:id/:floor` also lands on the page that shows that floor, with the
// floor it replies inside unfolded; the second segment may be a floor number or a post id (links
// that only know the post id, e.g. moderation reports).
export async function loader({ request, params }: Route.LoaderArgs) {
	const detail = orThrow(await forumApi.thread(request, params.id, 1))
	const url = new URL(request.url)
	const base = `/c/${detail.category.slug}/t/${detail.thread.ref}`
	if (params.floor === undefined) return redirect(`${base}${url.search}`)

	let floor = parseFloorNumber(params.floor)
	if (floor === null && isEntityId(params.floor)) {
		const located = orThrow(await forumApi.postLocation(request, params.floor))
		if (located.threadRef === detail.thread.ref) floor = located.postNumber
	}
	if (floor === null) throw data(t(await i18nFromRequest(request))`楼层不存在。`, { status: 404 })
	const shown = orThrow(await forumApi.floorLocation(request, detail.thread.ref, floor))
	if (shown.page > 1) url.searchParams.set('page', String(shown.page))
	else url.searchParams.delete('page')
	if (shown.parentFloor !== null) url.searchParams.set('expand', String(shown.parentFloor))
	return redirect(`${base}${url.search}#post-${floor}`)
}
