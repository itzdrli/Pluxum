// `jose` decodes JWT segments with `Uint8Array.fromBase64(text, { alphabet: 'base64url' })` whenever
// that function exists. Node 24 does not ship it, and the Pluxel core bundle installs a fallback
// (from utilium, via zenfs) that ignores the options and decodes standard base64 only. Under that
// fallback every signature containing `-` or `_` fails to decode, so no ID token verifies.
// Each function is probed with a URL-alphabet sample and replaced only when it gets that wrong;
// a native or otherwise correct implementation is left alone. Remove once the host runs on a
// Node release with the native methods, or the fallback is fixed upstream.

type Base64Options = Readonly<{ alphabet?: string; omitPadding?: boolean }>

const SAMPLE_TEXT = '-_8'
const SAMPLE_BYTES = [0xfb, 0xff] as const

function optionsOf(value: unknown): Base64Options {
	return typeof value === 'object' && value !== null ? value : {}
}

function decode(text: string, options?: unknown): Uint8Array {
	const standard =
		optionsOf(options).alphabet === 'base64url'
			? text.replaceAll('-', '+').replaceAll('_', '/')
			: text
	const binary = atob(standard)
	const bytes = new Uint8Array(binary.length)
	for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
	return bytes
}

function encode(this: Uint8Array, options?: unknown): string {
	const { alphabet, omitPadding } = optionsOf(options)
	let binary = ''
	for (const byte of this) binary += String.fromCodePoint(byte)
	let text = btoa(binary)
	if (alphabet === 'base64url') text = text.replaceAll('+', '-').replaceAll('/', '_')
	return omitPadding ? text.replaceAll('=', '') : text
}

function decodesUrlAlphabet(): boolean {
	try {
		const decoded: unknown = Reflect.apply(Reflect.get(Uint8Array, 'fromBase64'), Uint8Array, [
			SAMPLE_TEXT,
			{ alphabet: 'base64url' },
		])
		return decoded instanceof Uint8Array && String(decoded) === String(SAMPLE_BYTES)
	} catch {
		return false
	}
}

function encodesUrlAlphabet(): boolean {
	try {
		const encoded: unknown = Reflect.apply(
			Reflect.get(Uint8Array.prototype, 'toBase64'),
			new Uint8Array(SAMPLE_BYTES),
			[{ alphabet: 'base64url', omitPadding: true }],
		)
		return encoded === SAMPLE_TEXT
	} catch {
		return false
	}
}

function install(target: object, name: string, value: unknown): void {
	Object.defineProperty(target, name, { value, writable: true, configurable: true })
}

/**
 * Replaces a present-but-wrong `Uint8Array.fromBase64` / `toBase64` with one that honours the
 * `base64url` alphabet. Absent functions stay absent (`jose` then uses its own decoder).
 * Returns the names it replaced.
 */
export function repairBase64Url(): string[] {
	const repaired: string[] = []
	if (Reflect.has(Uint8Array, 'fromBase64') && !decodesUrlAlphabet()) {
		install(Uint8Array, 'fromBase64', decode)
		repaired.push('Uint8Array.fromBase64')
	}
	if (Reflect.has(Uint8Array.prototype, 'toBase64') && !encodesUrlAlphabet()) {
		install(Uint8Array.prototype, 'toBase64', encode)
		repaired.push('Uint8Array.prototype.toBase64')
	}
	return repaired
}
