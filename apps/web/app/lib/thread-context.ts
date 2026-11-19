import type { ThreadDetailDto } from '@pluxum/domain'
import { createContext, useContext } from 'react'

/**
 * The thread a post is shown in, with what the viewer may do there, for components deep inside a
 * post (an extension's menu item needs to know who started the thread). Null outside a thread page.
 */
export const ThreadContext = createContext<Pick<ThreadDetailDto, 'thread' | 'can'> | null>(null)

export function useThreadContext(): Pick<ThreadDetailDto, 'thread' | 'can'> | null {
	return useContext(ThreadContext)
}
