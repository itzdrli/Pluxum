import Lenis from 'lenis'
import { type RefObject, useEffect } from 'react'

/*
 * Smooth wheel scrolling (Lenis) for mouse and trackpad. Touch keeps the platform's own scrolling,
 * and so does anyone who asks the system for reduced motion.
 *
 * Wide screens scroll each pane on its own, so every pane gets its own instance (`useSmoothScroll`),
 * and the window gets one for the pages and widths where the document itself scrolls
 * (`WindowSmoothScroll`). A pane at its top or bottom hands the wheel on to the window, which then
 * does nothing when the document can't scroll.
 */

const instances = new Map<HTMLElement | Window, Lenis>()

function wanted(): boolean {
	return window.matchMedia('(pointer: fine) and (prefers-reduced-motion: no-preference)').matches
}

/**
 * A modal (palette, dialog, sheet) locks the page's scroll with `overflow: hidden`; a script can
 * still scroll it, so Lenis stands aside while one is open and the wheel stays with the modal.
 */
function pageLocked(): boolean {
	return (
		document.documentElement.style.overflow === 'hidden' ||
		document.body.style.overflow === 'hidden'
	)
}

function create(wrapper: HTMLElement | Window): Lenis {
	const element = wrapper instanceof Window ? undefined : wrapper
	return new Lenis({
		wrapper,
		...(element === undefined ? {} : { content: element, eventsTarget: element }),
		autoRaf: true,
		lerp: 0.12,
		// Lists, menus, code blocks and the editor scroll on their own, natively.
		allowNestedScroll: true,
		// Panes change content without changing size (a new thread, more replies): read the
		// scrollable height live rather than from a resize observer.
		naiveDimensions: true,
		// A click on a link to another page stops a glide still under way, so it can't fight the
		// scroll reset of the page it opens.
		stopInertiaOnNavigate: true,
		virtualScroll: () => !pageLocked(),
	})
}

/** Smooth wheel scrolling inside a scrolling pane, while `enabled`. */
export function useSmoothScroll(ref: RefObject<HTMLElement | null>, enabled = true) {
	useEffect(() => {
		const element = ref.current
		if (!enabled || element === null || !wanted()) return undefined
		const lenis = create(element)
		instances.set(element, lenis)
		return () => {
			instances.delete(element)
			lenis.destroy()
		}
	}, [ref, enabled])
}

/** Smooth wheel scrolling of the document. Draws nothing. */
export function WindowSmoothScroll() {
	useEffect(() => {
		if (!wanted()) return undefined
		const lenis = create(window)
		instances.set(window, lenis)
		return () => {
			instances.delete(window)
			lenis.destroy()
		}
	}, [])
	return null
}

/**
 * Jumps a pane to `top` at once, stopping any glide first: a native `scrollTo` alone would be
 * undone by a glide still under way.
 */
export function jumpPaneTo(element: HTMLElement, top: number) {
	const lenis = instances.get(element)
	if (lenis === undefined) {
		element.scrollTo({ top })
		return
	}
	lenis.scrollTo(top, { immediate: true, force: true })
}
