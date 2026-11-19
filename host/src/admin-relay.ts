import { createConnection, createServer, type Server } from 'node:net'

/**
 * Workbench admits loopback peers without signing in and refuses everyone else over plain HTTP.
 * Inside a container nobody is loopback, so PLUXUM_ADMIN_PORT opens a second port that relays each
 * connection to the host listener from 127.0.0.1. Publish it to the machine's loopback only (the
 * compose file does) and reach it through an SSH tunnel: whoever can connect to it is admin.
 */
export function listenAdminRelay(port: number, upstreamPort: number): Promise<Server> {
	const server = createServer((client) => {
		const upstream = createConnection({ host: '127.0.0.1', port: upstreamPort })
		const close = () => {
			client.destroy()
			upstream.destroy()
		}
		client.on('error', close).on('close', close)
		upstream.on('error', close).on('close', close)
		client.pipe(upstream).pipe(client)
	})
	return new Promise((resolve, reject) => {
		server.once('error', reject)
		server.listen(port, '0.0.0.0', () => {
			server.off('error', reject)
			resolve(server)
		})
	})
}
