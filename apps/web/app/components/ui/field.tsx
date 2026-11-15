import { Description, Input, Label, TextField } from '@heroui/react'

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
}: FieldBase & { pattern?: string }) {
	return (
		<TextField
			name={name}
			isRequired={required}
			maxLength={maxLength}
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
