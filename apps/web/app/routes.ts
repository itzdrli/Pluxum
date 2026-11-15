import { type RouteConfig, index, route } from '@react-router/dev/routes'

export default [
	index('routes/home.tsx'),
	route('c/:slug', 'routes/category.tsx'),
	route('c/:slug/new', 'routes/thread-new.tsx'),
	route('t/:id', 'routes/thread.tsx'),
	route('theme', 'routes/theme.ts'),
	// Development only: renders the OpenUI component library from a fixed OpenUI Lang sample.
	route('dev/openui', 'routes/dev-openui.tsx'),
	// Resource route: forwards the forum API to the Pluxel host on this same origin.
	route('api/forum/*', 'routes/api-forum.ts'),
] satisfies RouteConfig
