import { type RouteConfig, index, route } from '@react-router/dev/routes'

export default [
	index('routes/home.tsx'),
	route('c/:slug', 'routes/category.tsx'),
	route('c/:slug/new', 'routes/thread-new.tsx'),
	route('t/:id', 'routes/thread.tsx'),
	// Resource route: forwards the forum API to the Pluxel host on this same origin.
	route('api/forum/*', 'routes/api-forum.ts'),
] satisfies RouteConfig
