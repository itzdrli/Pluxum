const URL_PATTERN = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}，。；：！？）】])/g

/** A message's text as written, with web addresses as links. */
export function MessageBody({ text }: { text: string }) {
	const parts = text.split(URL_PATTERN)
	return (
		<>
			{parts.map((part, index) =>
				index % 2 === 1 ? (
					<a
						// oxlint-disable-next-line react/no-array-index-key -- parts have no identity but their order.
						key={index}
						href={part}
						target="_blank"
						rel="noopener noreferrer nofollow ugc"
						className="underline underline-offset-2 break-all"
					>
						{part}
					</a>
				) : (
					part
				),
			)}
		</>
	)
}
