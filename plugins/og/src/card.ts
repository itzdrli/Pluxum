import type { Node } from '@pluxel/plugin-takumi'

/** What one thread's social card shows. */
export type ThreadCard = Readonly<{
	site: string
	category: string
	/** The topic's title, or a note's opening words. */
	heading: string
	/** A note has no title: its words are shown smaller, as a quote. */
	note: boolean
	author: string
	/** `YYYY-MM-DD`. */
	date: string
	replyCount: number
}>

export const CARD_WIDTH = 1200
export const CARD_HEIGHT = 630

/** Code points of a note's words kept on the card; three lines hold fewer anyway. */
export const NOTE_CHARS = 140

const INK = '#ECEFF4'
const INK_WEAK = '#D8DEE9'
const MUTED = '#4C566A'
const ACCENT = '#88C0D0'

// The brand mark (docs/brand/lockup-on-dark.svg), light disc on the dark card.
const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none"><rect width="128" height="128" rx="64" fill="#ECEFF4"/><rect x="30.875" y="37.75" width="66.25" height="11.25" rx="5.625" fill="url(#a)"/><rect x="45.25" y="58.375" width="42.5" height="11.25" rx="5.625" fill="url(#b)" fill-opacity="0.95"/><rect x="45.25" y="79" width="27.5" height="11.25" rx="5.625" fill="url(#c)" fill-opacity="0.9"/><defs><linearGradient id="a" x1="30.875" y1="0" x2="97.125" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#3B4252"/><stop offset="1" stop-color="#5E81AC"/></linearGradient><linearGradient id="b" x1="45.25" y1="0" x2="87.75" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#5E81AC"/><stop offset="1" stop-color="#81A1C1"/></linearGradient><linearGradient id="c" x1="45.25" y1="0" x2="72.75" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#81A1C1"/><stop offset="1" stop-color="#88C0D0"/></linearGradient></defs></svg>`
const MARK_SRC = `data:image/svg+xml;base64,${Buffer.from(MARK_SVG).toString('base64')}`

/** Plain text from a post's sanitized HTML, whitespace collapsed. */
export function plainText(html: string): string {
	return html
		.replaceAll(/<[^>]*>/g, ' ')
		.replaceAll(/&(?:#(\d+)|#x([\da-f]+)|(amp|lt|gt|quot|apos|nbsp));/gi, (_, dec, hex, name) => {
			if (dec) return String.fromCodePoint(Number(dec))
			if (hex) return String.fromCodePoint(Number.parseInt(hex, 16))
			const named: Record<string, string> = {
				amp: '&',
				lt: '<',
				gt: '>',
				quot: '"',
				apos: "'",
				nbsp: ' ',
			}
			return named[String(name).toLowerCase()] ?? ''
		})
		.replaceAll(/\s+/g, ' ')
		.trim()
}

/** At most `max` code points, with an ellipsis when cut. */
export function clip(text: string, max: number): string {
	const chars = Array.from(text)
	return chars.length > max ? `${chars.slice(0, max).join('').trimEnd()}…` : text
}

type Style = NonNullable<Node['style']>

function textNode(value: string, style: Style): Node {
	return { type: 'text', text: value, style }
}

/** The card as a Takumi node tree: text is taken literally, nothing is parsed as markup. */
/** `markSrc` is the forum's uploaded logo as a data URL; without one the Pluxum mark is drawn. */
export function threadCardNode(card: ThreadCard, fontFamily: string, markSrc = MARK_SRC): Node {
	const meta = [card.date, ...(card.replyCount > 0 ? [`${card.replyCount} 回复`] : [])]
	return {
		type: 'container',
		style: {
			display: 'flex',
			flexDirection: 'column',
			width: '100%',
			height: '100%',
			padding: '72px 80px 64px',
			backgroundColor: '#2E3440',
			color: INK,
			fontFamily,
			position: 'relative',
		},
		children: [
			{
				type: 'container',
				style: { display: 'flex', alignItems: 'center', gap: 20 },
				children: [
					{ type: 'image', src: markSrc, width: 56, height: 56, style: { width: 56, height: 56 } },
					textNode(card.site, { fontSize: 32, fontWeight: 700 }),
					{
						type: 'container',
						style: {
							display: 'flex',
							marginLeft: 'auto',
							maxWidth: 560,
							flexShrink: 0,
							padding: '6px 22px',
							border: `2px solid ${MUTED}`,
							borderRadius: 999,
						},
						children: [
							textNode(card.category, {
								fontSize: 26,
								color: ACCENT,
								lineClamp: 1,
								textOverflow: 'ellipsis',
							}),
						],
					},
				],
			},
			{
				type: 'container',
				style: { display: 'flex', flexGrow: 1, alignItems: 'center' },
				children: [
					textNode(card.heading, {
						fontSize: card.note ? 48 : 66,
						fontWeight: card.note ? 400 : 700,
						lineHeight: 1.3,
						lineClamp: 3,
						textOverflow: 'ellipsis',
						overflowWrap: 'anywhere',
						overflow: 'hidden',
						color: card.note ? INK_WEAK : INK,
					}),
				],
			},
			{
				type: 'container',
				style: { display: 'flex', alignItems: 'center', gap: 16, fontSize: 28, color: INK_WEAK },
				children: [
					textNode(card.author, { color: INK, fontWeight: 700 }),
					...meta.flatMap((part) => [textNode('·', { color: MUTED }), textNode(part, {})]),
				],
			},
			{
				type: 'container',
				style: {
					position: 'absolute',
					left: 0,
					right: 0,
					bottom: 0,
					height: 10,
					backgroundImage: 'linear-gradient(90deg, #5E81AC, #81A1C1, #88C0D0)',
				},
			},
		],
	}
}
