import { flushSync } from 'react-dom'

/*
 * State changes that are not navigations (folding the list, switching a tab, the theme) animate
 * through the same View Transitions as the stage: the change is rendered synchronously inside
 * the transition's update callback, so the browser can snapshot before and after.
 */

type Doc = Document & {
	startViewTransition?: (update: () => void) => { finished: Promise<void> }
}

function reducedMotion(): boolean {
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Runs `update` (which sets React state) inside a view transition, or directly where the browser
 * has none or the visitor asked for reduced motion. `motion` names the transition on
 * `<html data-stage-motion>` for its stylesheet; the stage's own value comes back afterwards.
 */
export function withViewTransition(update: () => void, motion = 'state'): void {
	const doc = document as Doc
	if (doc.startViewTransition === undefined || reducedMotion()) {
		update()
		return
	}
	const root = document.documentElement
	const previous = root.dataset.stageMotion
	root.dataset.stageMotion = motion
	const transition = doc.startViewTransition(() => {
		flushSync(update)
	})
	void transition.finished.finally(() => {
		if (root.dataset.stageMotion === motion) {
			if (previous === undefined) delete root.dataset.stageMotion
			else root.dataset.stageMotion = previous
		}
	})
}

/**
 * Switches the theme with the new colours spreading out in a circle from `origin` (the swatch
 * that was pressed). The whole page is one snapshot for it: `data-stage-motion="theme"` turns the
 * panes' own transition names off.
 */
export function withThemeReveal(update: () => void, origin: { x: number; y: number }): void {
	const root = document.documentElement
	const radius = Math.hypot(
		Math.max(origin.x, window.innerWidth - origin.x),
		Math.max(origin.y, window.innerHeight - origin.y),
	)
	root.style.setProperty('--reveal-x', `${origin.x}px`)
	root.style.setProperty('--reveal-y', `${origin.y}px`)
	root.style.setProperty('--reveal-r', `${radius}px`)
	withViewTransition(update, 'theme')
}
