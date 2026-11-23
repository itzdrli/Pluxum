// Which floor the post shortcuts (L to like, A to accept) act on: the one under the pointer, or the
// one holding the keyboard focus, whichever moved last. Each floor's slot asks only whether it is
// the target, so moving between floors re-renders the two floors involved and nothing else.

import { useSyncExternalStore } from 'react'

let target: number | null = null
const listeners = new Set<() => void>()
let detach: (() => void) | null = null

function floorOf(node: EventTarget | null): number | null {
	if (!(node instanceof Element)) return null
	const floor = node.closest('li[id^="post-"]')
	if (floor === null) return null
	const number = Number(floor.id.slice('post-'.length))
	return Number.isInteger(number) ? number : null
}

function set(next: number | null) {
	if (next === target) return
	target = next
	for (const listener of listeners) listener()
}

const onPointer = (event: Event) => set(floorOf(event.target))
const onFocus = (event: Event) => {
	const floor = floorOf(event.target)
	if (floor !== null) set(floor)
}

function attach() {
	document.addEventListener('pointerover', onPointer, { passive: true })
	document.addEventListener('focusin', onFocus)
	return () => {
		document.removeEventListener('pointerover', onPointer)
		document.removeEventListener('focusin', onFocus)
	}
}

function subscribe(listener: () => void) {
	listeners.add(listener)
	detach ??= attach()
	return () => {
		listeners.delete(listener)
		if (listeners.size === 0) {
			detach?.()
			detach = null
			target = null
		}
	}
}

/** Whether floor `number` is the one the post shortcuts act on right now. */
export function useIsTargetPost(number: number): boolean {
	return useSyncExternalStore(
		subscribe,
		() => target === number,
		() => false,
	)
}
