import { ArrowDown, ArrowUp } from 'lucide-react'
import { useRef, useState } from 'react'

import { Button } from '../ui/button'

// Stuck, the prompt clears the sticky head above it (the phone's top bar, or the pane's head on
// wide screens); in place, it straddles the top edge of the list it belongs to.
const BELOW_HEAD =
	'top-[calc(var(--h-bar)+12px+var(--h-control-sm)/2)] lg:top-[calc(var(--h-pane-bar)+12px+var(--h-control-sm)/2)]'
const BELOW_HEAD_MARGIN =
	'scroll-mt-[calc(var(--h-bar)+12px)] lg:scroll-mt-[calc(var(--h-pane-bar)+12px)]'

/**
 * The 「N 条新内容」 / 「N 条新回复」 prompt: it floats at the top of a list (or of a thread's
 * posts) while others have written something since the page loaded, and pressing it runs
 * `onLoad`. Place it right above the list. It takes no room, so nothing moves under the reader
 * when it appears. Keep it mounted and pass `label: null` while
 * there is nothing new. `reveal="top"`: once loaded, a reader scrolled past the top is taken back
 * there, where new list entries appear.
 */
export function NewActivityPrompt({
	label,
	onLoad,
	reveal = 'none',
}: {
	label: string | null
	onLoad: () => Promise<void>
	reveal?: 'top' | 'none'
}) {
	const anchor = useRef<HTMLDivElement>(null)
	const [loading, setLoading] = useState(false)
	const Icon = reveal === 'top' ? ArrowUp : ArrowDown

	const load = async () => {
		setLoading(true)
		try {
			await onLoad()
		} finally {
			setLoading(false)
		}
		const top = anchor.current
		if (reveal !== 'top' || top === null) return
		const margin = Number.parseFloat(getComputedStyle(top).scrollMarginTop) || 0
		if (top.getBoundingClientRect().top < margin) {
			top.scrollIntoView({ block: 'start', behavior: 'smooth' })
		}
	}

	return (
		<>
			<div ref={anchor} aria-hidden className={BELOW_HEAD_MARGIN} />
			<div
				aria-live="polite"
				className={`pointer-events-none sticky z-20 flex h-0 justify-center ${BELOW_HEAD}`}
			>
				{label !== null && (
					<Button
						tone="primary"
						size="sm"
						isPending={loading}
						onPress={() => void load()}
						className="shadow-overlay pointer-events-auto -translate-y-1/2"
						data-testid="new-activity"
					>
						<Icon aria-hidden />
						{label}
					</Button>
				)}
			</div>
		</>
	)
}
