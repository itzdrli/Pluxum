import { t as tm } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { LogIn } from 'lucide-react'
import { data, Form, Link, redirect, useNavigation } from 'react-router'

import type { Route } from './+types/login'
import { Button, ButtonAnchor } from '../components/ui/button'
import { EmptyState, FormError, PageHeader } from '../components/ui/display'
import { TextInputField } from '../components/ui/field'
import {
	accountsCall,
	forumApi,
	invalidateForumCaches,
	orThrow,
	textField,
	type AccountOptions,
} from '../lib/forum-api.server'
import { i18nOfRoot } from '../lib/i18n'
import { i18nFromRequest } from '../lib/i18n.server'
import { safeReturnTo } from '../lib/login'
import { defineStage } from '../lib/stage'
import { pageTitle } from '../lib/site'

export const handle = defineStage({ layer: 'page' })

type Mode = 'login' | 'register'

function modeOf(url: URL): Mode {
	return url.searchParams.get('mode') === 'register' ? 'register' : 'login'
}

export function meta({ matches, loaderData }: Route.MetaArgs): Route.MetaDescriptors {
	const i18n = i18nOfRoot(matches[0].loaderData)
	const title = loaderData?.mode === 'register' ? tm(i18n)`注册` : tm(i18n)`登录`
	return [
		{ title: pageTitle(matches[0].loaderData, title) },
		{ name: 'robots', content: 'noindex' },
	]
}

export async function loader({ request }: Route.LoaderArgs) {
	const url = new URL(request.url)
	const returnTo = safeReturnTo(url.searchParams.get('returnTo'))
	const forumMeta = orThrow(await forumApi.meta(request))
	if (forumMeta.viewer.user !== null) throw redirect(returnTo)
	const providerHref = forumMeta.auth.provider
		? `/api/forum/auth/login?returnTo=${encodeURIComponent(returnTo)}`
		: null
	// Without password login this page has nothing of its own: the provider is the way in.
	if (!forumMeta.auth.password && providerHref !== null) throw redirect(providerHref)
	const options: AccountOptions | null = forumMeta.auth.password
		? await accountsCall<AccountOptions>(request, '/options').then(({ result }) =>
				result.ok ? result.value : null,
			)
		: null
	const mode = options?.registration === true ? modeOf(url) : 'login'
	return { returnTo, providerHref, options, mode }
}

type ActionResponse = Readonly<{ error: string }>

export async function action({ request }: Route.ActionArgs) {
	const form = await request.formData()
	const returnTo = safeReturnTo(textField(form, 'returnTo'))
	const intent = textField(form, 'intent')
	const email = textField(form, 'email')
	const password = textField(form, 'password')
	const call =
		intent === 'register'
			? accountsCall<{ userId: string }>(request, '/register', {
					email,
					password,
					displayName: textField(form, 'displayName'),
				})
			: intent === 'login'
				? accountsCall<{ userId: string }>(request, '/login', { email, password })
				: null
	if (call === null) {
		const failure: ActionResponse = { error: tm(await i18nFromRequest(request))`不支持的操作` }
		return data(failure, { status: 400 })
	}
	const { result, setCookie } = await call
	if (!result.ok) {
		const failure: ActionResponse = { error: result.error.message }
		return data(failure, { status: result.status })
	}
	invalidateForumCaches()
	return redirect(
		returnTo,
		setCookie === null ? undefined : { headers: { 'set-cookie': setCookie } },
	)
}

export default function LoginRoute({ loaderData, actionData }: Route.ComponentProps) {
	const { t } = useLingui()
	const { returnTo, providerHref, options, mode } = loaderData
	const navigation = useNavigation()
	const busy = navigation.state === 'submitting'
	const register = mode === 'register'
	const title = register ? t`注册` : t`登录`
	const back = `returnTo=${encodeURIComponent(returnTo)}`

	if (options === null) {
		return (
			<>
				<PageHeader title={title} />
				<EmptyState icon={LogIn} title={t`登录尚未配置`} />
			</>
		)
	}

	return (
		<>
			<PageHeader title={title} />
			<div className="mx-auto flex w-full max-w-sm flex-col gap-5 px-4 py-6">
				<Form method="post" className="flex flex-col gap-4" key={mode}>
					<input type="hidden" name="intent" value={mode} />
					<input type="hidden" name="returnTo" value={returnTo} />
					<TextInputField
						name="email"
						type="email"
						label={t`邮箱`}
						autoComplete="email"
						required
						maxLength={254}
						autoFocus
					/>
					{register && (
						<TextInputField
							name="displayName"
							label={t`昵称`}
							autoComplete="nickname"
							required
							maxLength={40}
						/>
					)}
					<TextInputField
						name="password"
						type="password"
						label={t`密码`}
						autoComplete={register ? 'new-password' : 'current-password'}
						required
						minLength={register ? options.passwordMin : undefined}
						maxLength={256}
					/>
					<FormError message={actionData?.error} />
					<Button type="submit" tone="primary" isDisabled={busy} fullWidth>
						{title}
					</Button>
				</Form>
				<div className="text-ink-weak flex flex-wrap items-center justify-between gap-2 text-meta">
					{options.registration &&
						(register ? (
							<Link to={`/login?${back}`} className="hover:text-ink-strong">
								<Trans>已有账号？登录</Trans>
							</Link>
						) : (
							<Link to={`/login?mode=register&${back}`} className="hover:text-ink-strong">
								<Trans>没有账号？注册</Trans>
							</Link>
						))}
					{!register && options.reset && (
						<Link to="/reset-password" className="hover:text-ink-strong">
							<Trans>忘记密码</Trans>
						</Link>
					)}
				</div>
				{providerHref !== null && (
					// A document navigation: the API redirects to the identity provider.
					<ButtonAnchor href={providerHref}>
						<Trans>用外部账号登录</Trans>
					</ButtonAnchor>
				)}
			</div>
		</>
	)
}
