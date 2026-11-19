// Catch-all route. It needs a component to count as a page (a module without one is a resource
// route and its thrown Response would be sent as the whole reply). The throw lands in the root
// ErrorBoundary, which words the 404 itself, translated.
export function loader(): never {
	// oxlint-disable-next-line only-throw-error -- React Router's contract for an error response.
	throw new Response(null, { status: 404 })
}

export default function NotFound() {
	return null
}
