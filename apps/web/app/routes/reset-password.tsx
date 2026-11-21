import { t as tm } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { data, Form, Link, redirect, useNavigation } from 'react-router'

import type { Route } from './+types/reset-password'
import { Button } from '../components/ui/button'
import { FormError, Notice, PageHeader } from '../components/ui/display'
import { TextInputField } from '../components/ui/field'
import {
	accountsCall,
	invalidateForumCaches,
	textField,
	type AccountOptions,
} from '../lib/forum-api.server'
import { i18nOfRoot } from '../lib/i18n'
import { i18nFromRequest } from '../lib/i18n.server'
import { defineStage } from '../lib/stage'
import { pageTitle } from '../lib/site'

export const handle = defineStage({ layer: 'page' })

const TOKEN = /^[\w-]{43}$/

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	const title = tm(i18nOfRoot(matches[0].loaderData))`重设密码`
	return [
		{ title: pageTitle(matches[0].loaderData, title) },
		{ name: 'robots', content: 'noindex' },
	]
}

export async function loader({ request }: Route.LoaderArgs) {
	const raw = new URL(request.url).searchParams.get('token')
	const token = raw !== null && TOKEN.test(raw) ? raw : null
	const { result } = await accountsCall<AccountOptions>(request, '/options')
	return {
		token,
		passwordMin: result.ok ? result.value.passwordMin : 8,
		// Mail is needed to ask for a link here; a link from an administrator works without it.
		canRequest: result.ok && result.value.reset,
	}
}

type ActionResponse = Readonly<{ error?: string; sent?: boolean }>

export async function action({ request }: Route.ActionArgs) {
	const form = await request.formData()
	const intent = textField(form, 'intent')
	if (intent === 'request') {
		const { result } = await accountsCall(request, '/reset-request', {
			email: textField(form, 'email'),
		})
		const response: ActionResponse = result.ok ? { sent: true } : { error: result.error.message }
		return data(response, { status: result.ok ? 200 : result.status })
	}
	if (intent === 'reset') {
		const { result, setCookie } = await accountsCall(request, '/reset', {
			token: textField(form, 'token'),
			password: textField(form, 'password'),
		})
		if (!result.ok) {
			const failure: ActionResponse = { error: result.error.message }
			return data(failure, { status: result.status })
		}
		invalidateForumCaches()
		return redirect('/', setCookie === null ? undefined : { headers: { 'set-cookie': setCookie } })
	}
	const failure: ActionResponse = { error: tm(await i18nFromRequest(request))`不支持的操作` }
	return data(failure, { status: 400 })
}

export default function ResetPasswordRoute({ loaderData, actionData }: Route.ComponentProps) {
	const { t } = useLingui()
	const { token, passwordMin, canRequest } = loaderData
	const busy = useNavigation().state === 'submitting'

	return (
		<>
			<PageHeader title={t`重设密码`} />
			<div className="mx-auto flex w-full max-w-sm flex-col gap-4 px-4 py-6">
				{token !== null ? (
					<Form method="post" className="flex flex-col gap-4">
						<input type="hidden" name="intent" value="reset" />
						<input type="hidden" name="token" value={token} />
						<TextInputField
							name="password"
							type="password"
							label={t`新密码`}
							autoComplete="new-password"
							required
							minLength={passwordMin}
							maxLength={256}
							autoFocus
						/>
						<FormError message={actionData?.error} />
						<Button type="submit" tone="primary" isDisabled={busy} fullWidth>
							<Trans>设置新密码</Trans>
						</Button>
					</Form>
				) : actionData?.sent === true ? (
					<Notice tone="success">
						<Trans>如果这个邮箱注册过，重设链接已经发出。</Trans>
					</Notice>
				) : canRequest ? (
					<Form method="post" className="flex flex-col gap-4">
						<input type="hidden" name="intent" value="request" />
						<TextInputField
							name="email"
							type="email"
							label={t`邮箱`}
							autoComplete="email"
							required
							maxLength={254}
							autoFocus
						/>
						<FormError message={actionData?.error} />
						<Button type="submit" tone="primary" isDisabled={busy} fullWidth>
							<Trans>发送重设链接</Trans>
						</Button>
					</Form>
				) : (
					<Notice tone="info">
						<Trans>本站没有配置邮件，请联系管理员重设密码。</Trans>
					</Notice>
				)}
				<Link to="/login" className="text-ink-weak hover:text-ink-strong text-meta">
					<Trans>返回登录</Trans>
				</Link>
			</div>
		</>
	)
}
