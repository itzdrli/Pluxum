import { createHash } from 'node:crypto'
import {
	noticeDetail,
	placeholderUser,
	type ForumNotification,
	type ThreadKind,
	type UserDto,
} from '@pluxum/domain'
import { ForumApiPlugin } from '@pluxum/api'
import { answeredAuthorOf, ForumCorePlugin, type PostAfterWriteEvent } from '@pluxum/core'
import { BasePlugin, Plugin } from '@pluxel/core'
import { Result } from '@pluxel/core/better-result'
import { Type, type Static } from 'typebox'
import { mentionedRefs } from './parse'

export { mentionedRefs, MENTION_LIMIT } from './parse'

/** The extension's ID: UI slot contributor ID and `/api/forum/ext/:extId` segment. */
export const MENTIONS_EXT_ID = 'forum-mentions'
export const MENTIONS_POST_HOOK_ID = 'forum-mentions.notify'

const SUGGESTIONS = 8

export const MentionSuggestion = Type.Object({
	id: Type.String(),
	handle: Type.String(),
	displayName: Type.String(),
})
export const MentionSuggestions = Type.Object({ items: Type.Array(MentionSuggestion) })
export type MentionSuggestions = Static<typeof MentionSuggestions>

const SuggestInput = Type.Object({ q: Type.Optional(Type.String({ maxLength: 64 })) })

const EXCERPT_CHARS = 120

/** A UUID (version 8, name-based) for one person's mention notice of one post. */
export function mentionNoticeId(postId: string, recipientId: string): string {
	const hex = createHash('sha256').update(`mention:${postId}:${recipientId}`).digest('hex')
	const variant = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16)
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function excerptOf(body: string): string | undefined {
	const cleaned = body.replaceAll(/\s+/gu, ' ').trim()
	if (!cleaned) return undefined
	const chars = Array.from(cleaned)
	return chars.length <= EXCERPT_CHARS ? cleaned : `${chars.slice(0, EXCERPT_CHARS).join('')}…`
}

/**
 * @mentions. The composer gets a Tiptap extension that suggests people after `@` and writes the
 * choice as a profile link, `[@名字](/u/handle)`: plain Markdown, so the renderer shows it as a
 * link (with the profile hover card) and nothing else has to know about mentions.
 *
 * Contributes:
 * - `uiSlots` (`composer.editor`) so the editor loads the mention extension only while this runs;
 * - `extActions` `GET /api/forum/ext/forum-mentions/suggest?q=` for the suggestion list;
 * - `postHooks` (`forum-mentions.notify`) that notifies everyone a new thread or reply mentions
 *   and who may see it (not the author, and not a thread's author, whom the reply notice covers).
 */
@Plugin({ displayName: 'Forum Mentions' })
export class ForumMentionsPlugin extends BasePlugin {
	constructor(
		private readonly core: ForumCorePlugin,
		private readonly api: ForumApiPlugin,
	) {
		super()
	}

	protected override init(): void {
		this.ctx.effects.defer(
			this.core.registerUiSlots({ id: MENTIONS_EXT_ID, slots: ['composer.editor'] }),
		)
		this.ctx.effects.defer(
			this.core.registerPostHook({
				id: MENTIONS_POST_HOOK_ID,
				afterWrite: (event) => this.onAfterWrite(event),
			}),
		)
		this.ctx.effects.defer(
			this.api.registerExtAction({
				extId: MENTIONS_EXT_ID,
				action: 'suggest',
				method: 'GET',
				login: true,
				input: SuggestInput,
				output: MentionSuggestions,
				handle: async ({ input }) => Result.ok(await this.suggest(input.q ?? '')),
			}),
		)
	}

	/** People whose handle or name contains `query`, newest accounts first. */
	async suggest(query: string): Promise<MentionSuggestions> {
		const list = await this.core.listUsers({ query: query.trim(), pageSize: SUGGESTIONS })
		return {
			items: list.items.map(({ id, handle, displayName }) => ({ id, handle, displayName })),
		}
	}

	private async onAfterWrite(event: PostAfterWriteEvent): Promise<void> {
		if (event.kind !== 'thread.created' && event.kind !== 'post.created') return
		const refs = mentionedRefs(event.body)
		if (refs.length === 0) return
		const actor = await this.userOr(event.authorId)
		const threadTitle = event.kind === 'thread.created' ? event.title : event.threadTitle
		const postNumber = event.kind === 'thread.created' ? 1 : event.postNumber
		// Whoever a reply answers already hears about it from the notifications plugin.
		const covered = new Set([
			event.authorId,
			...(event.kind === 'post.created' ? [answeredAuthorOf(event)] : []),
		])
		const excerpt = excerptOf(event.body)

		const recipients = new Map<string, UserDto>()
		for (const found of await Promise.all(refs.map((ref) => this.core.getUser(ref)))) {
			if (found.isOk() && !covered.has(found.value.id)) recipients.set(found.value.id, found.value)
		}
		await Promise.all(
			[...recipients.values()].map(async (recipient) => {
				// Someone who cannot see the post is not told about it.
				const viewer = await this.core.principalOf(recipient.id)
				if ((await this.core.locatePost(viewer, event.postId)).isErr()) return
				const notification: ForumNotification = {
					// One notice per post and person, so a repeated delivery stays a single row.
					id: mentionNoticeId(event.postId, recipient.id),
					recipientId: recipient.id,
					kind: 'post.mention',
					...mentionTitle(actor.displayName, event.threadKind, threadTitle),
					...(excerpt === undefined ? {} : { body: excerpt }),
					path: `/t/${event.threadRef}/${postNumber}`,
					threadId: event.threadId,
					postId: event.postId,
					actor,
					createdAt: event.createdAt,
				}
				await this.core.deliverNotification(notification)
			}),
		)
	}

	private async userOr(userId: string): Promise<UserDto> {
		const found = await this.core.getUser(userId)
		return found.isOk() ? found.value : placeholderUser(userId, 'member')
	}
}

/** The title of a mention notice: who mentioned the reader, and in what. */
function mentionTitle(
	actor: string,
	threadKind: ThreadKind,
	title: string,
): Pick<ForumNotification, 'title' | 'titleKey' | 'titleParams'> {
	const detail =
		threadKind === 'note'
			? noticeDetail('notice.mention.in_note', { actor })
			: noticeDetail('notice.mention.in_topic', { actor, title })
	return { title: detail.title, titleKey: detail.key, titleParams: detail.params }
}
