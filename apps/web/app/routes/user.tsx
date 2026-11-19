import { parseThreadRef, type CategoryDto, type Role, type UserDto } from '@pluxum/domain'
import { msg } from '@lingui/core/macro'
import { CalendarDays, MessagesSquare } from 'lucide-react'
import { useState } from 'react'
import {
	data,
	Form,
	redirect,
	useNavigation,
	useParams,
	useRouteLoaderData,
	useSearchParams,
} from 'react-router'

import type { Route } from './+types/user'
import type { loader as stageLoader } from './forum-stage'
import { NoteCard } from '../components/forum/note-card'
import { ThreadRow } from '../components/forum/rows'
import { UserAvatar } from '../components/forum/user-avatar'
import {
	FoldListButton,
	StageLink,
	StageSplit,
	useOpenThreadRef,
	useStageLinks,
} from '../components/stage/stage'
import { Button } from '../components/ui/button'
import {
	EmptyState,
	FormError,
	PaneBar,
	Panel,
	TabIndicator,
	Tag,
	Timestamp,
} from '../components/ui/display'
import { TextInputField } from '../components/ui/field'
import { Pager } from '../components/ui/pager'
import { forumApi, orThrow, textField } from '../lib/forum-api.server'
import {
	defineStage,
	isDetailPath,
	LIST_PAGE_PARAM,
	listPageOf,
	listShouldRevalidate,
} from '../lib/stage'
import type { loader as rootLoader } from '../root'
import { ProfileSlots, UserHeaderSlots } from '../slots/slots'
import { pageTitle } from '../lib/site'

const ROLE_LABELS: Readonly<Record<Role, string>> = {
	guest: '游客',
	member: '成员',
	moderator: '版主',
	admin: '管理员',
}

/** `?tab=notes` lists the member's notes instead of their topics; threads opened beside keep it. */
const PROFILE_CARRY = ['tab'] as const

export const handle = defineStage({
	layer: 'list',
	nav: true,
	backLabel: msg`返回主页`,
	carry: PROFILE_CARRY,
})

export function meta({ loaderData, matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: pageTitle(matches[0].loaderData, loaderData?.user.displayName) }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const url = new URL(request.url)
	const detailOpen = isDetailPath(url.pathname)
	const kind = url.searchParams.get('tab') === 'notes' ? 'note' : 'topic'
	const profile = orThrow(
		await forumApi.userProfile(request, params.userId, listPageOf(url, detailOpen), kind),
	)
	if (params.userId !== profile.user.handle) {
		const suffix = detailOpen && params.id !== undefined ? `/t/${params.id}` : ''
		throw redirect(`/u/${profile.user.handle}${suffix}${url.search}`)
	}
	return profile
}

export const shouldRevalidate = listShouldRevalidate(PROFILE_CARRY)

type ActionFailure = Readonly<{ error: string }>

export async function action({ request, params }: Route.ActionArgs) {
	const form = await request.formData()
	const displayName = textField(form, 'displayName')
	const nextHandle = textField(form, 'handle').trim()
	const result = await forumApi.updateProfile(request, params.userId, {
		displayName,
		...(nextHandle === '' ? {} : { handle: nextHandle }),
	})
	if (result.ok) {
		if (result.value.handle !== params.userId) {
			// Keep the thread that was open beside the profile (the form posts to the profile route,
			// so it says which one) across the move to the new address.
			const openThread = parseThreadRef(textField(form, 'openThread'))
				? textField(form, 'openThread')
				: ''
			const suffix = openThread === '' ? '' : `/t/${openThread}`
			return redirect(`/u/${result.value.handle}${suffix}`)
		}
		return null
	}
	const failure: ActionFailure = { error: result.error.message }
	return data(failure, { status: result.status })
}

