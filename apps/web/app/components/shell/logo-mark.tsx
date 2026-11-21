import { useId } from 'react'
import { useRouteLoaderData } from 'react-router'
import { siteOf } from '../../lib/site'
import type { loader as rootLoader } from '../../root'

// The Pluxum mark from the brand file (Figma "Pluxum" › Brand Assets › Logo Mark): three bars, a
// thread and its replies, on a circle. The bars keep the brand gradients; the circle is the
// theme's `--c-logo-disc`, so the mark belongs to whichever theme it sits in. The bars were drawn
// for the dark primary disc and stay legible on every theme's disc.
const BARS = [
	{ x: 123.5, y: 151, width: 265, from: '#ECEFF4', to: '#8FBCBB', opacity: 1 },
	{ x: 181, y: 233.5, width: 170, from: '#8FBCBB', to: '#81A1C1', opacity: 0.9 },
	{ x: 181, y: 316, width: 110, from: '#81A1C1', to: '#5E81AC', opacity: 0.85 },
] as const

export function LogoMark({ className }: { className?: string }) {
	// Gradient ids are document-wide, so each mark on the page needs its own.
	const id = `logo${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
	return (
		<svg viewBox="0 0 512 512" fill="none" aria-hidden className={className}>
			<rect width="512" height="512" rx="256" fill="var(--c-logo-disc, #2E3440)" />
			{BARS.map((bar, i) => (
				<rect
					key={bar.x + bar.y}
					x={bar.x}
					y={bar.y}
					width={bar.width}
					height="45"
					rx="22.5"
					fill={`url(#${id}-${i})`}
					fillOpacity={bar.opacity}
				/>
			))}
			<defs>
				{BARS.map((bar, i) => (
					<linearGradient
						key={bar.x + bar.y}
						id={`${id}-${i}`}
						x1={bar.x}
						x2={bar.x + bar.width}
						y1="0"
						y2="0"
						gradientUnits="userSpaceOnUse"
					>
						<stop stopColor={bar.from} />
						<stop offset="1" stopColor={bar.to} />
					</linearGradient>
				))}
			</defs>
		</svg>
	)
}

/**
 * The forum's mark: the logo uploaded in Workbench (Forum Core › 品牌), or the Pluxum mark when
 * none is. Used wherever the brand appears in the shell.
 */
export function BrandMark({ className }: { className?: string }) {
	const logo = siteOf(useRouteLoaderData<typeof rootLoader>('root')).brand.logo
	if (logo === null) return <LogoMark className={className} />
	return <img src={logo} alt="" aria-hidden className={`object-contain ${className ?? ''}`} />
}
