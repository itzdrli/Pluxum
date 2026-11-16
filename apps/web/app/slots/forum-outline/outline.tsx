import type { ThreadDto } from '@pluxum/domain'
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'

type Heading = Readonly<{ id: number; text: string; level: number; element: HTMLElement }>

/** The headings of the posts on screen, in reading order. Level 1 is already the thread title. */
function scanHeadings(): Heading[] {
	return [...document.querySelectorAll<HTMLElement>('.post-body h2, .post-body h3, .post-body h4')]
		.map((element, id) => ({
			id,
			text: element.textContent?.trim() ?? '',
			level: Number(element.tagName.slice(1)),
			element,
		}))
		.filter((heading) => heading.text !== '')
}

/**
 * `thread.sidebar`: the outline of a long thread, built from the headings of the posts shown. It
 * draws nothing for a thread with fewer than two, and the column then folds away. The entry of the
 * heading being read is lit as the page scrolls.
 */
export function OutlineSidebar({ thread }: { thread: ThreadDto }) {
	const { search } = useLocation()
	// Another thread, another page of it or a new post means other headings: start the outline over.
	return <Outline key={`${thread.id}:${thread.lastPostAt}:${search}`} />
}

function Outline() {
	const [headings, setHeadings] = useState<readonly Heading[]>([])
	const [active, setActive] = useState(-1)

	// The posts are in the DOM once this commits; read them on the next frame.
	useEffect(() => {
		const frame = requestAnimationFrame(() => setHeadings(scanHeadings()))
		return () => cancelAnimationFrame(frame)
	}, [])

	useEffect(() => {
		if (headings.length === 0) return undefined
		const seen = new Set<number>()
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					const id = headings.find((heading) => heading.element === entry.target)?.id
					if (id === undefined) continue
					if (entry.isIntersecting) seen.add(id)
					else seen.delete(id)
				}
				// The first heading on screen; with none, the last one passed keeps its light.
				if (seen.size > 0) setActive(Math.min(...seen))
			},
			{ rootMargin: '0px 0px -65% 0px' },
		)
		for (const heading of headings) observer.observe(heading.element)
		return () => observer.disconnect()
	}, [headings])

	if (headings.length < 2) return null
	const base = Math.min(...headings.map((heading) => heading.level))
	return (
		<nav aria-label="文章目录" className="flex flex-col gap-1.5">
			<p className="section-label">目录</p>
			<ul className="border-line-soft flex flex-col border-l">
				{headings.map((heading) => (
					<li key={heading.id}>
						<button
							type="button"
							onClick={() => heading.element.scrollIntoView({ behavior: 'smooth', block: 'start' })}
							aria-current={heading.id === active ? 'location' : undefined}
							style={{ paddingLeft: `${10 + (heading.level - base) * 12}px` }}
							className={`-ml-px block w-full cursor-pointer border-l-2 py-1 pr-1 text-left text-meta leading-snug ${
								heading.id === active
									? 'border-l-accent text-ink-strong'
									: 'text-ink-weak hover:text-ink-strong border-l-transparent'
							}`}
						>
							{heading.text}
						</button>
					</li>
				))}
			</ul>
		</nav>
	)
}
