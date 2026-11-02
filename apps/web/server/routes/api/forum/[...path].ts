// Forwards /api/forum/** to the Pluxel host so cookies, OIDC callbacks and API calls all stay
// on the forum's public origin. h3's proxyRequest streams the body and copies Set-Cookie back.
export default defineEventHandler((event) => {
	const { forumApiInternal } = useRuntimeConfig(event)
	const target = new URL(event.path, forumApiInternal)
	return proxyRequest(event, target.toString())
})
