import type {
	CategoryDto,
	MetaDto,
	PaletteCommandDto,
	SearchHitDto,
	SearchPageDto,
} from '@pluxum/domain'
import {
	CornerDownLeft,
	FilePlus2,
	Hash,
	LayoutGrid,
	LogIn,
	MessageSquare,
	Palette as PaletteIcon,
	Search,
	type LucideIcon,
} from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Dialog, Modal, ModalOverlay } from 'react-aria-components'
import { useRouteLoaderData } from 'react-router'

import type { loader as rootLoader } from '../../root'
import { parsePaletteQuery, rank } from '../../lib/palette'
import { THEMES } from '../../lib/theme'
import { useDock } from '../dock/composer-dock'
import { useStageNavigate } from '../stage/stage'
import { chooseTheme } from '../shell/theme-picker'

/** What opens the palette from elsewhere in the page (the top bar's search field, shortcuts). */
type PaletteControl = Readonly<{ open: (initial?: string) => void }>

const PaletteContext = createContext<PaletteControl>({ open: () => {} })

export function usePalette(): PaletteControl {
	return useContext(PaletteContext)
}

type Item = Readonly<{
	id: string
	section: string
	label: string
	hint?: string
	keywords?: readonly string[]
	icon: LucideIcon
	run: () => void
}>

type Loaded = Readonly<{
	categories: readonly CategoryDto[]
	commands: readonly PaletteCommandDto[]
}>

/** Keeps the highlighted entry in view as the arrow keys move it. */
function scrollNearest(element: HTMLElement | null) {
	element?.scrollIntoView({ block: 'nearest' })
}

const SEARCH_DEBOUNCE_MS = 180
const SEARCH_HITS = 6

function isTyping(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLElement &&
		(target.tagName === 'INPUT' ||
			target.tagName === 'TEXTAREA' ||
			target.tagName === 'SELECT' ||
			target.isContentEditable)
	)
}

/** Fetches JSON from the forum API; null when it fails, so the palette just shows less. */
async function getJson<T>(path: string, signal: AbortSignal): Promise<T | null> {
	try {
		const response = await fetch(`/api/forum${path}`, { signal })
		if (!response.ok) return null
		const body: T = await response.json()
		return body
	} catch {
		return null
	}
}

/**
 * The global command centre: Ctrl/Cmd+K or `/` opens it. Plain text finds threads (full-text
 * search), categories and commands; `>` lists commands only (the built-in ones and those running
 * plugins offer through `registerPaletteCommands`, read fresh each time it opens, so a stopped
 * plugin's commands are gone); `#` lists categories. Enter runs the highlighted entry.
 */
export function PaletteProvider({ children }: { children: React.ReactNode }) {
	const [isOpen, setIsOpen] = useState(false)
	const [initial, setInitial] = useState('')
	const open = useCallback((text = '') => {
		setInitial(text)
		setIsOpen(true)
	}, [])
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented) return
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
				event.preventDefault()
				setIsOpen((current) => {
					if (!current) setInitial('')
					return !current
				})
				return
			}
			if (event.key === '/' && !event.metaKey && !event.ctrlKey && !isTyping(event.target)) {
				event.preventDefault()
				open()
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [open])
	const control = useMemo<PaletteControl>(() => ({ open }), [open])
	return (
		<PaletteContext.Provider value={control}>
			{children}
			{isOpen && <CommandPalette initial={initial} onClose={() => setIsOpen(false)} />}
		</PaletteContext.Provider>
	)
}

