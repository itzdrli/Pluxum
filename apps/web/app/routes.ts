import { type RouteConfig, index, layout, route } from '@react-router/dev/routes'

// Every list route (`handle.stage.layer === 'list'`) opens threads beside it through a nested
// `t/:id` detail, so a thread reached from a category, a search or a profile keeps that list in
// view. See app/lib/stage.ts.
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
	]),
	route('t/:id', 'routes/thread-shortlink.ts'),
	route('notifications', 'routes/notifications.tsx'),
	route('moderation', 'routes/moderation.tsx'),
	// Write actions of extension plugins, called by their slot components.
	route('ext/:extId/:action', 'routes/ext-action.ts'),
	// Development only: renders the OpenUI component library from a fixed OpenUI Lang sample.
	route('dev/openui', 'routes/dev-openui.tsx'),
	// Resource route: forwards the forum API to the Pluxel host on this same origin.
	route('api/forum/*', 'routes/api-forum.ts'),
] satisfies RouteConfig
