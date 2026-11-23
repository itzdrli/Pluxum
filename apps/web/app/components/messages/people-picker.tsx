import { X } from 'lucide-react'
import { useDebouncedValue } from '@tanstack/react-pacer'
import { useEffect, useState } from 'react'
import { useLingui } from '@lingui/react/macro'

import type { MessageUser } from '../../lib/messages'
import { UserAvatar } from '../forum/user-avatar'

/** Name suggestions come from Pluxum Mentions; without it, a typed handle is taken as it is. */
async function suggest(query: string, signal: AbortSignal): Promise<MessageUser[] | null> {
	try {
		const response = await fetch(
			`/api/forum/ext/forum-mentions/suggest?q=${encodeURIComponent(query)}`,
			{
				headers: { accept: 'application/json' },
				signal,
			},
		)
		if (!response.ok) return null
		const body: unknown = await response.json()
		if (
			typeof body !== 'object' ||
			body === null ||
			!('items' in body) ||
			!Array.isArray(body.items)
		) {
			return null
		}
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- forum-mentions answers {id, handle, displayName} items, checked by the API.
		return body.items as MessageUser[]
	} catch {
		return null
	}
}

/** Picks people by name or handle; `exclude` (the viewer, current members) are not offered. */
export function PeoplePicker({
	picked,
	onChange,
	exclude,
	max,
}: {
	picked: readonly MessageUser[]
	onChange: (next: MessageUser[]) => void
	exclude: readonly string[]
	max: number
}) {
	const { t } = useLingui()
	const [query, setQuery] = useState('')
	// The suggestions and the text they answer; stale ones (for other text) are not shown.
	const [answered, setAnswered] = useState<
		Readonly<{ typed: string; found: MessageUser[] | null }>
	>({
		typed: '',
		found: [],
	})
	const typedNow = query.trim().replace(/^@/, '')
	const options = typedNow === '' ? [] : answered.typed === typedNow ? answered.found : []

	// Asks once the typing pauses; answers for older text are dropped above.
	const [settled] = useDebouncedValue(typedNow, { wait: 150 })
	useEffect(() => {
		if (settled === '') return undefined
		const controller = new AbortController()
		void (async () => {
			const found = await suggest(settled, controller.signal)
			if (!controller.signal.aborted) setAnswered({ typed: settled, found })
		})()
		return () => controller.abort()
	}, [settled])

	const hidden = new Set([...exclude, ...picked.map((user) => user.id)])
	const shown = (options ?? []).filter((user) => !hidden.has(user.id))
	const full = picked.length >= max

	const add = (user: MessageUser) => {
		if (full) return
		onChange([...picked, user])
		setQuery('')
	}

	return (
		<div className="flex flex-col gap-2">
			{picked.length > 0 && (
				<ul className="flex flex-wrap gap-1.5">
					{picked.map((user) => (
						<li
							key={user.id}
							className="border-line bg-control text-ink-strong inline-flex items-center gap-1 rounded-[2px] border py-0.5 pr-1 pl-2 text-meta"
						>
							{user.displayName}
							<button
								type="button"
								aria-label={t`移除 ${user.displayName}`}
								className="text-ink-weak hover:text-ink-strong cursor-pointer"
								onClick={() => onChange(picked.filter((other) => other.id !== user.id))}
							>
								<X aria-hidden size={12} />
							</button>
						</li>
					))}
				</ul>
			)}
			<input
				type="text"
				value={query}
				disabled={full}
				placeholder={t`输入昵称或用户名`}
				aria-label={t`添加成员`}
				onChange={(event) => setQuery(event.currentTarget.value)}
				onKeyDown={(event) => {
					if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
					event.preventDefault()
					const first = shown[0]
					const typed = query.trim().replace(/^@/, '')
					if (first !== undefined) add(first)
					// Without suggestions the handle stands for the person; the server checks it.
					else if (options === null && typed !== '')
						add({ id: typed, handle: typed, displayName: `@${typed}` })
				}}
				className="border-line bg-page text-ink-strong placeholder:text-ink-weak/60 hover:border-ink-weak focus:border-accent h-control w-full rounded-[2px] border px-2.5 text-ui outline-none disabled:opacity-60"
			/>
			{shown.length > 0 && (
				<ul className="border-line divide-line-soft max-h-52 divide-y overflow-y-auto rounded-[2px] border">
					{shown.map((user) => (
						<li key={user.id}>
							<button
								type="button"
								className="hover:bg-hover flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left"
								onClick={() => add(user)}
							>
								<UserAvatar user={user} size="sm" />
								<span className="text-ink-strong truncate">{user.displayName}</span>
								<span className="text-ink-weak truncate font-mono text-meta">@{user.handle}</span>
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	)
}
