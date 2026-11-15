import {
	isUiSlot,
	UI_SLOTS,
	type ExtensionData,
	type Principal,
	type UiSlot,
	type UiSlotDto,
} from '@forum/domain'
import { CONTRIBUTION_ID } from './policies'

/** The entities whose DTOs carry extension data. */
export type ExtendableEntity = 'thread' | 'post'

/** Extra data for threads or posts, contributed by an extension plugin that keeps its own tables. */
export type EntityExtensionContribution = Readonly<{
	/** The extension's ID, e.g. `forum-reactions`; also the key of its data in a DTO's `ext`. */
	id: string
	entity: ExtendableEntity
	/**
	 * The extension's data for one page of entities, keyed by entity ID, in a single batch: the
	 * core calls this once per page, never once per entity. Values must be plain JSON data. An
	 * entity missing from the result simply gets nothing. `viewer` is who is reading.
	 */
	load: (ids: readonly string[], viewer: Principal) => Promise<ReadonlyMap<string, unknown>>
}>

/** A page waits this long for one extension; after that it is served without that extension. */
export const EXTENSION_TIMEOUT_MS = 2000

const TIMED_OUT = Symbol('timed out')

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
	let timer: ReturnType<typeof setTimeout> | undefined
	const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
		timer = setTimeout(() => resolve(TIMED_OUT), ms)
	})
	return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Open registry of entity extensions. Registration is scoped to the contributor's generation: the
 * returned disposer withdraws exactly that registration, and a result that arrives after its
 * contributor was withdrawn is discarded.
 */
export class EntityExtensionRegistry {
	private readonly entries = new Map<string, EntityExtensionContribution>()

	register(contribution: EntityExtensionContribution): () => void {
		const { id, entity, load } = contribution
		if (typeof id !== 'string' || !CONTRIBUTION_ID.test(id)) {
			throw new TypeError(`Invalid entity extension ID: ${id}`)
		}
		if (entity !== 'thread' && entity !== 'post') {
			throw new TypeError(`Entity extension "${id}" names an unknown entity: ${String(entity)}`)
		}
		if (typeof load !== 'function') {
			throw new TypeError(`Entity extension "${id}" must provide a load function`)
		}
		const key = `${entity}/${id}`
		if (this.entries.has(key)) {
			throw new Error(`Entity extension "${id}" is already registered for ${entity}`)
		}
		this.entries.set(key, contribution)
		return () => {
			// A later registration under the same key belongs to someone else; leave it alone.
			if (this.entries.get(key) === contribution) this.entries.delete(key)
		}
	}

	ids(entity: ExtendableEntity): string[] {
		return [...this.entries.values()].filter((entry) => entry.entity === entity).map((e) => e.id)
	}

	/**
	 * Extension data for the given entities: entity ID → extension ID → data. Every extension is
	 * asked once, in parallel. One that fails or takes too long is left out and reported through
	 * `onFailure`; the page is served without it.
	 */
	async load(
		entity: ExtendableEntity,
		ids: readonly string[],
		viewer: Principal,
		onFailure: (error: unknown, extensionId: string) => void,
	): Promise<Map<string, ExtensionData>> {
		const contributions = [...this.entries.entries()].filter(
			([, contribution]) => contribution.entity === entity,
		)
		const merged = new Map<string, Record<string, unknown>>()
		if (ids.length === 0 || contributions.length === 0) return merged
		const wanted = new Set(ids)
		await Promise.all(
			contributions.map(async ([key, contribution]) => {
				try {
					const loaded = await withTimeout(
						// A synchronous throw inside `load` must not escape the try block either.
						Promise.resolve().then(() => contribution.load(ids, viewer)),
						EXTENSION_TIMEOUT_MS,
					)
					if (loaded === TIMED_OUT) throw new Error(`No answer within ${EXTENSION_TIMEOUT_MS} ms`)
					// Withdrawn while it worked: its answer no longer belongs on the page.
					if (this.entries.get(key) !== contribution) return
					if (!(loaded instanceof Map)) throw new TypeError('The extension returned no Map')
					for (const [entityId, data] of loaded) {
						if (!wanted.has(entityId) || data === undefined) continue
						const slot = merged.get(entityId) ?? {}
						slot[contribution.id] = data
						merged.set(entityId, slot)
					}
				} catch (error) {
					onFailure(error, contribution.id)
				}
			}),
		)
		return merged
	}
}

/** The slots an extension fills in the frontend, which ships the matching components. */
export type UiSlotContribution = Readonly<{
	/** The extension's ID; the frontend looks its components up under this ID. */
	id: string
	slots: readonly UiSlot[]
}>

/**
 * Which running extension fills which frontend slot. This is metadata only: stopping the
 * contributor removes its entries, and the frontend stops rendering its components.
 */
export class UiSlotRegistry {
	private readonly entries = new Map<string, UiSlotContribution>()

	register(contribution: UiSlotContribution): () => void {
		const { id, slots } = contribution
		if (typeof id !== 'string' || !CONTRIBUTION_ID.test(id)) {
			throw new TypeError(`Invalid UI slot contributor ID: ${id}`)
		}
		if (!Array.isArray(slots) || slots.length === 0) {
			throw new TypeError(`UI slot contributor "${id}" must name at least one slot`)
		}
		const unknown = slots.find((slot) => !isUiSlot(slot))
		if (unknown !== undefined) {
			throw new TypeError(`UI slot contributor "${id}" names an unknown slot: ${String(unknown)}`)
		}
		if (this.entries.has(id)) throw new Error(`UI slots of "${id}" are already registered`)
		this.entries.set(id, contribution)
		return () => {
			if (this.entries.get(id) === contribution) this.entries.delete(id)
		}
	}

	/** Slot by slot in the order of `UI_SLOTS`; within a slot, in registration order. */
	list(): UiSlotDto[] {
		return UI_SLOTS.flatMap((slot) =>
			[...this.entries.values()]
				.filter((entry) => entry.slots.includes(slot))
				.map((entry) => ({ slot, extId: entry.id })),
		)
	}
}
