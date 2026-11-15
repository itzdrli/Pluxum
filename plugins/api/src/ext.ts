import type { Principal } from '@pluxum/domain'
import type { ForumResult } from '@pluxum/core'
import type { Static, TSchema } from 'typebox'

/** How the fixed ingress reaches an action: `GET` reads, `POST` changes something. */
export type ExtActionMethod = 'GET' | 'POST'

/**
 * One endpoint of an extension plugin behind the fixed ingress
 * `GET|POST /api/forum/ext/:extId/:action`. Extensions cannot mount routes of their own; they
 * hand the ingress a handler together with the contract it must enforce for them.
 */
export type ExtActionContribution<
	Input extends TSchema = TSchema,
	Output extends TSchema = TSchema,
> = Readonly<{
	/** The extension's ID and the first path segment, e.g. `forum-reactions`. */
	extId: string
	/** The second path segment, e.g. `react`. */
	action: string
	method: ExtActionMethod
	/** Whether a guest is turned away (401) before the handler runs. */
	login: boolean
	/**
	 * What the caller must send: the JSON body of a `POST`, the query of a `GET` (so only string
	 * properties there). Anything else is answered with 422; unknown properties are removed.
	 */
	input: Input
	/** What the action answers. A result that does not match is a server fault (500). */
	output: Output
	/**
	 * Runs the action. The principal is already resolved and, for a `POST`, the request is known
	 * not to be cross-site; finer permission checks on the target entity are the handler's job.
	 */
	handle: (request: {
		principal: Principal
		input: Static<Input>
	}) => Promise<ForumResult<Static<Output>>>
}>

type AnyContribution = ExtActionContribution

/** A path segment of the ingress: lowercase words joined by dashes. */
const SEGMENT = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/**
 * Open registry behind the ext ingress. Registration is scoped to the contributor's generation:
 * the returned disposer withdraws exactly that registration, after which the path answers 404.
 */
export class ExtActionRegistry {
	private readonly entries = new Map<string, AnyContribution>()

	register<Input extends TSchema, Output extends TSchema>(
		contribution: ExtActionContribution<Input, Output>,
	): () => void {
		const { extId, action, method, handle } = contribution
		if (typeof extId !== 'string' || !SEGMENT.test(extId)) {
			throw new TypeError(`Invalid extension ID for an ext action: ${extId}`)
		}
		if (typeof action !== 'string' || !SEGMENT.test(action)) {
			throw new TypeError(`Invalid ext action name of "${extId}": ${action}`)
		}
		if (method !== 'GET' && method !== 'POST') {
			throw new TypeError(`Ext action "${extId}/${action}" declares an unknown method`)
		}
		if (typeof handle !== 'function') {
			throw new TypeError(`Ext action "${extId}/${action}" must provide a handler`)
		}
		const key = `${extId}/${action}`
		if (this.entries.has(key)) throw new Error(`Ext action "${key}" is already registered`)
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the registry stores contributions with their schema types erased; the ingress checks input and output against those same schemas at runtime before and after calling the handler.
		const stored = contribution as unknown as AnyContribution
		this.entries.set(key, stored)
		return () => {
			// A later registration under the same key belongs to someone else; leave it alone.
			if (this.entries.get(key) === stored) this.entries.delete(key)
		}
	}

	find(extId: string, action: string): AnyContribution | undefined {
		return this.entries.get(`${extId}/${action}`)
	}

	/** Whether this exact registration is still in place (it may be withdrawn while it runs). */
	holds(contribution: AnyContribution): boolean {
		return this.entries.get(`${contribution.extId}/${contribution.action}`) === contribution
	}

	keys(): string[] {
		return [...this.entries.keys()]
	}
}

/** A binary object served by an extension behind `GET /api/forum/ext/:extId/files/:fileId`. */
export type ExtFileObject = Readonly<{
	body: ArrayBuffer | Uint8Array<ArrayBuffer> | ReadableStream<Uint8Array<ArrayBuffer>>
	contentType: string
	size?: number
	filename?: string
	etag?: string
	/** Whether the URL is content-addressed or otherwise immutable and can be cached long-term. */
	immutable?: boolean
}>

export type ExtFileContribution = Readonly<{
	/** The extension's ID and the `:extId` segment, e.g. `forum-attachments`. */
	extId: string
	read: (request: {
		principal: Principal
		fileId: string
		ifNoneMatch?: string | null
	}) => Promise<ForumResult<ExtFileObject | 'not_modified'>>
}>

/**
 * Open registry of binary file handlers for extensions. Registration is scoped to the
 * contributor's generation: the returned disposer withdraws that registration, after which
 * `GET /api/forum/ext/:extId/files/:fileId` answers 404.
 */
export class ExtFileRegistry {
	private readonly entries = new Map<string, ExtFileContribution>()

	register(contribution: ExtFileContribution): () => void {
		const { extId, read } = contribution
		if (typeof extId !== 'string' || !SEGMENT.test(extId)) {
			throw new TypeError(`Invalid extension ID for an ext file handler: ${extId}`)
		}
		if (typeof read !== 'function') {
			throw new TypeError(`Ext file handler "${extId}" must provide a read function`)
		}
		if (this.entries.has(extId)) {
			throw new Error(`Ext file handler "${extId}" is already registered`)
		}
		this.entries.set(extId, contribution)
		return () => {
			if (this.entries.get(extId) === contribution) this.entries.delete(extId)
		}
	}

	find(extId: string): ExtFileContribution | undefined {
		return this.entries.get(extId)
	}

	holds(contribution: ExtFileContribution): boolean {
		return this.entries.get(contribution.extId) === contribution
	}

	ids(): string[] {
		return [...this.entries.keys()]
	}
}
