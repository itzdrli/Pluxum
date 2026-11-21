import { createHash } from 'node:crypto'
import { failure, GUEST } from '@pluxum/domain'
import { ForumApiPlugin, type ExtFileObject } from '@pluxum/api'
import { ForumCorePlugin, type ForumResult } from '@pluxum/core'
import { BasePlugin, Plugin } from '@pluxel/core'
import { Result } from '@pluxel/core/better-result'
import { FontsPlugin } from '@pluxel/plugin-fonts'
import { TakumiPlugin, type Font } from '@pluxel/plugin-takumi'
import {
	CARD_HEIGHT,
	CARD_WIDTH,
	clip,
	NOTE_CHARS,
	plainText,
	threadCardNode,
	type ThreadCard,
} from './card'

export * from './card'

/** The extension's ID: its segment of `/api/forum/ext/:extId/files/:fileId`. */
export const OG_EXT_ID = 'forum-og'

/** Where a thread's card is served, relative to the forum origin. */
export function threadCardPath(threadRef: string): string {
	return `/api/forum/ext/${OG_EXT_ID}/files/${encodeURIComponent(threadRef)}.png`
}

const threadNotFound = () =>
	Result.err(failure('not_found', 'entity.not_found', { entity: 'thread' }))

/** Rendered cards kept in memory; a card is re-rendered when what it shows changes. */
const CACHE_ENTRIES = 256

type CachedCard = Readonly<{ etag: string; png: Uint8Array<ArrayBuffer> }>
type LoadedFonts = Readonly<{ revision: number; fonts: Font[]; family: string }>

/**
 * Social cards (Open Graph images) for threads, drawn with Takumi in the shared Worker pool.
 * `GET /api/forum/ext/forum-og/files/<thread ref>.png` answers a 1200×630 PNG of what a guest
 * sees: the thread's title (a note's opening words), category, author, date and reply count.
 *
 * Fonts come from FontsPlugin: every font it holds bytes for (configured files, fonts uploaded
 * in Workbench), in that order as the fallback chain. Without a CJK font Chinese text cannot be
 * drawn, so configure one (e.g. `FONT_FILES`).
 *
 * It fills the `thread.social` slot, which tells the frontend to point `og:image` here; stopped,
 * thread pages fall back to the site-wide image.
 */
@Plugin({ displayName: 'Forum OG Images' })
export class ForumOgPlugin extends BasePlugin {
	private readonly cards = new Map<string, CachedCard>()
	private readonly pending = new Map<string, Promise<CachedCard>>()
	private mark?: Readonly<{ url: string; version: string; src: string }>
	private fonts: Promise<LoadedFonts> | undefined
	private warnedNoFonts = false

	constructor(
		private readonly core: ForumCorePlugin,
		private readonly api: ForumApiPlugin,
		private readonly takumi: TakumiPlugin,
		private readonly fontsProvider: FontsPlugin,
	) {
		super()
	}

	protected override init(): void {
		this.ctx.effects.defer(
			this.api.registerExtFile({
				extId: OG_EXT_ID,
				read: ({ fileId, ifNoneMatch }) => this.readCard(fileId, ifNoneMatch),
			}),
		)
		this.ctx.effects.defer(this.core.registerUiSlots({ id: OG_EXT_ID, slots: ['thread.social'] }))
	}

	/**
	 * The logo uploaded in Workbench (Forum Core › 品牌) as a data URL, kept until the upload
	 * changes; undefined draws the Pluxum mark.
	 */
	private async loadMark(): Promise<Readonly<{ version: string; src: string }> | undefined> {
		const url = this.core.site().brand.logo
		if (url === null) return undefined
		if (this.mark?.url === url) return this.mark
		const asset = await this.core.brandAsset('logo')
		if (!asset) return undefined
		const mark = {
			url,
			version: asset.version,
			src: `data:${asset.type};base64,${Buffer.from(asset.bytes).toString('base64')}`,
		}
		this.mark = mark
		return mark
	}

