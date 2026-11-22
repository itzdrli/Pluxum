// Pluxum's service worker: shows push notices (Pluxum Push) and opens the forum when one is
// clicked. It caches nothing; every page still comes from the network.

self.addEventListener('install', () => {
	self.skipWaiting()
})

self.addEventListener('activate', (event) => {
	event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
	let message = {}
	try {
		message = event.data ? event.data.json() : {}
	} catch {
		message = { title: event.data ? event.data.text() : '' }
	}
	const title = typeof message.title === 'string' && message.title !== '' ? message.title : 'Pluxum'
	const url =
		typeof message.url === 'string' && message.url.startsWith('/') ? message.url : '/notifications'
	event.waitUntil(
		self.registration.showNotification(title, {
			body: typeof message.body === 'string' ? message.body : '',
			tag: typeof message.tag === 'string' ? message.tag : undefined,
			icon: '/pwa-192.png',
			badge: '/pwa-192.png',
			data: { url },
		}),
	)
})

self.addEventListener('notificationclick', (event) => {
	event.notification.close()
	const target = new URL(event.notification.data?.url ?? '/', self.location.origin).href
	event.waitUntil(
		(async () => {
			const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
			// A forum tab already open goes to the notice's page instead of opening another.
			const open = windows.find(
				(client) => new URL(client.url).origin === self.location.origin && 'focus' in client,
			)
			if (open !== undefined) {
				await open.focus()
				if ('navigate' in open) await open.navigate(target)
				return
			}
			await self.clients.openWindow(target)
		})(),
	)
})
