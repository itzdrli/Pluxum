import type { ThreadDto } from '@pluxum/domain'
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'

import { Timestamp } from '../../components/ui/display'

type Floor = Readonly<{
	number: string
	author: string
	time: string
	/** The first heading of the floor, else the start of its text; empty for a deleted floor. */
	gist: string
	element: HTMLElement
}>

const GIST_LENGTH = 40

/** The floors of the posts on screen, in reading order. */
function scanFloors(): Floor[] {
	return [...document.querySelectorAll<HTMLElement>('li[data-floor]')].map((element) => {
		const body = element.querySelector<HTMLElement>('.post-body')
		const heading = body?.querySelector('h2, h3, h4')?.textContent?.trim()
		const text = (heading ?? body?.textContent ?? '').replace(/\s+/g, ' ').trim()
		return {
			number: element.dataset.floor ?? '',
			author: element.dataset.floorAuthor ?? '',
			time: element.dataset.floorTime ?? '',
			gist: Array.from(text).slice(0, GIST_LENGTH).join(''),
			element,
		}
	})
}

/** The pane the posts scroll in: the page itself on a phone, a column of the stage on a laptop. */
function scrollParent(element: HTMLElement): HTMLElement | null {
	for (let node = element.parentElement; node !== null; node = node.parentElement) {
		const { overflowY } = getComputedStyle(node)
		if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
			return node
		}
	}
	return null
}

/**
 * `thread.sidebar`: the floors of the thread page as a timeline. Each floor is a dot on a vertical
 * line with its number, author, age and a line of what it says; the floor being read is lit as the
 * page scrolls and a click jumps to a floor. It draws nothing for a page with a single floor, and
 * the column then folds away.
 */
export function OutlineSidebar({ thread }: { thread: ThreadDto }) {
	const { search } = useLocation()
	// Another thread, another page of it or a new post means other floors: start over.
	return <Timeline key={`${thread.id}:${thread.lastPostAt}:${search}`} />
}

function Timeline() {
	const [floors, setFloors] = useState<readonly Floor[]>([])
	const [active, setActive] = useState(0)
	const list = useRef<HTMLUListElement>(null)

	// The posts are in the DOM once this commits; read them on the next frame.
	useEffect(() => {
		const frame = requestAnimationFrame(() => setFloors(scanFloors()))
		return () => cancelAnimationFrame(frame)
	}, [])

	useEffect(() => {
		const first = floors[0]
		if (first === undefined) return undefined
		const root = scrollParent(first.element)
		const seen = new Set<number>()
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					const index = floors.findIndex((floor) => floor.element === entry.target)
					if (index < 0) continue
					if (entry.isIntersecting) seen.add(index)
					else seen.delete(index)
				}
				// The last floor in the reading band; with none, the one passed last keeps its light.
				if (seen.size > 0) setActive(Math.max(...seen))
			},
			{ root, rootMargin: '0px 0px -65% 0px' },
		)
		for (const floor of floors) observer.observe(floor.element)

		// Short floors at the end of the page never reach the band: the bottom means the last one.
		const scroller = root ?? document.scrollingElement ?? document.documentElement
		const target: HTMLElement | Window = root ?? window
		const onScroll = () => {
			if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
				setActive(floors.length - 1)
			}
		}
		target.addEventListener('scroll', onScroll, { passive: true })
		return () => {
			observer.disconnect()
			target.removeEventListener('scroll', onScroll)
		}
	}, [floors])

	// Keep the lit floor in view when the timeline is taller than the window.
	useEffect(() => {
		const row = list.current?.children[active]
		if (row instanceof HTMLElement) row.scrollIntoView({ block: 'nearest' })
	}, [active])

	if (floors.length < 2) return null
	return (
		<nav aria-label="楼层时间线" className="flex flex-col gap-2">
			<p className="section-label">楼层</p>
			<ul
				ref={list}
				className="before:bg-line relative flex max-h-[calc(100dvh-10rem)] flex-col overflow-y-auto before:absolute before:top-2 before:bottom-2 before:left-[3px] before:w-px"
			>
				{floors.map((floor, index) => {
					const lit = index === active
					return (
						<li key={floor.number}>
							<button
								type="button"
								onClick={() => floor.element.scrollIntoView({ behavior: 'smooth', block: 'start' })}
								aria-current={lit ? 'location' : undefined}
								className={`group/floor relative block w-full cursor-pointer py-2 pr-1 pl-5 text-left text-meta leading-snug ${
									lit ? 'text-ink-strong' : 'text-ink-weak hover:text-ink-strong'
								}`}
							>
								<span
									aria-hidden
									className={`absolute top-3.5 left-0 size-[7px] rounded-full transition-colors ${
										lit
											? 'bg-accent ring-page ring-2'
											: 'bg-line group-hover/floor:bg-ink-weak ring-page ring-2'
									}`}
								/>
								<span className="flex items-baseline gap-1.5">
									<span className={`tabular-nums ${lit ? 'text-accent font-bold' : ''}`}>
										#{floor.number}
									</span>
									<span className="min-w-0 flex-1 truncate">{floor.author}</span>
									<Timestamp iso={floor.time} className="shrink-0 text-micro opacity-80" />
								</span>
								{floor.gist !== '' && (
									<span className="text-ink-weak mt-0.5 block truncate text-micro">
										{floor.gist}
									</span>
								)}
							</button>
						</li>
					)
				})}
			</ul>
		</nav>
	)
}
