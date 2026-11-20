// Versioning and publishing of the @pluxum/* packages, run as `vp run tegami <command>`.
// Every published package belongs to one group that shares a version and a release tag.
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

import { tegami } from 'tegami'
import { runCli } from 'tegami/cli'
import { github } from 'tegami/plugins/github'

const root = resolve(import.meta.dirname, '..')
const workspacePackages = await readWorkspacePackages()
const published = workspacePackages.filter(({ manifest }) => manifest.private !== true)

export const paper = tegami({
	ignore: [onlyPublished(published.map(({ manifest }) => manifest.name))],
	groups: {
		pluxum: {
			syncBump: true,
			syncGitTag: true,
		},
	},
	packages: Object.fromEntries(
		published.map(({ manifest }) => [manifest.name, { group: 'pluxum' }]),
	),
	npm: {
		client: 'pnpm',
		updateLockFile: true,
		onBreakPeerDep: 'error',
		// The group moves together, so a dependency bump never needs to bump its dependents too.
		bumpDep: () => false,
		trustedPublish: {
			provider: 'github',
			workflow: 'release.yml',
		},
	},
	plugins: [
		formatDraft(),
		buildBeforePublish(),
		github({
			repo: 'itzdrli/Pluxum',
			versionPr: { base: 'main' },
		}),
	],
})

if (import.meta.main) await runCli(paper)

/**
 * Versioning rewrites manifests with two-space indentation and adds changelogs; put every changed
 * or new file back into the repository's formatting so the version pull request passes CI.
 * @returns {import('tegami').TegamiPlugin}
 */
function formatDraft() {
	return {
		name: 'pluxum-format-draft',
		async applyCliDraft() {
			const git = (/** @type {string[]} */ args) =>
				promisify(execFile)('git', args, { cwd: this.cwd, encoding: 'utf8' })
			const listed = await Promise.all([
				git(['diff', '--name-only', '--diff-filter=ACM', '-z']),
				git(['ls-files', '--others', '--exclude-standard', '-z']),
			])
			const files = [...new Set(listed.flatMap(({ stdout }) => stdout.split('\0')))].filter(Boolean)
			if (files.length === 0) return
			await promisify(execFile)('vp', ['fmt', '--no-error-on-unmatched-pattern', ...files], {
				cwd: this.cwd,
			})
		},
	}
}

/**
 * Each package is built from the release commit right before it is published.
 * @returns {import('tegami').TegamiPlugin}
 */
function buildBeforePublish() {
	return {
		name: 'pluxum-build-before-publish',
		enforce: 'pre',
		async willPublish({ pkg }) {
			await promisify(execFile)('vp', ['run', `${pkg.name}#compile`], { cwd: this.cwd })
		},
	}
}

/**
 * Tegami matches both bare names and qualified workspace IDs; everything else is left out.
 * @param {readonly string[]} names
 */
function onlyPublished(names) {
	const escaped = names.map((name) => name.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')).toSorted()
	return new RegExp(`^(?!(?:npm:)?(?:${escaped.join('|')})$)`)
}

/** @returns {Promise<{ path: string, manifest: { name: string, private?: boolean } }[]>} */
async function readWorkspacePackages() {
	const { stdout } = await promisify(execFile)('pnpm', ['ls', '-r', '--depth', '-1', '--json'], {
		cwd: root,
		maxBuffer: 16 * 1024 * 1024,
	})
	/** @type {{ path: string }[]} */
	const entries = JSON.parse(stdout)
	return Promise.all(
		entries
			.filter(({ path }) => path !== root)
			.map(async ({ path }) => ({
				path,
				manifest: JSON.parse(await readFile(resolve(path, 'package.json'), 'utf8')),
			})),
	)
}
