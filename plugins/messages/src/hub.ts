// In-process state of the messages plugin: long polls waiting for a member's next message, which
// conversation each member has open, and how fast each member writes. One process serves the
// forum (like the core's activity bus); several would need this relayed between them.

type Waiter = (woken: boolean) => void

/** Wakes members' long polls when a message reaches them. */
export class MessageHub {
	private readonly waiters = new Map<string, Set<Waiter>>()
	private count = 0

	constructor(private readonly limit: number) {}

	/** Resolves true on the next message for `userId`, false after `timeoutMs` or when full. */
	wait(userId: string, timeoutMs: number): Promise<boolean> {
		if (this.count >= this.limit) return Promise.resolve(false)
		return new Promise((resolve) => {
			let settled = false
			const waiter: Waiter = (woken) => {
				if (settled) return
				settled = true
				clearTimeout(timer)
				const set = this.waiters.get(userId)
				set?.delete(waiter)
				if (set?.size === 0) this.waiters.delete(userId)
				this.count -= 1
				resolve(woken)
			}
			const timer = setTimeout(() => waiter(false), timeoutMs)
			this.count += 1
			let set = this.waiters.get(userId)
			if (!set) this.waiters.set(userId, (set = new Set()))
			set.add(waiter)
		})
	}

	publish(userIds: Iterable<string>): void {
		for (const userId of userIds) {
			for (const waiter of this.waiters.get(userId) ?? []) waiter(true)
		}
	}

	/** Ends every wait (the plugin is stopping). */
	close(): void {
		for (const set of this.waiters.values()) for (const waiter of set) waiter(false)
	}
}

/** Which conversation each member is looking at, as their polls say, for a short while. */
export class Presence {
	private readonly open = new Map<string, Readonly<{ conversationId: string; until: number }>>()

	/** The member is looking at the conversation until `until` (ms since epoch). */
	see(userId: string, conversationId: string | undefined, until: number): void {
		if (conversationId === undefined) this.open.delete(userId)
		else this.open.set(userId, { conversationId, until })
	}

	isLooking(userId: string, conversationId: string, now = Date.now()): boolean {
		const entry = this.open.get(userId)
		if (entry === undefined) return false
		if (entry.until < now) {
			this.open.delete(userId)
			return false
		}
		return entry.conversationId === conversationId
	}
}

/** At most `limit` events per member in any `windowMs`; answers how long to wait when over. */
export class RateWindow {
	private readonly events = new Map<string, number[]>()

	constructor(
		private readonly limit: number,
		private readonly windowMs: number,
	) {}

	/** Records the event and returns 0, or returns the seconds until one is allowed. */
	take(userId: string, now = Date.now()): number {
		const recent = (this.events.get(userId) ?? []).filter((at) => at > now - this.windowMs)
		if (recent.length >= this.limit) {
			this.events.set(userId, recent)
			return Math.max(1, Math.ceil(((recent[0] ?? now) + this.windowMs - now) / 1000))
		}
		recent.push(now)
		this.events.set(userId, recent)
		if (this.events.size > 10_000) {
			for (const [id, times] of this.events) {
				if ((times.at(-1) ?? 0) <= now - this.windowMs) this.events.delete(id)
			}
		}
		return 0
	}
}
