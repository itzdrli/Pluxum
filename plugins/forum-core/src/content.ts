import type { BodyFormat } from '@forum/domain'
import sanitizeHtml from 'sanitize-html'
import { CONTRIBUTION_ID } from './policies'

/** A renderer of post source text, contributed by a plugin. */
export type ContentRendererContribution = Readonly<{
	/** Stable contribution ID, e.g. `forum-markdown.marked`. */
	id: string
	/** The format the forum reports for posts while this renderer is installed. */
	format: Exclude<BodyFormat, 'plain'>
	/**
	 * Source text to HTML. Synchronous and free of side effects: it runs for every post of every
	 * page read. The output need not be safe; the core filters it.
	 */
	render: (source: string) => string
}>

export type RenderedBody = Readonly<{ html: string; format: BodyFormat }>

/**
 * Everything a post may contain, whatever a renderer emits. Tags outside the list are dropped and
 * their text kept; scripts and styles are dropped with their content.
 */
const ALLOWED: sanitizeHtml.IOptions = {
	allowedTags: [
		// Blocks
		'p',
		'br',
		'hr',
		'h2',
		'h3',
		'h4',
		'blockquote',
		'pre',
		'ul',
		'ol',
		'li',
		// Inline
		'strong',
		'em',
		'del',
		'code',
		'a',
	],
	allowedAttributes: { a: ['href', 'rel'], ol: ['start'] },
	// Code blocks carry their language as `language-xxx`.
	allowedClasses: { code: [/^language-[\w+#.-]{1,32}$/] },
	// Relative URLs (paths within the forum) are allowed as well; protocol-relative ones are not.
	allowedSchemes: ['http', 'https', 'mailto'],
	allowProtocolRelative: false,
	transformTags: {
		a: (tagName, attribs) => {
			const { rel: _, ...rest } = attribs
			return {
				tagName,
				attribs: /^https?:/i.test(attribs.href?.trim() ?? '')
					? { ...rest, rel: 'nofollow ugc noopener' }
					: rest,
			}
		},
	},
}

/** Filters renderer output down to the forum's allowlist. */
export function sanitizePostHtml(html: string): string {
	return sanitizeHtml(html, ALLOWED)
}

const ESCAPES: Readonly<Record<string, string>> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;',
}

/** Source text as HTML without any markup. */
export function escapePlainText(source: string): string {
	return source.replaceAll(/[&<>"']/g, (char) => ESCAPES[char] ?? char)
}

/**
 * The forum's content renderer slot. It holds at most one renderer: registration is scoped to the
 * contributor's generation, and the returned disposer withdraws exactly that registration.
 */
export class ContentRendererRegistry {
	private installed: ContentRendererContribution | undefined

	register(contribution: ContentRendererContribution): () => void {
		const { id, format, render } = contribution
		if (typeof id !== 'string' || !CONTRIBUTION_ID.test(id)) {
			throw new TypeError(`Invalid content renderer ID: ${id}`)
		}
		if (format !== 'markdown') {
			throw new TypeError(`Content renderer "${id}" declares an unknown format: ${String(format)}`)
		}
		if (typeof render !== 'function') {
			throw new TypeError(`Content renderer "${id}" must provide a render function`)
		}
		if (this.installed) {
			throw new Error(
				`Content renderer "${this.installed.id}" is already installed; "${id}" cannot be added`,
			)
		}
		this.installed = contribution
		return () => {
			// A later registration belongs to someone else; leave it alone.
			if (this.installed === contribution) this.installed = undefined
		}
	}

	id(): string | null {
		return this.installed?.id ?? null
	}

	/** The format posts are rendered in right now. */
	format(): BodyFormat {
		return this.installed?.format ?? 'plain'
	}

	/**
	 * Renders a post body with the installed renderer and filters the result. Falls back to plain
	 * text when there is no renderer or it throws; `onFailure` receives the error in that case.
	 */
	render(source: string, onFailure: (error: unknown, rendererId: string) => void): RenderedBody {
		const renderer = this.installed
		// A deleted post has no body; there is nothing to hand to the renderer.
		if (source === '') return { html: '', format: renderer?.format ?? 'plain' }
		if (renderer) {
			try {
				const html = renderer.render(source)
				if (typeof html !== 'string') throw new TypeError('The renderer returned no HTML')
				return { html: sanitizePostHtml(html), format: renderer.format }
			} catch (error) {
				onFailure(error, renderer.id)
			}
		}
		return { html: escapePlainText(source), format: 'plain' }
	}
}
