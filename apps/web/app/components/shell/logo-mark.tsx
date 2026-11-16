import { useId } from 'react'

// The Pluxum mark from the brand file (Figma "Pluxum" › Brand Assets › Logo Mark): three bars, a
// thread and its replies, on a circle. `dark` is the primary mark for light backgrounds; `light`
// goes on dark backgrounds.
const TONES = {
	dark: {
		circle: '#2E3440',
		bars: [
			['#ECEFF4', '#8FBCBB', 1],
			['#8FBCBB', '#81A1C1', 0.9],
			['#81A1C1', '#5E81AC', 0.85],
		],
	},
	light: {
		circle: '#ECEFF4',
		bars: [
			['#3B4252', '#5E81AC', 1],
			['#5E81AC', '#81A1C1', 0.95],
			['#81A1C1', '#88C0D0', 0.9],
		],
	},
} as const

const BARS = [
	{ x: 123.5, y: 151, width: 265 },
	{ x: 181, y: 233.5, width: 170 },
	{ x: 181, y: 316, width: 110 },
] as const

export function LogoMark({ tone, className }: { tone: keyof typeof TONES; className?: string }) {
	// Gradient ids are document-wide, so each mark on the page needs its own.
	const id = `logo${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
	const { circle, bars } = TONES[tone]
	return (
		<svg viewBox="0 0 512 512" fill="none" aria-hidden className={className}>
			<rect width="512" height="512" rx="256" fill={circle} />
			{BARS.map((bar, i) => (
				<rect
					key={bar.x + bar.y}
					x={bar.x}
					y={bar.y}
					width={bar.width}
					height="45"
					rx="22.5"
					fill={`url(#${id}-${i})`}
					fillOpacity={bars[i][2]}
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
						<stop stopColor={bars[i][0]} />
						<stop offset="1" stopColor={bars[i][1]} />
					</linearGradient>
				))}
			</defs>
		</svg>
	)
}
