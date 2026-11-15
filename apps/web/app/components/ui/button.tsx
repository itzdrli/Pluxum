import { Button as HeroButton, buttonVariants } from '@heroui/react'
import type { ComponentProps } from 'react'
import { Link } from 'react-router'

/**
 * primary: the one main action of a view. secondary: other actions. ghost: actions in toolbars and
 * menus that should not compete with content. danger: destructive confirmations.
 */
export type ButtonTone = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger'
/** sm 28px, md 32px, lg 36px. */
export type ButtonSize = 'sm' | 'md' | 'lg'

type HeroButtonProps = ComponentProps<typeof HeroButton>

export function Button({
	tone = 'secondary',
	size = 'md',
	...props
}: Omit<HeroButtonProps, 'variant' | 'size'> & { tone?: ButtonTone; size?: ButtonSize }) {
	return <HeroButton variant={tone} size={size} {...props} />
}

/** An icon-only button; `label` names it for assistive technology and the tooltip. */
export function IconButton({
	label,
	tone = 'ghost',
	size = 'md',
	...props
}: Omit<HeroButtonProps, 'variant' | 'size' | 'isIconOnly' | 'aria-label'> & {
	label: string
	tone?: ButtonTone
	size?: ButtonSize
}) {
	return (
		<HeroButton
			variant={tone}
			size={size}
			isIconOnly
			aria-label={label}
			// The native tooltip is enough here and needs no JavaScript.
			{...{ title: label }}
			{...props}
		/>
	)
}

/** A client-side navigation link that looks like a button. */
export function ButtonLink({
	to,
	tone = 'secondary',
	size = 'md',
	className,
	children,
	...rest
}: {
	to: string
	tone?: ButtonTone
	size?: ButtonSize
	className?: string
	children: React.ReactNode
} & Omit<ComponentProps<typeof Link>, 'to' | 'className' | 'children'>) {
	return (
		<Link to={to} className={buttonVariants({ variant: tone, size, className })} {...rest}>
			{children}
		</Link>
	)
}

/** A full document navigation styled as a button, for URLs outside the client router (login). */
export function ButtonAnchor({
	href,
	tone = 'secondary',
	size = 'md',
	className,
	children,
	...rest
}: {
	href: string
	tone?: ButtonTone
	size?: ButtonSize
	className?: string
	children: React.ReactNode
} & Omit<ComponentProps<'a'>, 'href' | 'className' | 'children'>) {
	return (
		<a href={href} className={buttonVariants({ variant: tone, size, className })} {...rest}>
			{children}
		</a>
	)
}
