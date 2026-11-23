import { type RouteConfig, index, layout, route } from '@react-router/dev/routes'

// Every page sits inside the stage layout, which owns the category column, so the frame is the
// same from the overview to a thread. Every list route (`handle.stage.layer === 'list'`) opens
// threads beside it through a nested `t/:id` detail, so a thread reached from a category, a search
// or a profile keeps that list in view. See app/lib/stage.ts.
export default [
	layout('routes/forum-stage.tsx', [
		index('routes/home.tsx'),
		route('c/:slug', 'routes/category.tsx', [
			route('new', 'routes/thread-new.tsx'),
			route('t/:id', 'routes/thread.tsx'),
		]),
		route('search', 'routes/search.tsx', [
			route('t/:id', 'routes/thread.tsx', { id: 'routes/search-thread' }),
		]),
		route('u/:userId', 'routes/user.tsx', [
			route('t/:id', 'routes/thread.tsx', { id: 'routes/user-thread' }),
		]),
		route('messages', 'routes/messages.tsx', [route(':id', 'routes/conversation.tsx')]),
		route('notifications', 'routes/notifications.tsx'),
		route('moderation', 'routes/moderation.tsx'),
		route('login', 'routes/login.tsx'),
		route('reset-password', 'routes/reset-password.tsx'),
	]),
	route('t/:id/:floor?', 'routes/thread-shortlink.ts'),
	route('manifest.webmanifest', 'routes/manifest.ts'),
	// Atom feeds of the site, a category and a person.
	route('feed.xml', 'routes/feed.ts', { id: 'routes/feed-site' }),
	route('c/:slug/feed.xml', 'routes/feed.ts', { id: 'routes/feed-category' }),
	route('u/:userId/feed.xml', 'routes/feed.ts', { id: 'routes/feed-user' }),
	// Write actions of extension plugins, called by their slot components.
	route('ext/:extId/:action', 'routes/ext-action.ts'),
	// Resource route: forwards the forum API to the Pluxel host on this same origin.
	route('api/forum/*', 'routes/api-forum.ts'),
	// Any other URL: matching a route lets the root loader run, so the 404 page is in the visitor's
	// language and keeps the shell's data like every other page.
	route('*', 'routes/not-found.tsx'),
] satisfies RouteConfig
