import { type RouteConfig, index, layout, route } from '@react-router/dev/routes'

export default [
	layout('routes/forum-stage.tsx', [
		index('routes/home.tsx'),
		route('c/:slug', 'routes/category.tsx', [
			route('new', 'routes/thread-new.tsx'),
			route('t/:id', 'routes/thread.tsx'),
		]),
	]),
	route('t/:id', 'routes/thread-shortlink.ts'),
	route('search', 'routes/search.tsx'),
	route('notifications', 'routes/notifications.tsx'),
	route('moderation', 'routes/moderation.tsx'),
	route('u/:id', 'routes/user.tsx'),
	route('theme', 'routes/theme.ts'),
	// Write actions of extension plugins, called by their slot components.
	route('ext/:extId/:action', 'routes/ext-action.ts'),
	// Development only: renders the OpenUI component library from a fixed OpenUI Lang sample.
	route('dev/openui', 'routes/dev-openui.tsx'),
	// Resource route: forwards the forum API to the Pluxel host on this same origin.
	route('api/forum/*', 'routes/api-forum.ts'),
] satisfies RouteConfig
