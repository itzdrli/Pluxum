import type { Role } from '@pluxum/domain'
import { CalendarDays, MessagesSquare, Pencil } from 'lucide-react'
import { useState } from 'react'
import { data, Form, useNavigation, useParams, useRouteLoaderData } from 'react-router'

import type { Route } from './+types/user'
import { ThreadRow } from '../components/forum/rows'
import { UserAvatar } from '../components/forum/user-avatar'
import { StageSplit, useStageLinks } from '../components/stage/stage'
import { Button } from '../components/ui/button'
import {
	EmptyState,
	FormError,
	Panel,
	SectionLabel,
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
import { ProfileSlots } from '../slots/slots'

const ROLE_LABELS: Readonly<Record<Role, string>> = {
	guest: '游客',
	member: '成员',
	moderator: '版主',
	admin: '管理员',
}

export const handle = defineStage({ layer: 'list', backLabel: '主页' })

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: `${loaderData ? `${loaderData.user.displayName} · ` : ''}Pluxum` }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const url = new URL(request.url)
	return orThrow(
		await forumApi.userProfile(request, params.userId, listPageOf(url, isDetailPath(url.pathname))),
	)
}

export const shouldRevalidate = listShouldRevalidate()

type ActionFailure = Readonly<{ error: string }>

export async function action({ request, params }: Route.ActionArgs) {
	const form = await request.formData()
	const result = await forumApi.updateProfile(request, params.userId, {
		displayName: textField(form, 'displayName'),
	})
	if (result.ok) return null
	const failure: ActionFailure = { error: result.error.message }
	return data(failure, { status: result.status })
}

export default function UserProfile({ loaderData, actionData }: Route.ComponentProps) {
	const { user, roles, createdAt, threadCount, postCount, threads, can } = loaderData
	const forum = useRouteLoaderData<typeof rootLoader>('root')?.meta
	// The name the rename form was opened for. A saved name differs from it, which closes the form.
	const [renamingFrom, setRenamingFrom] = useState<string | undefined>(undefined)
	const renaming = renamingFrom === user.displayName
	const isSelf = forum?.viewer.user?.id === user.id
	// Roles are listed weakest first; members are the default and need no tag.
	const shownRoles = roles.filter((role) => role !== 'member' && role !== 'guest')
	const params = useParams()
	const { detail } = useStageLinks()

	return (
		<StageSplit label={`${user.displayName} 的主页`}>
			{(detailOpen) =>
				detailOpen ? (
					<>
						<header className="mb-3 flex items-center gap-2.5">
							<UserAvatar user={user} />
							<div className="min-w-0">
								<p className="text-ink-strong truncate text-[15px] font-bold">{user.displayName}</p>
								<p className="text-ink-weak text-[12px] tabular-nums">
									{threadCount} 主题 · {postCount} 回复
								</p>
							</div>
						</header>
						<UserThreads threads={threads} activeId={params.id} detail={detail} />
					</>
				) : (
					<>
						<Panel className="mb-6 flex flex-wrap items-start gap-4 px-4 py-4">
							<UserAvatar user={user} size="xl" />
							<div className="min-w-0 flex-1 basis-56">
								{renaming ? (
									<RenameUser
										name={user.displayName}
										max={forum?.limits.displayNameMax}
										error={actionData?.error}
										onCancel={() => setRenamingFrom(undefined)}
									/>
								) : (
									<>
										<div className="flex flex-wrap items-center gap-2">
											<h1 className="text-ink-strong text-[20px] leading-snug font-bold break-words">
												{user.displayName}
											</h1>
											{shownRoles.map((role) => (
												<Tag key={role} tone="accent">
													{ROLE_LABELS[role]}
												</Tag>
											))}
											{isSelf && <Tag>我</Tag>}
										</div>
										<p className="text-ink-weak mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
											<span className="flex items-center gap-1">
												<CalendarDays aria-hidden size={12} />
												加入于 <Timestamp iso={createdAt} />
											</span>
											<span className="tabular-nums">{threadCount} 主题</span>
											<span className="tabular-nums">{postCount} 回复</span>
										</p>
									</>
								)}
							</div>
							{can.edit && !renaming && (
								<Button tone="ghost" size="sm" onPress={() => setRenamingFrom(user.displayName)}>
									<Pencil aria-hidden />
									修改昵称
								</Button>
							)}
						</Panel>

						<div className="flex flex-col gap-6">
							<ProfileSlots profile={loaderData} />
							<section>
								<SectionLabel>发布的主题 · {threads.total}</SectionLabel>
								<UserThreads threads={threads} activeId={params.id} detail={detail} />
							</section>
						</div>
					</>
				)
			}
		</StageSplit>
	)
}

function UserThreads({
	threads,
	activeId,
	detail,
}: {
	threads: Route.ComponentProps['loaderData']['threads']
	activeId: string | undefined
	detail: (threadId: string) => string
}) {
	return (
		<>
			{threads.items.length === 0 ? (
				<EmptyState
					icon={MessagesSquare}
					title={threads.total === 0 ? '还没有发布过主题' : '这一页没有内容'}
				/>
			) : (
				<Panel as="ul" className="divide-line divide-y">
					{threads.items.map((thread) => (
						<ThreadRow
							key={thread.id}
							thread={thread}
							href={detail(thread.id)}
							isActive={thread.id === activeId}
						/>
					))}
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
	max,
	error,
	onCancel,
}: {
	name: string
	max: number | undefined
	error: string | undefined
	onCancel: () => void
}) {
	const submitting = useNavigation().state === 'submitting'
	return (
		<Form method="post" className="flex flex-col gap-2">
			<FormError message={error} />
			<TextInputField
				name="displayName"
				label="昵称"
				hint="只在本论坛显示，不会改动登录账号的名字。"
				required
				maxLength={max}
				defaultValue={name}
				autoFocus
			/>
			<div className="flex justify-end gap-2">
				<Button tone="ghost" size="sm" onPress={onCancel}>
					取消
				</Button>
				<Button tone="primary" size="sm" type="submit" isPending={submitting}>
					保存昵称
				</Button>
			</div>
		</Form>
	)
}
