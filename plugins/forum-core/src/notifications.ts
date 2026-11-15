import type { ForumNotification } from '@forum/domain'
import { EXTENSION_TIMEOUT_MS, TIMED_OUT, withTimeout } from './extensions'
import { CONTRIBUTION_ID } from './policies'

/** A delivery channel for forum notifications, contributed by an extension or bridge plugin. */
export type NotificationChannelContribution = Readonly<{
	/** Stable contribution ID, e.g. `forum-notifications.inbox` or `forum-mail.smtp`. */
	id: string
	/**
	 * Delivers one notification through this channel. Throws or rejects when delivery fails; the
	 * core isolates failures so one broken channel does not block the others.
	 */
	deliver: (notification: ForumNotification) => void | Promise<void>
}>

/**
 * Open registry of notification delivery channels. Registration is scoped to the contributor's
 * generation: the returned disposer withdraws exactly that registration.
 */
export class NotificationChannelRegistry {
	private readonly entries = new Map<string, NotificationChannelContribution>()

	register(contribution: NotificationChannelContribution): () => void {
		const { id, deliver } = contribution
		if (typeof id !== 'string' || !CONTRIBUTION_ID.test(id)) {
			throw new TypeError(`Invalid notification channel ID: ${id}`)
		}
		if (typeof deliver !== 'function') {
			throw new TypeError(`Notification channel "${id}" must provide a deliver function`)
		}
		if (this.entries.has(id)) {
			throw new Error(`Notification channel "${id}" is already registered`)
		}
		this.entries.set(id, contribution)
		return () => {
			if (this.entries.get(id) === contribution) this.entries.delete(id)
		}
	}

	ids(): string[] {
		return [...this.entries.keys()]
	}

	/**
	 * Sends a notification through every registered channel in parallel and returns the IDs of the
	 * channels that succeeded, in registration order. A channel that throws, times out or is
	 * withdrawn while delivering is left out.
	 */
	async deliver(
		notification: ForumNotification,
		onFailure: (error: unknown, channelId: string) => void,
	): Promise<string[]> {
		const channels = [...this.entries.values()]
		if (channels.length === 0) return []
		const succeeded = new Set<string>()
		await Promise.all(
			channels.map(async (channel) => {
				try {
					const outcome = await withTimeout(
						Promise.resolve().then(() => channel.deliver(notification)),
						EXTENSION_TIMEOUT_MS,
					)
					if (outcome === TIMED_OUT) throw new Error(`No answer within ${EXTENSION_TIMEOUT_MS} ms`)
					if (this.entries.get(channel.id) !== channel) return
					succeeded.add(channel.id)
				} catch (error) {
					onFailure(error, channel.id)
				}
			}),
		)
		return channels.filter((channel) => succeeded.has(channel.id)).map((channel) => channel.id)
	}
}
