import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'

/**
 * One of OWASP's equivalent scrypt settings (N = 2^15, r = 8, p = 3): 32 MiB per hash instead
 * of the 128 MiB of N = 2^17, which matters on a small server under parallel login attempts.
 */
const COST = { N: 2 ** 15, r: 8, p: 3 } as const
/** At most this many hashes run at once; the rest wait, so memory stays bounded. */
const MAX_CONCURRENT = 4
const KEY_BYTES = 32
const SALT_BYTES = 16

let running = 0
const waiting: (() => void)[] = []

async function derive(
	password: string,
	salt: Buffer,
	cost: { N: number; r: number; p: number },
): Promise<Buffer> {
	// A finishing hash hands its slot straight to the next waiter, so `running` never overshoots.
	if (running >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve))
	else running++
	try {
		const options: ScryptOptions = { ...cost, maxmem: 64 * 1024 * 1024 }
		return await new Promise<Buffer>((resolve, reject) => {
			scrypt(password.normalize('NFKC'), salt, KEY_BYTES, options, (error, key) =>
				error ? reject(error) : resolve(key),
			)
		})
	} finally {
		const next = waiting.shift()
		if (next) next()
		else running--
	}
}

/** `scrypt$N$r$p$salt$hash`: the cost travels with the hash, so it can be raised later. */
export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(SALT_BYTES)
	const key = await derive(password, salt, COST)
	return [
		'scrypt',
		COST.N,
		COST.r,
		COST.p,
		salt.toString('base64url'),
		key.toString('base64url'),
	].join('$')
}

/** Whether `password` matches `stored`; false for anything malformed. Constant-time compare. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const parts = stored.split('$')
	if (parts.length !== 6 || parts[0] !== 'scrypt') return false
	const [N, r, p] = parts.slice(1, 4).map(Number)
	if (![N, r, p].every((value) => Number.isSafeInteger(value) && value > 0)) return false
	const salt = Buffer.from(parts[4] ?? '', 'base64url')
	const expected = Buffer.from(parts[5] ?? '', 'base64url')
	if (salt.byteLength === 0 || expected.byteLength === 0) return false
	const key = await derive(password, salt, { N, r, p })
	return key.byteLength === expected.byteLength && timingSafeEqual(key, expected)
}

/** Whether a stored hash was made with weaker settings than today's and should be redone. */
export function needsRehash(stored: string): boolean {
	const [, N, r, p] = stored.split('$')
	return Number(N) < COST.N || Number(r) !== COST.r || Number(p) !== COST.p
}

/** A hash to verify against when the account does not exist, so timing does not tell. */
let decoy: Promise<string> | undefined
export function decoyHash(): Promise<string> {
	decoy ??= hashPassword(randomBytes(16).toString('base64url'))
	return decoy
}

/** 32 random bytes as base64url (43 characters): reset tokens. */
export function randomToken(): string {
	return randomBytes(32).toString('base64url')
}

export function sha256(value: string): string {
	return createHash('sha256').update(value).digest('base64url')
}
