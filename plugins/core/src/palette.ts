import type { PaletteCommandDto, Principal } from '@pluxum/domain'
import { isFooterHref } from './footer'
import { CONTRIBUTION_ID } from './policies'

/** The lowest role that is shown a command. */
export type PaletteMinRole = 'member' | 'moderator' | 'admin'

/** One entry a plugin puts in the command palette: a place to go. */
export type PaletteCommandInput = Readonly<{
	/** Unique within the contributor, e.g. `queue`. */
	id: string
	label: string
	/** The palette's section for it; default `前往`. */
	group?: string
	/** Extra words the palette matches besides the label. */
	keywords?: readonly string[]
	/** A forum path or an http(s) URL; the frontend navigates to it. */
	href: string
	/** Hidden from viewers below this role; default: everyone, guests included. */
	minRole?: PaletteMinRole
}>

/**
 * Commands a plugin offers in the command palette while it runs. Plain data: the frontend draws
 * and runs them, so a plugin needs no frontend code of its own.
 */
export type PaletteCommandContribution = Readonly<{
	/** The contributor's ID, e.g. `forum-moderation`. */
	id: string
	commands: readonly PaletteCommandInput[]
}>

export const PALETTE_LABEL_MAX = 40
export const PALETTE_GROUP_MAX = 20
export const PALETTE_KEYWORD_MAX = 20
export const PALETTE_KEYWORDS_MAX = 8
export const PALETTE_COMMANDS_MAX = 20

const DEFAULT_GROUP = '前往'
const ROLE_RANK: Readonly<Record<string, number>> = { guest: 0, member: 1, moderator: 2, admin: 3 }

function checkText(id: string, what: string, value: unknown, max: number): string {
	if (typeof value !== 'string' || value.trim() === '' || Array.from(value).length > max) {
		throw new TypeError(`Palette contributor "${id}" has an invalid ${what}: ${String(value)}`)
	}
	return value.trim()
}

/**
 * Palette commands of running plugins. Stopping a contributor withdraws its commands, so the
 * palette never offers something whose plugin is gone.
 */
export class PaletteCommandRegistry {
	private readonly entries = new Map<string, readonly (PaletteCommandDto & { minRank: number })[]>()

	register(contribution: PaletteCommandContribution): () => void {
		const { id, commands } = contribution
		if (typeof id !== 'string' || !CONTRIBUTION_ID.test(id)) {
			throw new TypeError(`Invalid palette contributor ID: ${id}`)
		}
		if (!Array.isArray(commands) || commands.length === 0) {
			throw new TypeError(`Palette contributor "${id}" must give at least one command`)
		}
		if (commands.length > PALETTE_COMMANDS_MAX) {
			throw new TypeError(
				`Palette contributor "${id}" gives more than ${PALETTE_COMMANDS_MAX} commands`,
			)
		}
		if (this.entries.has(id)) throw new Error(`Palette commands of "${id}" are already registered`)
		const seen = new Set<string>()
		const stored = commands.map((command) => {
			const commandId = checkText(id, 'command ID', command.id, 40)
			if (seen.has(commandId)) {
				throw new TypeError(`Palette contributor "${id}" repeats the command "${commandId}"`)
			}
			seen.add(commandId)
			if (!isFooterHref(command.href)) {
				throw new TypeError(
					`Palette contributor "${id}" has an invalid href: ${String(command.href)}`,
				)
			}
			const keywords = command.keywords ?? []
			if (keywords.length > PALETTE_KEYWORDS_MAX) {
				throw new TypeError(`Palette command "${id}.${commandId}" gives too many keywords`)
			}
			const minRole = command.minRole ?? 'guest'
			if (minRole !== 'guest' && ROLE_RANK[minRole] === undefined) {
				throw new TypeError(
					`Palette command "${id}.${commandId}" names an unknown role: ${minRole}`,
				)
			}
			return {
				id: `${id}.${commandId}`,
				label: checkText(id, 'label', command.label, PALETTE_LABEL_MAX),
				group:
					command.group === undefined
						? DEFAULT_GROUP
						: checkText(id, 'group', command.group, PALETTE_GROUP_MAX),
				keywords: keywords.map((word: string) =>
					checkText(id, 'keyword', word, PALETTE_KEYWORD_MAX),
				),
				href: command.href,
				external: !command.href.startsWith('/'),
				minRank: ROLE_RANK[minRole] ?? 0,
			}
		})
		this.entries.set(id, stored)
		return () => {
			if (this.entries.get(id) === stored) this.entries.delete(id)
		}
	}

	/** The commands the principal may see, in registration order. */
	list(principal: Principal): PaletteCommandDto[] {
		const rank = Math.max(0, ...principal.roles.map((role) => ROLE_RANK[role] ?? 0))
		return [...this.entries.values()].flatMap((commands) =>
			commands
				.filter((command) => command.minRank <= rank)
				.map(({ minRank: _minRank, ...command }) => command),
		)
	}
}
