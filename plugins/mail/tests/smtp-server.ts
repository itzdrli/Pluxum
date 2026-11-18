import { createServer, type Server, type Socket } from 'node:net'

export type ReceivedMail = Readonly<{ from: string; to: string[]; data: string }>

/**
 * Just enough of SMTP (RFC 5321) for nodemailer to hand over a message in plain text: EHLO,
 * optional AUTH PLAIN, MAIL, RCPT, DATA, RSET and QUIT. Everything it receives is kept in `mails`.
 */
export async function startSmtpServer(options: { password?: string } = {}) {
	const mails: ReceivedMail[] = []
	const logins: string[] = []
	const sockets = new Set<Socket>()
	const server: Server = createServer((socket) => {
		sockets.add(socket)
		socket.on('close', () => sockets.delete(socket))
		socket.setEncoding('utf8')
		let buffer = ''
		let inData = false
		let from = ''
		let to: string[] = []
		let data: string[] = []
		const reply = (line: string) => socket.write(`${line}\r\n`)
		reply('220 test ESMTP')
		socket.on('data', (chunk: string) => {
			buffer += chunk
			let index = buffer.indexOf('\r\n')
			while (index >= 0) {
				const line = buffer.slice(0, index)
				buffer = buffer.slice(index + 2)
				if (inData) {
					if (line === '.') {
						inData = false
						mails.push({ from, to, data: data.join('\n') })
						reply('250 queued')
					} else {
						data.push(line.startsWith('..') ? line.slice(1) : line)
					}
				} else {
					const command = line.toUpperCase()
					if (command.startsWith('EHLO')) {
						socket.write('250-test\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n')
					} else if (command.startsWith('AUTH PLAIN')) {
						const decoded = Buffer.from(line.slice(11).trim(), 'base64').toString('utf8')
						const [, user = '', pass = ''] = decoded.split('\u0000')
						if (options.password !== undefined && pass !== options.password) {
							reply('535 authentication failed')
						} else {
							logins.push(user)
							reply('235 ok')
						}
					} else if (command.startsWith('MAIL FROM:')) {
						from = line.slice(10).trim()
						to = []
						data = []
						reply('250 ok')
					} else if (command.startsWith('RCPT TO:')) {
						to.push(line.slice(8).trim())
						reply('250 ok')
					} else if (command === 'DATA') {
						inData = true
						reply('354 go ahead')
					} else if (command === 'RSET' || command === 'NOOP') {
						reply('250 ok')
					} else if (command === 'QUIT') {
						reply('221 bye')
						socket.end()
					} else {
						reply('502 not implemented')
					}
				}
				index = buffer.indexOf('\r\n')
			}
		})
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	const address = server.address()
	if (address === null || typeof address === 'string') throw new Error('No port')
	return {
		port: address.port,
		mails,
		logins,
		close: async () => {
			for (const socket of sockets) socket.destroy()
			await new Promise<void>((resolve) => server.close(() => resolve()))
		},
	}
}
