// TanStack Query, on trial for the requests plugin components make themselves (settings, follow
// state, hover previews). Page data stays with the route loaders.

import { QueryClient } from '@tanstack/react-query'

export function createQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: {
				// Settings and states change only when this visitor changes them, through a mutation
				// that writes the answer back; re-reading on every focus would only add requests.
				staleTime: 60_000,
				refetchOnWindowFocus: false,
				retry: 1,
			},
		},
	})
}

/**
 * Fetches JSON from the forum API; throws on a failed request, so Query keeps no answer. The
 * shape is the caller's to check where it is not the API's own DTO.
 */
export async function getForumJson<T = unknown>(path: string, signal?: AbortSignal): Promise<T> {
	const response = await fetch(`/api/forum${path}`, {
		headers: { accept: 'application/json' },
		signal,
	})
	if (!response.ok) throw new Error(`${response.status} ${path}`)
	const body: T = await response.json()
	return body
}
