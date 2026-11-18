import { createTransport, type Transporter } from 'nodemailer'
import type { ForumMailConfig } from './config'
import type { MailMessage } from './compose'

/** Sends one message; rejects when the server refuses it or cannot be reached. */
export type MailSender = (message: MailMessage) => Promise<void>

/** A nodemailer SMTP transport for `config`. `password` is null when the server needs no login. */
export function smtpTransport(
	config: Readonly<ForumMailConfig>,
	password: string | null,
): Transporter {
	return createTransport({
		host: config.host,
		port: config.port,
		secure: config.security === 'tls',
		requireTLS: config.security === 'starttls',
		ignoreTLS: config.security === 'none',
		...(config.username === '' ? {} : { auth: { user: config.username, pass: password ?? '' } }),
		connectionTimeout: 10_000,
		greetingTimeout: 10_000,
		socketTimeout: 20_000,
	})
}

/** `"Name" <address>` as nodemailer takes it. */
export function fromOf(config: Readonly<ForumMailConfig>, siteName: string) {
	return { name: config.fromName || siteName, address: config.fromAddress }
}

/**
 * Sends notification mail one message at a time, in the background, so a slow SMTP server never
 * holds up the write that caused the notification. Holds at most `capacity` messages; beyond that
 * new ones are dropped (and reported), since a backlog that large means the server is not taking
 * mail anyway.
 */
export class MailQueue {
	/** Messages accepted but not yet attempted. */
	private waiting = 0
	private stopped = false
	/** Settles once every message accepted so far has been attempted. */
	private tail: Promise<void> = Promise.resolve()

	constructor(
		private readonly send: () => MailSender | null,
		private readonly onFailure: (error: unknown, message: MailMessage) => void,
		private readonly capacity = 500,
	) {}

	/** False when the message was dropped: the queue is full or stopped. */
	push(message: MailMessage): boolean {
		if (this.stopped || this.waiting >= this.capacity) return false
		this.waiting += 1
		this.tail = this.tail.then(() => this.attempt(message))
		return true
	}

	get size(): number {
		return this.waiting
	}

	/** Stops sending; what is still queued is dropped and its count returned. */
	stop(): number {
		this.stopped = true
		return this.waiting
	}

	/** Resolves once everything queued so far has been attempted (tests and shutdown). */
	idle(): Promise<void> {
		return this.tail
	}

	private async attempt(message: MailMessage): Promise<void> {
		this.waiting -= 1
		if (this.stopped) return
		const send = this.send()
		try {
			if (send === null) throw new Error('Mail is not configured')
			await send(message)
		} catch (error) {
			this.onFailure(error, message)
		}
	}
}
