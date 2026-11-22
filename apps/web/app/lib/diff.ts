// A text diff for a post's edit history: Myers' O(ND) algorithm over words, so a change in
// Chinese marks the characters that changed rather than the whole line.

export type DiffPart = Readonly<{ kind: 'same' | 'added' | 'removed'; text: string }>

type Step = 'same' | 'added' | 'removed'

/** A single Han / kana character, a run of letters and digits, a run of spaces, or one other character. */
const TOKEN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}_]+|\s+|[^\s]/gu

/** Edits beyond this many make the word diff give way to a line diff, then to a replacement. */
const MAX_EDITS = 1000

export function tokenize(text: string): string[] {
	return text.match(TOKEN) ?? []
}

const WORD = /[\p{L}\p{N}_]/u
const SINGLE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u

/** Whether a cut before `text[at]` would split a token. */
function joins(text: string, at: number): boolean {
	if (at <= 0 || at >= text.length) return false
	const code = text.charCodeAt(at)
	if (code >= 0xdc00 && code <= 0xdfff) return true
	const before = text[at - 1] ?? ''
	const after = text[at] ?? ''
	return WORD.test(before) && WORD.test(after) && !SINGLE.test(before) && !SINGLE.test(after)
}

function lines(text: string): string[] {
	return text.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

/**
 * The shortest edit script from `a` to `b`, or null when it needs more than `maxEdits` steps.
 * Keeps only the band of each round's frontier it can reach, so memory grows with the edits.
 */
function myers(a: readonly string[], b: readonly string[], maxEdits: number): Step[] | null {
	const n = a.length
	const m = b.length
	const max = n + m
	const offset = max + 1
	const v = new Int32Array(2 * max + 3)
	// trace[d]: the frontier before round d, for diagonals -d … d.
	const trace: Int32Array[] = []
	for (let d = 0; d <= Math.min(max, maxEdits); d++) {
		trace.push(v.slice(offset - d, offset + d + 1))
		for (let k = -d; k <= d; k += 2) {
			const down = k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))
			let x = down ? (v[offset + k + 1] ?? 0) : (v[offset + k - 1] ?? 0) + 1
			let y = x - k
			while (x < n && y < m && a[x] === b[y]) {
				x++
				y++
			}
			v[offset + k] = x
			if (x >= n && y >= m) return backtrack(trace, n, m, d)
		}
	}
	return null
}

function backtrack(trace: readonly Int32Array[], n: number, m: number, edits: number): Step[] {
	const steps: Step[] = []
	let x = n
	let y = m
	for (let d = edits; d > 0; d--) {
		const frontier = trace[d]
		const at = (k: number) => frontier?.[k + d] ?? 0
		const k = x - y
		const down = k === -d || (k !== d && at(k - 1) < at(k + 1))
		const prevK = down ? k + 1 : k - 1
		const prevX = at(prevK)
		const prevY = prevX - prevK
		while (x > prevX && y > prevY) {
			steps.push('same')
			x--
			y--
		}
		steps.push(down ? 'added' : 'removed')
		x = prevX
		y = prevY
	}
	while (x > 0 && y > 0) {
		steps.push('same')
		x--
		y--
	}
	return steps.toReversed()
}

function partsOf(a: readonly string[], b: readonly string[], steps: readonly Step[]): DiffPart[] {
	const parts: DiffPart[] = []
	let i = 0
	let j = 0
	for (const step of steps) {
		const text = step === 'added' ? b[j++] : a[i++]
		if (step === 'same') j++
		const last = parts.at(-1)
		if (last?.kind === step) parts[parts.length - 1] = { kind: step, text: last.text + text }
		else parts.push({ kind: step, text: text ?? '' })
	}
	return parts
}

/** What changed from `before` to `after`, as runs of unchanged, removed and added text. */
export function diffText(before: string, after: string): DiffPart[] {
	if (before === after) return before === '' ? [] : [{ kind: 'same', text: before }]
	// The unchanged start and end need no search.
	let start = 0
	const shorter = Math.min(before.length, after.length)
	while (start < shorter && before[start] === after[start]) start++
	// Never cut inside a surrogate pair or a word: back up to a token boundary on both sides.
	while (start > 0 && (joins(before, start) || joins(after, start))) start--
	let end = 0
	while (
		end < shorter - start &&
		before[before.length - 1 - end] === after[after.length - 1 - end]
	) {
		end++
	}
	while (end > 0 && (joins(before, before.length - end) || joins(after, after.length - end))) end--
	const head = before.slice(0, start)
	const tail = end > 0 ? before.slice(before.length - end) : ''
	const a = before.slice(start, before.length - end)
	const b = after.slice(start, after.length - end)

	let middle: DiffPart[] | null = null
	for (const split of [tokenize, lines]) {
		const left = split(a)
		const right = split(b)
		const steps = myers(left, right, MAX_EDITS)
		if (steps !== null) {
			middle = partsOf(left, right, steps)
			break
		}
	}
	middle ??= [
		...(a === '' ? [] : [{ kind: 'removed' as const, text: a }]),
		...(b === '' ? [] : [{ kind: 'added' as const, text: b }]),
	]
	const parts: DiffPart[] = []
	for (const part of [
		{ kind: 'same' as const, text: head },
		...middle,
		{ kind: 'same' as const, text: tail },
	]) {
		if (part.text === '') continue
		const last = parts.at(-1)
		if (last?.kind === part.kind)
			parts[parts.length - 1] = { kind: part.kind, text: last.text + part.text }
		else parts.push(part)
	}
	return parts
}