function CommandPalette({ initial, onClose }: { initial: string; onClose: () => void }) {
	const meta: MetaDto | null | undefined = useRouteLoaderData<typeof rootLoader>('root')?.meta
	const navigate = useStageNavigate()
	const dock = useDock()
	const [query, setQuery] = useState(initial)
	const [active, setActive] = useState(0)
	const [loaded, setLoaded] = useState<Loaded | null>(null)
	const [hits, setHits] = useState<readonly SearchHitDto[]>([])
	const parsed = parsePaletteQuery(query)

	// The categories and the plugins' commands, read when the palette opens.
	useEffect(() => {
		const controller = new AbortController()
		const load = async () => {
			const [categories, commands] = await Promise.all([
				getJson<{ items: CategoryDto[] }>('/categories', controller.signal),
				getJson<PaletteCommandDto[]>('/palette', controller.signal),
			])
			if (!controller.signal.aborted) {
				setLoaded({ categories: categories?.items ?? [], commands: commands ?? [] })
			}
		}
		void load()
		return () => controller.abort()
	}, [])

	// Threads: full-text search as the viewer types, when a search plugin runs.
	const searchAvailable = meta?.search.available === true
	const searchText = parsed.mode === 'all' ? parsed.text : ''
	const searching = searchAvailable && searchText.length >= 2
	useEffect(() => {
		const controller = new AbortController()
		const search = async () => {
			const page = await getJson<SearchPageDto>(
				`/search?q=${encodeURIComponent(searchText)}&pageSize=${SEARCH_HITS * 2}`,
				controller.signal,
			)
			if (controller.signal.aborted) return
			const seen = new Set<string>()
			setHits(
				(page?.items ?? [])
					.filter((hit) => !seen.has(hit.threadId) && seen.add(hit.threadId))
					.slice(0, SEARCH_HITS),
			)
		}
		const timer = searching ? setTimeout(() => void search(), SEARCH_DEBOUNCE_MS) : undefined
		return () => {
			clearTimeout(timer)
			controller.abort()
		}
	}, [searching, searchText])

	const go = useCallback(
		(href: string, external = false) => {
			onClose()
			if (external) window.open(href, '_blank', 'noopener,noreferrer')
			else void navigate(href)
		},
		[navigate, onClose],
	)

	const sections = useMemo(() => {
		const categories = loaded?.categories ?? []
		const categoryName = new Map(categories.map((category) => [category.id, category.name]))
		const signedIn = meta?.viewer.user != null
		const commands: Item[] = [
			{
				id: 'home',
				section: '前往',
				label: '概览',
				keywords: ['首页', 'home'],
				icon: LayoutGrid,
				run: () => go('/'),
			},
			...(loaded?.commands ?? []).map((command): Item => ({
				id: command.id,
				section: command.group,
				label: command.label,
				keywords: command.keywords,
				icon: command.external ? CornerDownLeft : LayoutGrid,
				run: () => go(command.href, command.external),
			})),
			...(signedIn
				? categories.map((category): Item => ({
						id: `new.${category.id}`,
						section: '发布',
						label: `发布新主题 · ${category.name}`,
						keywords: ['新主题', '发帖', 'new thread', category.name],
						icon: FilePlus2,
						run: () => {
							onClose()
							dock.openThread(category.slug)
						},
					}))
				: meta?.auth.loginAvailable === true
					? [
							{
								id: 'login',
								section: '账号',
								label: '登录',
								keywords: ['sign in'],
								icon: LogIn,
								run: () => {
									window.location.assign(
										`/api/forum/auth/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`,
									)
								},
							} satisfies Item,
						]
					: []),
			...THEMES.map((theme): Item => ({
				id: `theme.${theme.id}`,
				section: '切换主题',
				label: `切换主题 · ${theme.label}`,
				keywords: ['主题', 'theme', theme.dark ? '暗色' : '亮色'],
				icon: PaletteIcon,
				run: () => {
					onClose()
					chooseTheme(theme.id)
				},
			})),
		]
		const categoryItems: Item[] = categories.map((category) => ({
			id: `cat.${category.id}`,
			section: '版块',
			label: category.name,
			hint: `${category.threadCount} 主题`,
			keywords: [category.slug],
			icon: Hash,
			run: () => go(`/c/${category.slug}`),
		}))
		const threadItems: Item[] = (searching ? hits : []).map((hit) => ({
			id: `hit.${hit.threadId}`,
			section: '主题',
			label: hit.title,
			hint: categoryName.get(hit.categoryId),
			icon: MessageSquare,
			run: () => go(`/t/${hit.threadRef}`),
		}))
		const matching = (items: Item[], limit: number) =>
			rank(items, parsed.text, (item) => item).slice(0, limit)
		const result: Array<{ title: string; items: Item[] }> = []
		if (parsed.mode === 'commands') {
			result.push({ title: '命令', items: matching(commands, 40) })
		} else if (parsed.mode === 'categories') {
			result.push({ title: '版块', items: matching(categoryItems, 40) })
		} else if (parsed.text === '') {
			result.push({ title: '前往', items: commands.filter((item) => item.section === '前往') })
			result.push({ title: '版块', items: categoryItems })
		} else {
			// Typed text: commands that match the line itself, then categories, then threads.
			result.push({ title: '命令', items: matching(commands, 5) })
			result.push({ title: '版块', items: matching(categoryItems, 4) })
			result.push({ title: '主题', items: threadItems })
		}
		return result.filter((section) => section.items.length > 0)
	}, [loaded, meta, hits, searching, parsed.mode, parsed.text, go, onClose, dock])

	const flat = useMemo(() => sections.flatMap((section) => section.items), [sections])
	const activeId = flat[Math.min(active, flat.length - 1)]?.id

	const onKeyDown = (event: React.KeyboardEvent) => {
		if (event.key === 'ArrowDown') {
			event.preventDefault()
			setActive((current) => (flat.length === 0 ? 0 : (current + 1) % flat.length))
		} else if (event.key === 'ArrowUp') {
			event.preventDefault()
			setActive((current) => (flat.length === 0 ? 0 : (current - 1 + flat.length) % flat.length))
		} else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
			event.preventDefault()
			flat[Math.min(active, flat.length - 1)]?.run()
		}
	}

	return (
		<ModalOverlay
			isOpen
			onOpenChange={(open) => !open && onClose()}
			isDismissable
			className="bg-scrim fixed inset-0 z-50 flex items-start justify-center px-4 pt-[10vh]"
		>
			<Modal className="w-full max-w-[640px] outline-none">
				<Dialog
					aria-label="命令面板"
					className="border-line bg-panel shadow-overlay flex max-h-[70dvh] flex-col overflow-hidden rounded-[2px] border outline-none"
				>
					<div className="border-line-soft flex items-center gap-2.5 border-b px-3.5">
						<Search aria-hidden size={16} className="text-ink-weak shrink-0" />
						<input
							autoFocus
							role="combobox"
							aria-expanded
							aria-controls="palette-list"
							aria-activedescendant={activeId === undefined ? undefined : `palette-${activeId}`}
							aria-label="搜索主题、版块或输入命令"
							value={query}
							onChange={(event) => {
								setQuery(event.target.value)
								setActive(0)
							}}
							onKeyDown={onKeyDown}
							placeholder="搜索主题 · > 命令 · # 版块"
							className="text-ink-strong placeholder:text-ink-weak/60 h-12 min-w-0 flex-1 bg-transparent text-heading outline-none"
						/>
						<kbd className="border-line text-ink-weak hidden h-5 items-center rounded-[2px] border px-1.5 font-mono text-micro sm:inline-flex">
							Esc
						</kbd>
					</div>
					<div id="palette-list" role="listbox" className="min-h-0 flex-1 overflow-y-auto py-1.5">
						{flat.length === 0 ? (
							<p className="text-ink-weak px-4 py-8 text-center">
								{loaded === null ? '加载中…' : '没有匹配的内容'}
							</p>
						) : (
							sections.map((section) => (
								<div key={section.title} role="group" aria-label={section.title}>
									<p className="section-label px-4 pt-2 pb-1">{section.title}</p>
									{section.items.map((item) => {
										const isActive = item.id === activeId
										return (
											<div
												key={item.id}
												id={`palette-${item.id}`}
												role="option"
												aria-selected={isActive}
												data-active={isActive}
												ref={isActive ? scrollNearest : undefined}
												onMouseMove={() => setActive(flat.indexOf(item))}
												onClick={item.run}
												className={`mx-1.5 flex cursor-pointer items-center gap-3 rounded-[2px] border-l-2 px-2.5 py-2 ${
													isActive
														? 'border-l-accent bg-selected text-ink-strong'
														: 'text-ink border-l-transparent'
												}`}
											>
												<item.icon aria-hidden size={14} className="text-ink-weak shrink-0" />
												<span className="min-w-0 flex-1 truncate">{item.label}</span>
												{item.hint !== undefined && (
													<span className="text-ink-weak shrink-0 text-meta">{item.hint}</span>
												)}
											</div>
										)
									})}
								</div>
							))
						)}
					</div>
					<div className="border-line-soft text-ink-weak flex items-center gap-4 border-t px-3.5 py-2 text-meta max-sm:hidden">
						<span>↑↓ 选择</span>
						<span>↵ 执行</span>
						<span className="ml-auto">
							<span className="text-ink">&gt;</span> 命令 <span className="text-ink ml-2">#</span>{' '}
							版块
						</span>
					</div>
				</Dialog>
			</Modal>
		</ModalOverlay>
	)
}
