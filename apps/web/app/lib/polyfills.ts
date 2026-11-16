/**
 * Runtime APIs newer than the build target (vite.config.ts) that the app or its dependencies call.
 * Vendor browsers on tablets and phones often ship an older Chromium; without these a call throws
 * during hydration. Each one only fills a gap and never replaces a native implementation.
 */

function define(target: object, name: string, value: unknown) {
	if (name in target) return
	Object.defineProperty(target, name, { value, writable: true, configurable: true })
}

function at(this: ArrayLike<unknown>, index: number) {
	const length = this.length
	const relative = Math.trunc(index) || 0
	const k = relative < 0 ? length + relative : relative
	return k < 0 || k >= length ? undefined : this[k]
}
define(Array.prototype, 'at', at)
define(String.prototype, 'at', function (this: string, index: number) {
	return at.call(this, index)
})
const typedArrayPrototype: object = Object.getPrototypeOf(Int8Array.prototype)
define(typedArrayPrototype, 'at', at)

define(Object, 'hasOwn', (object: object, key: PropertyKey) =>
	Object.prototype.hasOwnProperty.call(object, key),
)

define(Array.prototype, 'findLast', function <
	T,
>(this: T[], predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: unknown) {
	for (let i = this.length - 1; i >= 0; i--) {
		if (predicate.call(thisArg, this[i], i, this)) return this[i]
	}
	return undefined
})
define(Array.prototype, 'findLastIndex', function <
	T,
>(this: T[], predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: unknown) {
	for (let i = this.length - 1; i >= 0; i--) {
		if (predicate.call(thisArg, this[i], i, this)) return i
	}
	return -1
})
define(Array.prototype, 'toSorted', function <T>(this: T[], compare?: (a: T, b: T) => number) {
	// oxlint-disable-next-line unicorn/no-array-sort -- this is the fallback for toSorted itself.
	return this.slice().sort(compare)
})
define(Array.prototype, 'toReversed', function (this: unknown[]) {
	// oxlint-disable-next-line unicorn/no-array-reverse -- this is the fallback for toReversed itself.
	return this.slice().reverse()
})

if (typeof AbortSignal !== 'undefined') {
	define(AbortSignal, 'timeout', (ms: number) => {
		const controller = new AbortController()
		setTimeout(() => controller.abort(new DOMException('signal timed out', 'TimeoutError')), ms)
		return controller.signal
	})
}
