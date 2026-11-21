import { Description, Input, Label, TextField } from '@heroui/react'
import { ChevronDown } from 'lucide-react'
import type { ComponentProps } from 'react'

type FieldBase = {
	name: string
	label: string
	/** Help text under the field. */
	hint?: string
	required?: boolean
	maxLength?: number
	defaultValue?: string
	placeholder?: string
	autoFocus?: boolean
	className?: string
}

export function TextInputField({
	name,
	label,
	hint,
	required,
	maxLength,
	defaultValue,
	placeholder,
	autoFocus,
	className,
	pattern,
	type,
	autoComplete,
	minLength,
}: FieldBase & {
	pattern?: string
	type?: 'text' | 'email' | 'password'
	autoComplete?: string
	minLength?: number
}) {
	return (
		<TextField
			name={name}
			isRequired={required}
			maxLength={maxLength}
			minLength={minLength}
			type={type}
			autoComplete={autoComplete}
			defaultValue={defaultValue}
			className={className}
			fullWidth
		>
			<Label>{label}</Label>
			<Input placeholder={placeholder} autoFocus={autoFocus} pattern={pattern} />
			{hint !== undefined && <Description>{hint}</Description>}
		</TextField>
	)
}

/**
 * A native `<select>` dressed as the forum's fields: same height, border, corner and focus colour
 * as the inputs beside it, with the theme's chevron instead of the browser's own arrow. Native, so
 * phones keep their own picker. `className` sizes the wrapper.
 */
export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
	return (
		<span className={`relative inline-flex min-w-0 ${className ?? ''}`}>
			<select
				{...props}
				className="border-line bg-page text-ink-strong hover:border-ink-weak focus:border-accent h-control w-full min-w-0 cursor-pointer appearance-none truncate rounded-[2px] border pr-8 pl-2.5 text-ui outline-none"
			/>
			<ChevronDown
				aria-hidden
				size={14}
				className="text-ink-weak pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2"
			/>
		</span>
	)
}
