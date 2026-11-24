#!/usr/bin/env node
// Moves Plugins' saved state to a new identity after their class moved to another package.
//
// A Plugin's identity is `package::class`. Its database instance, saved config, Host policy
// entries and Workbench group membership are all keyed by it, so moving a class to another
// package looks like a brand-new Plugin unless that state follows. This script rewrites:
//
// - the database instance registry (`pluxel_system.database_instances.owner_id`): the physical
//   schema keeps its name and its rows, only the owner changes. PGlite data directories are
//   rewritten in place; for native PostgreSQL pass --sql and run the printed statements yourself.
// - the Host config (`fs/services/host/config/config.json`) and policy
//   (`fs/services/host/state/state.json`): every address of an old class becomes the new one.
// - the Workbench plugin groups (`fs/services/host/management/plugin-groups.json`).
//
// It does not touch Vault: encrypted entries stay under the old Plugin's namespace, and a moved
// Plugin that keeps secrets in its own namespace (Pluxum Push's VAPID keys) needs them moved
// through the Vault before it starts under the new identity. Check that before running this.
//
// Stop the host first: PGlite must not be opened by two processes, and a running host would
// write the old identity back. Back up the data root before the real run.
//
// Usage:
//   node scripts/migrate-plugin-identity.mjs --data host/web/.pluxel [--dry-run] [--sql] \
//     @pluxum/accounts::ForumAccountsPlugin=@pluxum/auth::ForumAccountsPlugin ...

import { createRequire } from 'node:module'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const flag = (name) => {
	const index = args.indexOf(name)
	if (index < 0) return false
	args.splice(index, 1)
	return true
}
const option = (name) => {
	const index = args.indexOf(name)
	if (index < 0) return undefined
	const [, value] = args.splice(index, 2)
	return value
}

const dryRun = flag('--dry-run')
const sqlOnly = flag('--sql')
const dataRoot = resolve(option('--data') ?? 'host/web/.pluxel')
const moves = args.map((arg) => {
	const match = /^(@[^/]+\/[^:]+)::(\w+)=(@[^/]+\/[^:]+)::(\w+)$/.exec(arg)
	if (!match) throw new Error(`expected @scope/old::Class=@scope/new::Class, got ${arg}`)
	const [, fromPackage, fromClass, toPackage, toClass] = match
	return {
		from: { packageName: fromPackage, exportName: fromClass },
		to: { packageName: toPackage, exportName: toClass },
		fromRef: `package:${fromPackage}::${fromClass}`,
		toRef: `package:${toPackage}::${toClass}`,
	}
})
if (moves.length === 0) throw new Error('nothing to move')

const log = (...parts) => console.log(dryRun ? '[dry run]' : '', ...parts)
const quote = (value) => `'${value.replaceAll("'", "''")}'`

// --- Database ---------------------------------------------------------------------------------

const statements = moves.flatMap(({ fromRef, toRef }) => [
	`UPDATE pluxel_system.database_instances SET owner_id = ${quote(toRef)} WHERE owner_id = ${quote(fromRef)};`,
])