export default function UserProfile({ loaderData, actionData }: Route.ComponentProps) {
	const { user, roles, createdAt, threadCount, noteCount, postCount, threads, can } = loaderData
	const [searchParams] = useSearchParams()
	const tab = searchParams.get('tab') === 'notes' ? 'notes' : 'topics'
	const forum = useRouteLoaderData<typeof rootLoader>('root')?.meta
	// The profile identity the edit form was opened for. A saved change differs from it, closing it.
	const profileIdentity = `${user.handle}:${user.displayName}`
	const [renamingFrom, setRenamingFrom] = useState<string | undefined>(undefined)
	const renaming = renamingFrom === profileIdentity
	const isSelf = forum?.viewer.user?.id === user.id
	// Roles are listed weakest first; members are the default and need no tag.
	const shownRoles = roles.filter((role) => role !== 'member' && role !== 'guest')
	const openRef = useOpenThreadRef()
	const { detail } = useStageLinks()
	const categories = useRouteLoaderData<typeof stageLoader>('routes/forum-stage')?.categories

	return (
		<StageSplit label={`${user.displayName} 的主页`} short={user.displayName}>
			{(detailOpen) =>
				detailOpen ? (
					<>
						{/* The list's head beside a detail: whose threads, and the way to fold the list away. */}
						<PaneBar className="gap-2.5!">
							<UserAvatar user={user} size="sm" />
							<div className="min-w-0 flex-1 leading-tight">
								<p className="text-ink-strong truncate font-bold">{user.displayName}</p>
								<p className="text-ink-weak text-meta tabular-nums">
									{tab === 'notes' ? `${noteCount} 动态` : `${threadCount} 主题`}
								</p>
							</div>
							<FoldListButton />
						</PaneBar>
						<UserThreads
							threads={threads}
							categories={categories}
							activeId={openRef}
							detail={detail}
						/>
					</>
				) : (
					<>
						{/* The pane's head (wide screens); the card right below says whose page it is. */}
						<PaneBar>
							<p className="text-ink-strong text-heading font-bold">主页</p>
						</PaneBar>
						<Panel className="mb-6 flex flex-wrap items-start gap-4 px-4 py-4">
							<UserAvatar user={user} size="xl" />
							<div className="min-w-0 flex-1 basis-56">
								{renaming ? (
									<RenameUser
										name={user.displayName}
										userHandle={user.handle}
										max={forum?.limits.displayNameMax}
										handleMax={forum?.limits.handleMax}
										error={actionData?.error}
										onCancel={() => setRenamingFrom(undefined)}
									/>
								) : (
									<>
										<div className="flex flex-wrap items-center gap-2">
											<h1 className="text-ink-strong text-[20px] leading-snug font-bold break-words">
												{user.displayName}
											</h1>
											<span className="text-ink-weak font-mono text-meta">@{user.handle}</span>
											{shownRoles.map((role) => (
												<Tag key={role} tone="accent">
													{ROLE_LABELS[role]}
												</Tag>
											))}
											{isSelf && <Tag>我</Tag>}
										</div>
										<p className="text-ink-weak mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta">
											<span className="flex items-center gap-1">
												<CalendarDays aria-hidden size={12} />
												加入于 <Timestamp iso={createdAt} />
											</span>
											<span className="tabular-nums">{threadCount} 主题</span>
											<span className="tabular-nums">{noteCount} 动态</span>
											<span className="tabular-nums">{postCount} 回复</span>
										</p>
										<UserHeaderSlots user={user} />
									</>
								)}
							</div>
							{can.edit && !renaming && (
								<Button tone="ghost" size="sm" onPress={() => setRenamingFrom(profileIdentity)}>
									编辑资料
								</Button>
							)}
						</Panel>

						<div className="flex flex-col gap-6">
							<ProfileSlots profile={loaderData} />
							<section>
								<ProfileListTabs user={user} tab={tab} />
								<UserThreads
									threads={threads}
									categories={categories}
									activeId={openRef}
									detail={detail}
								/>
							</section>
						</div>
					</>
				)
			}
		</StageSplit>
	)
}

/** Topics or notes: two links, so each list is a URL of its own. */
function ProfileListTabs({ user, tab }: { user: UserDto; tab: 'topics' | 'notes' }) {
	const items = [
		{ id: 'topics', label: '主题', to: `/u/${user.handle}` },
		{ id: 'notes', label: '动态', to: `/u/${user.handle}?tab=notes` },
	] as const
	return (
		<nav aria-label="发布的内容" className="mb-2 flex items-center gap-4">
			{items.map((item) => (
				<StageLink
					key={item.id}
					to={item.to}
					replace
					aria-current={item.id === tab ? 'page' : undefined}
					className={`h-control relative inline-flex items-center text-ui transition-colors ${
						item.id === tab ? 'text-ink-strong font-bold' : 'text-ink-weak hover:text-ink-strong'
					}`}
				>
					{item.label}
					{item.id === tab && <TabIndicator name="profile-tab" />}
				</StageLink>
			))}
		</nav>
	)
}

function UserThreads({
	threads,
	categories,
	activeId,
	detail,
}: {
	threads: Route.ComponentProps['loaderData']['threads']
	categories: readonly CategoryDto[] | undefined
	activeId: string | undefined
	detail: (threadId: string) => string
}) {
	return (
		<>
			{threads.items.length === 0 ? (
				<EmptyState
					icon={MessagesSquare}
					title={threads.total === 0 ? '还没有发布过内容' : '这一页没有内容'}
				/>
			) : (
				<Panel as="ul" className="divide-line divide-y">
					{threads.items.map((thread) =>
						thread.kind === 'note' ? (
							<NoteCard
								key={thread.id}
								thread={thread}
								href={detail(thread.ref)}
								isActive={thread.ref === activeId || thread.id === activeId}
								showAuthor={false}
							/>
						) : (
							<ThreadRow
								key={thread.id}
								thread={thread}
								href={detail(thread.ref)}
								isActive={thread.ref === activeId || thread.id === activeId}
								category={categories?.find((category) => category.id === thread.categoryId)}
								showAuthor={false}
							/>
						),
					)}
				</Panel>
			)}
			<Pager
				page={threads.page}
				pageSize={threads.pageSize}
				total={threads.total}
				paramName={LIST_PAGE_PARAM}
			/>
		</>
	)
}

function RenameUser({
	name,
	userHandle,
	max,
	handleMax,
	error,
	onCancel,
}: {
	name: string
	userHandle: string
	max: number | undefined
	handleMax: number | undefined
	error: string | undefined
	onCancel: () => void
}) {
	const submitting = useNavigation().state === 'submitting'
	const openThread = useParams().id
	return (
		<Form method="post" className="flex flex-col gap-3">
			{openThread !== undefined && <input type="hidden" name="openThread" value={openThread} />}
			<FormError message={error} />
			<div className="grid gap-3 sm:grid-cols-2">
				<TextInputField
					name="displayName"
					label="昵称"
					required
					maxLength={max}
					defaultValue={name}
					autoFocus
				/>
				<TextInputField
					name="handle"
					label="用户名"
					required
					maxLength={handleMax}
					defaultValue={userHandle}
				/>
			</div>
			<div className="flex justify-end gap-2">
				<Button tone="ghost" onPress={onCancel}>
					取消
				</Button>
				<Button tone="primary" type="submit" isPending={submitting}>
					保存资料
				</Button>
			</div>
		</Form>
	)
}
