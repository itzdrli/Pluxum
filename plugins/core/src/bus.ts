/**
 * The forum's message bus, after Discourse's MessageBus: writes publish on channels, and long-poll
 * requests wait on the channels their page shows until something is published there or they time
 * out. A message carries no content: a woken waiter counts again in the database from the instant
 * its page is current to, so that instant is its cursor, nothing can be missed between two polls
 * and permissions apply exactly as for a plain count.
 *
 * One process holds the waiters, which is how the forum runs. Several processes behind one
 * address would need the publishes relayed between them (Redis pub/sub), behind this same API.
 */

/** Where a write is published: every list, its category's list, its thread. */
export type BusChannel = 'list' | `category:${string}` | `thread:${string}`

export type WaitOutcome = 'message' | 'timeout' | 'aborted' | 'full'

type Waiter = Readonly<{ channels: readonly BusChannel[]; wake: (outcome: WaitOutcome) => void }>

export class ActivityBus {
	private readonly waiters = new Map<BusChannel, Set<Waiter>>()
	private count = 0

	/** `limit`: waiters held at once; past it a wait ends at once with `full`. */
	constructor(private readonly limit: number) {}

	/** How many requests are waiting now. */
	size(): number {
		return this.count
	}

	publish(channels: readonly BusChannel[]): void {
		const woken = new Set<Waiter>()
		for (const channel of channels) {
			for (const waiter of this.waiters.get(channel) ?? []) woken.add(waiter)
		}
		for (const waiter of woken) waiter.wake('message')
	}

	/** Resolves on the first message on any of `channels`, after `timeoutMs`, or on abort. */
	wait(
		channels: readonly BusChannel[],
		timeoutMs: number,
		signal?: AbortSignal,
	): Promise<WaitOutcome> {
		if (signal?.aborted) return Promise.resolve('aborted')
		if (this.count >= this.limit) return Promise.resolve('full')
		return new Promise((resolve) => {
			let settled = false
			const waiter: Waiter = {
				channels,
				wake: (outcome) => {
					if (settled) return
					settled = true
					clearTimeout(timer)
					signal?.removeEventListener('abort', onAbort)
					for (const channel of channels) {
						const set = this.waiters.get(channel)
						set?.delete(waiter)
						if (set?.size === 0) this.waiters.delete(channel)
					}
					this.count -= 1
					resolve(outcome)
				},
			}
			const onAbort = () => waiter.wake('aborted')
			const timer = setTimeout(() => waiter.wake('timeout'), timeoutMs)
			signal?.addEventListener('abort', onAbort, { once: true })
			this.count += 1
			for (const channel of channels) {
				let set = this.waiters.get(channel)
				if (!set) this.waiters.set(channel, (set = new Set()))
				set.add(waiter)
			}
		})
	}

	/** Ends every wait (the plugin is stopping), answering each as if it timed out. */
	close(): void {
		const all = new Set<Waiter>()
		for (const set of this.waiters.values()) for (const waiter of set) all.add(waiter)
		for (const waiter of all) waiter.wake('timeout')
	}
}

/** The channels a write lands on. */
export function channelsOf(categoryId: string, threadId: string): BusChannel[] {
	return ['list', `category:${categoryId}`, `thread:${threadId}`]
}