if (sqlOnly) {
	console.log('BEGIN;')
	for (const statement of statements) console.log(statement)
	console.log('COMMIT;')
} else {
	const databaseDir = join(dataRoot, 'database')
	if (!existsSync(join(databaseDir, 'PG_VERSION'))) {
		throw new Error(`no PGlite data directory at ${databaseDir}; use --sql for native PostgreSQL`)
	}
	const { PGlite } = createRequire(join(root, 'host/package.json'))('@electric-sql/pglite')
	const db = await PGlite.create({ dataDir: databaseDir })
	try {
		await db.transaction(async (tx) => {
			// One transaction, one Plugin after another: each check must see the previous update.
			/* oxlint-disable no-await-in-loop */
			for (const { fromRef, toRef } of moves) {
				const taken = await tx.query(
					`SELECT physical_schema FROM pluxel_system.database_instances WHERE owner_id = $1 AND state = 'active'`,
					[toRef],
				)
				const rows = await tx.query(
					`SELECT physical_schema, state FROM pluxel_system.database_instances WHERE owner_id = $1`,
					[fromRef],
				)
				if (taken.rows.length > 0 && rows.rows.length === 0) {
					log(`database: already moved to ${toRef} (${taken.rows[0].physical_schema})`)
					continue
				}
				if (taken.rows.length > 0) {
					throw new Error(
						`${toRef} already owns database ${taken.rows[0].physical_schema} while ${fromRef} still has one; did the new code start before this ran?`,
					)
				}
				if (rows.rows.length === 0) {
					log(`database: ${fromRef} has no database`)
					continue
				}
				for (const row of rows.rows) {
					log(`database: ${row.physical_schema} (${row.state}) ${fromRef} → ${toRef}`)
				}
				if (!dryRun) {
					await tx.query(
						`UPDATE pluxel_system.database_instances SET owner_id = $2 WHERE owner_id = $1`,
						[fromRef, toRef],
					)
				}
			}
			/* oxlint-enable no-await-in-loop */
		})
	} finally {
		await db.close()
	}
}

// --- Host files -------------------------------------------------------------------------------

/** Replaces every `{ entry: { kind: 'package-root', packageName }, exportName }` of a moved class. */
function rewriteAddresses(value, hits) {
	if (Array.isArray(value)) return value.map((item) => rewriteAddresses(item, hits))
	if (value === null || typeof value !== 'object') return value
	const entry = value.entry
	if (
		entry &&
		typeof entry === 'object' &&
		entry.kind === 'package-root' &&
		typeof value.exportName === 'string'
	) {
		const move = moves.find(
			({ from }) => from.packageName === entry.packageName && from.exportName === value.exportName,
		)
		if (move) {
			hits.push(`${move.fromRef} → ${move.toRef}`)
			return {
				...value,
				entry: { ...entry, packageName: move.to.packageName },
				exportName: move.to.exportName,
			}
		}
	}
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => [key, rewriteAddresses(item, hits)]),
	)
}

function rewriteJsonFile(path, label, check) {
	if (!existsSync(path)) return log(`${label}: none`)
	const before = JSON.parse(readFileSync(path, 'utf8'))
	check?.(before)
	const hits = []
	const after = rewriteAddresses(before, hits)
	if (hits.length === 0) return log(`${label}: nothing to move`)
	for (const hit of hits) log(`${label}: ${hit}`)
	if (!dryRun) writeFileSync(path, `${JSON.stringify(after, null, 2)}\n`)
}

const hostDir = join(dataRoot, 'fs/services/host')

/** A config record for both identities would leave the new one's settings ambiguous. */
function refuseDuplicateConfig(file) {
	const owners = new Set(
		(file?.json?.plugins ?? []).map(
			({ owner }) =>
				`package:${owner?.definition?.entry?.packageName}::${owner?.definition?.exportName}`,
		),
	)
	for (const { fromRef, toRef } of moves) {
		if (owners.has(fromRef) && owners.has(toRef)) {
			throw new Error(`config has records for both ${fromRef} and ${toRef}; merge them by hand`)
		}
	}
}

rewriteJsonFile(join(hostDir, 'config/config.json'), 'config', refuseDuplicateConfig)
rewriteJsonFile(join(hostDir, 'state/state.json'), 'policy')

const groupsPath = join(hostDir, 'management/plugin-groups.json')
if (existsSync(groupsPath)) {
	let text = readFileSync(groupsPath, 'utf8')
	let changed = false
	for (const { fromRef, toRef } of moves) {
		if (!text.includes(`"${fromRef}"`)) continue
		text = text.replaceAll(`"${fromRef}"`, `"${toRef}"`)
		changed = true
		log(`groups: ${fromRef} → ${toRef}`)
	}
	if (changed && !dryRun) writeFileSync(groupsPath, text)
	if (!changed) log('groups: nothing to move')
}

console.log(
	dryRun ? 'Dry run: nothing written.' : 'Done. Start the host and check each moved Plugin.',
)