	/** The card of the thread `<ref>.png`, as a guest sees it. */
	async readCard(
		fileId: string,
		ifNoneMatch?: string | null,
	): Promise<ForumResult<ExtFileObject | 'not_modified'>> {
		const ref = /^(.+)\.png$/.exec(fileId)?.[1]
		if (!ref) return threadNotFound()
		// Always as a guest: the image is public and cached, so it must never show a restricted thread.
		const detail = await this.core.getThread(GUEST, ref, { pageSize: 1 })
		if (detail.isErr()) return detail
		const { thread, category, posts } = detail.value
		const opening = posts.items.find((post) => post.number === 1)
		const note = thread.kind === 'note' || thread.title === ''
		const card: ThreadCard = {
			site: this.core.site().name,
			category: category.name,
			heading: note
				? clip(opening && !opening.deleted ? plainText(opening.bodyHtml) : '', NOTE_CHARS)
				: thread.title,
			note,
			author: thread.author.displayName,
			date: thread.createdAt.slice(0, 10),
			replyCount: thread.replyCount,
		}
		const fonts = await this.loadFonts()
		const mark = await this.loadMark()
		const etag = `"${createHash('sha256')
			.update(JSON.stringify([card, fonts.revision, mark?.version ?? null]))
			.digest('base64url')
			.slice(0, 27)}"`
		if (
			ifNoneMatch
				?.split(',')
				.map((part) => part.trim())
				.includes(etag)
		) {
			return Result.ok('not_modified')
		}
		const rendered = await this.render(thread.id, etag, card, fonts, mark?.src)
		return Result.ok({
			body: rendered.png,
			contentType: 'image/png',
			size: rendered.png.byteLength,
			etag,
		})
	}

	private async render(
		key: string,
		etag: string,
		card: ThreadCard,
		fonts: LoadedFonts,
		markSrc?: string,
	): Promise<CachedCard> {
		const cached = this.cards.get(key)
		if (cached?.etag === etag) {
			// Most recently used last.
			this.cards.delete(key)
			this.cards.set(key, cached)
			return cached
		}
		const pendingKey = `${key}:${etag}`
		const inFlight = this.pending.get(pendingKey)
		if (inFlight) return inFlight
		const job = (async () => {
			const bytes = await this.takumi.renderInWorker(threadCardNode(card, fonts.family, markSrc), {
				width: CARD_WIDTH,
				height: CARD_HEIGHT,
				format: 'png',
				fonts: fonts.fonts,
				images: { allowRemote: false },
			})
			const png = new Uint8Array(bytes)
			const entry = { etag, png }
			this.cards.delete(key)
			this.cards.set(key, entry)
			while (this.cards.size > CACHE_ENTRIES) {
				const oldest = this.cards.keys().next().value
				if (oldest === undefined) break
				this.cards.delete(oldest)
			}
			return entry
		})()
		this.pending.set(pendingKey, job)
		try {
			return await job
		} finally {
			this.pending.delete(pendingKey)
		}
	}

	/** FontsPlugin's portable fonts, read again only when that set changes. */
	private async loadFonts(): Promise<LoadedFonts> {
		const snapshot = this.fontsProvider.portableFonts
		const current = this.fonts
		if (current) {
			const loaded = await current.catch(() => undefined)
			if (loaded?.revision === snapshot.revision) return loaded
		}
		const next = (async (): Promise<LoadedFonts> => {
			const names = snapshot.fonts.map((font) => font.family ?? font.resolvedFamilies[0] ?? font.id)
			const fonts: Font[] = await Promise.all(
				snapshot.fonts.map(async (font, index) => ({
					name: names[index],
					data: await this.fontsProvider.readPortableFont(font.id),
				})),
			)
			if (fonts.length === 0 && !this.warnedNoFonts) {
				this.warnedNoFonts = true
				this.ctx.logger.warn(
					'FontsPlugin holds no font bytes: social cards cannot draw CJK text. Configure FONT_FILES or upload a font in Workbench.',
				)
			}
			const family = [...new Set(names.map((name) => `"${name.replaceAll('"', '')}"`))]
				.concat('sans-serif')
				.join(', ')
			return { revision: snapshot.revision, fonts, family }
		})()
		this.fonts = next
		return next
	}
}
