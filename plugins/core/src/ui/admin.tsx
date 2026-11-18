import {
	ActionIcon,
	Alert,
	Badge,
	Button,
	Checkbox,
	Group,
	Loader,
	Modal,
	Pagination,
	Stack,
	Table,
	Tabs,
	Text,
	Textarea,
	TextInput,
	Title,
} from '@mantine/core'
import { WorkbenchMantineProvider } from '@pluxel/workbench/mantine'
import { IconArrowDown, IconArrowUp, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react'
import { useState, type FormEvent } from 'react'
import type { AdminCategory, AdminResult, AdminRole } from '../workbench.ts'
import {
	adminScope,
	categoriesQuery,
	createCategory,
	deleteCategory,
	moveCategory,
	setRole,
	updateCategory,
	usersQuery,
} from './admin.scope.ts'

type Host = ReturnType<typeof adminScope.useWorkbench>['host']

/** Reports a change's outcome; true when it went through. */
function report(host: Host, result: AdminResult, success: string): boolean {
	if (result.ok) {
		host.notify({ message: success, tone: 'success' })
		return true
	}
	host.notify({ message: result.message, tone: 'error' })
	return false
}

function failure(host: Host, error: unknown) {
	host.notify({ message: error instanceof Error ? error.message : String(error), tone: 'error' })
}

type Draft = { name: string; slug: string; description: string }

function CategoryForm({
	initial,
	busy,
	onSubmit,
	onCancel,
}: {
	initial: Draft
	busy: boolean
	onSubmit: (draft: Draft) => void
	onCancel: () => void
}) {
	const [draft, setDraft] = useState(initial)
	const submit = (event: FormEvent) => {
		event.preventDefault()
		onSubmit(draft)
	}
	return (
		<form onSubmit={submit}>
			<Stack gap="sm">
				<TextInput
					label="名称"
					required
					value={draft.name}
					onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
				/>
				<TextInput
					label="标识"
					description="出现在地址里，例如 /c/general。留空时由名称生成。"
					value={draft.slug}
					onChange={(event) => setDraft({ ...draft, slug: event.currentTarget.value })}
				/>
				<Textarea
					label="简介"
					autosize
					minRows={2}
					value={draft.description}
					onChange={(event) => setDraft({ ...draft, description: event.currentTarget.value })}
				/>
				<Group justify="flex-end">
					<Button variant="default" onClick={onCancel} disabled={busy}>
						取消
					</Button>
					<Button type="submit" loading={busy}>
						保存
					</Button>
				</Group>
			</Stack>
		</form>
	)
}

function CategoriesPanel({ host }: { host: Host }) {
	const categories = categoriesQuery.useQuery()
	const create = createCategory.useMutation()
	const update = updateCategory.useMutation()
	const remove = deleteCategory.useMutation()
	const move = moveCategory.useMutation()
	const [editing, setEditing] = useState<AdminCategory | 'new' | null>(null)

	const save = async (draft: Draft) => {
		try {
			const result =
				editing === 'new'
					? await create.mutateAsync(draft)
					: editing !== null
						? await update.mutateAsync({ id: editing.id, input: draft })
						: null
			if (result && report(host, result, editing === 'new' ? '版块已创建' : '版块已保存')) {
				setEditing(null)
			}
		} catch (error) {
			failure(host, error)
		}
	}

	const confirmDelete = async (category: AdminCategory) => {
		const confirmed = await host.confirm({
			title: '删除版块',
			message: `确定删除“${category.name}”吗？只有从未有过主题的版块可以删除。`,
			confirmLabel: '删除',
			tone: 'danger',
		})
		if (!confirmed) return
		try {
			report(host, await remove.mutateAsync(category.id), '版块已删除')
		} catch (error) {
			failure(host, error)
		}
	}

	const shift = async (category: AdminCategory, direction: 'up' | 'down') => {
		try {
			const result = await move.mutateAsync({ id: category.id, direction })
			if (!result.ok) host.notify({ message: result.message, tone: 'error' })
		} catch (error) {
			failure(host, error)
		}
	}

	if (categories.status === 'pending') return <Loader size="sm" />
	if (categories.data === undefined) {
		return (
			<Alert color="red" title="读取失败">
				<Button size="xs" variant="light" onClick={() => void categories.refetch().catch(() => {})}>
					重试
				</Button>
			</Alert>
		)
	}

	const list = categories.data
	return (
		<Stack gap="md">
			<Group justify="space-between">
				<Text size="sm" c="dimmed">
					版块按这里的顺序显示在论坛首页。
				</Text>
				<Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
					新建版块
				</Button>
			</Group>
			<Table striped highlightOnHover verticalSpacing="xs">
				<Table.Thead>
					<Table.Tr>
						<Table.Th>名称</Table.Th>
						<Table.Th>标识</Table.Th>
						<Table.Th>简介</Table.Th>
						<Table.Th ta="right">主题</Table.Th>
						<Table.Th ta="right">帖子</Table.Th>
						<Table.Th />
					</Table.Tr>
				</Table.Thead>
				<Table.Tbody>
					{list.map((category, index) => (
						<Table.Tr key={category.id}>
							<Table.Td fw={600}>{category.name}</Table.Td>
							<Table.Td>
								<Text size="sm" ff="monospace">
									{category.slug}
								</Text>
							</Table.Td>
							<Table.Td maw={360}>
								<Text size="sm" lineClamp={2}>
									{category.description}
								</Text>
							</Table.Td>
							<Table.Td ta="right">{category.threadCount}</Table.Td>
							<Table.Td ta="right">{category.postCount}</Table.Td>
							<Table.Td>
								<Group gap={4} justify="flex-end" wrap="nowrap">
									<ActionIcon
										variant="subtle"
										aria-label="上移"
										disabled={index === 0 || move.isPending}
										onClick={() => void shift(category, 'up')}
									>
										<IconArrowUp size={16} />
									</ActionIcon>
									<ActionIcon
										variant="subtle"
										aria-label="下移"
										disabled={index === list.length - 1 || move.isPending}
										onClick={() => void shift(category, 'down')}
									>
										<IconArrowDown size={16} />
									</ActionIcon>
									<ActionIcon
										variant="subtle"
										aria-label="编辑"
										onClick={() => setEditing(category)}
									>
										<IconPencil size={16} />
									</ActionIcon>
									<ActionIcon
										variant="subtle"
										color="red"
										aria-label="删除"
										disabled={category.threadCount > 0}
										title={category.threadCount > 0 ? '版块内已有主题，不能删除' : undefined}
										onClick={() => void confirmDelete(category)}
									>
										<IconTrash size={16} />
									</ActionIcon>
								</Group>
							</Table.Td>
						</Table.Tr>
					))}
				</Table.Tbody>
			</Table>
			{list.length === 0 && (
				<Text size="sm" c="dimmed">
					还没有版块。
				</Text>
			)}
			<Modal
				opened={editing !== null}
				onClose={() => setEditing(null)}
				title={editing === 'new' ? '新建版块' : '编辑版块'}
			>
				{editing !== null && (
					<CategoryForm
						initial={
							editing === 'new'
								? { name: '', slug: '', description: '' }
								: { name: editing.name, slug: editing.slug, description: editing.description }
						}
						busy={create.isPending || update.isPending}
						onSubmit={(draft) => void save(draft)}
						onCancel={() => setEditing(null)}
					/>
				)}
			</Modal>
		</Stack>
	)
}

const ROLE_LABELS: Readonly<Record<AdminRole, string>> = { moderator: '版主', admin: '管理员' }

function UsersPanel({ host }: { host: Host }) {
	const [search, setSearch] = useState('')
	const [query, setQuery] = useState('')
	const [page, setPage] = useState(1)
	const users = usersQuery.useQuery({ query, page })
	const changeRole = setRole.useMutation()

	const toggle = async (userId: string, role: AdminRole, granted: boolean) => {
		try {
			report(
				host,
				await changeRole.mutateAsync({ userId, role, granted }),
				granted ? `已授予${ROLE_LABELS[role]}` : `已撤销${ROLE_LABELS[role]}`,
			)
		} catch (error) {
			failure(host, error)
		}
	}

	return (
		<Stack gap="md">
			<form
				onSubmit={(event) => {
					event.preventDefault()
					setQuery(search.trim())
					setPage(1)
				}}
			>
				<Group align="flex-end">
					<TextInput
						label="查找用户"
						placeholder="用户名或昵称"
						value={search}
						onChange={(event) => setSearch(event.currentTarget.value)}
						style={{ flex: 1 }}
					/>
					<Button type="submit" variant="light">
						查找
					</Button>
				</Group>
			</form>
			<Text size="sm" c="dimmed">
				配置里“管理员”名单中的账号每次登录都会重新获得管理员角色，在这里撤销只到下次登录为止。
			</Text>
			{users.status === 'pending' ? (
				<Loader size="sm" />
			) : users.data === undefined ? (
				<Alert color="red" title="读取失败" />
			) : (
				<>
					<Table striped verticalSpacing="xs">
						<Table.Thead>
							<Table.Tr>
								<Table.Th>#</Table.Th>
								<Table.Th>昵称</Table.Th>
								<Table.Th>用户名</Table.Th>
								<Table.Th>注册时间</Table.Th>
								<Table.Th>角色</Table.Th>
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{users.data.items.map((user) => (
								<Table.Tr key={user.id}>
									<Table.Td>{user.number}</Table.Td>
									<Table.Td fw={600}>{user.displayName}</Table.Td>
									<Table.Td>
										<Text size="sm" ff="monospace">
											@{user.handle}
										</Text>
									</Table.Td>
									<Table.Td>{new Date(user.createdAt).toLocaleString('zh-CN')}</Table.Td>
									<Table.Td>
										<Group gap="md" wrap="nowrap">
											{(['moderator', 'admin'] as const).map((role) => (
												<Checkbox
													key={role}
													label={ROLE_LABELS[role]}
													checked={user.roles.includes(role)}
													disabled={changeRole.isPending}
													onChange={(event) =>
														void toggle(user.id, role, event.currentTarget.checked)
													}
												/>
											))}
										</Group>
									</Table.Td>
								</Table.Tr>
							))}
						</Table.Tbody>
					</Table>
					{users.data.items.length === 0 && (
						<Text size="sm" c="dimmed">
							没有找到用户。
						</Text>
					)}
					<Group justify="space-between">
						<Text size="sm" c="dimmed">
							共 {users.data.total} 人
						</Text>
						<Pagination
							size="sm"
							value={page}
							onChange={setPage}
							total={Math.max(1, Math.ceil(users.data.total / users.data.pageSize))}
						/>
					</Group>
				</>
			)}
		</Stack>
	)
}

function ForumAdmin() {
	const { host } = adminScope.useWorkbench()
	return (
		<WorkbenchMantineProvider colorScheme={host.colorScheme}>
			<Stack gap="md" p="lg" h="100%" style={{ overflow: 'auto' }}>
				<Group gap="xs">
					<Title order={3}>论坛管理</Title>
					<Badge variant="light">管理员身份</Badge>
				</Group>
				<Tabs defaultValue="categories" keepMounted={false}>
					<Tabs.List>
						<Tabs.Tab value="categories">版块</Tabs.Tab>
						<Tabs.Tab value="users">用户</Tabs.Tab>
					</Tabs.List>
					<Tabs.Panel value="categories" pt="md">
						<CategoriesPanel host={host} />
					</Tabs.Panel>
					<Tabs.Panel value="users" pt="md">
						<UsersPanel host={host} />
					</Tabs.Panel>
				</Tabs>
			</Stack>
		</WorkbenchMantineProvider>
	)
}

export default adminScope.render(ForumAdmin)
