import { Description, Input, Label, TextArea, TextField } from '@heroui/react'
import { useState } from 'react'

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

/**
 * Multi-line text with a live length count once the text nears `maxLength` (counted in UTF-16
 * units, as the browser's own limit counts).
 */
export function TextAreaField({
	name,
	label,
	hint,
	required,
	maxLength,
	defaultValue,
	placeholder,
	autoFocus,
	className,
	rows = 6,
	hideLabel = false,
}: FieldBase & { rows?: number; hideLabel?: boolean }) {
	const [length, setLength] = useState(defaultValue?.length ?? 0)
	const showCount = maxLength !== undefined && length > maxLength * 0.8
	return (
		<TextField
			name={name}
			isRequired={required}
			maxLength={maxLength}
			defaultValue={defaultValue}
			className={className}
			onChange={(value) => setLength(value.length)}
			fullWidth
		>
			<Label className={hideLabel ? 'sr-only' : undefined}>{label}</Label>
			<TextArea rows={rows} placeholder={placeholder} autoFocus={autoFocus} />
			{(hint !== undefined || showCount) && (
				<div className="text-ink-weak flex items-start justify-between gap-3 text-[12px]">
					<span>{hint}</span>
					{showCount && (
						<span className="tabular-nums" aria-live="polite">
							{length} / {maxLength}
						</span>
					)}
				</div>
			)}
		</TextField>
	)
}
