/**
 * Watches for upstream releases that unblock a ticket. Each entry in .github/upstream-watch.json
 * names a package, one of its peer dependencies, the version we need that peer range to accept,
 * and the ticket waiting on it. A watch clears when the package's latest release accepts the
 * version; the run then raises a ticket saying so, once (matched by title).
 *
 * When every watch has cleared there is nothing left to watch, so the workflow disables itself.
 * To watch something new, add an entry and re-enable it: `gh workflow enable upstream-watch.yml`.
 *
 * Usage: node scripts/upstream-watch.mjs   (needs `gh`, authenticated through GH_TOKEN in CI)
 */

import { readFileSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import semver from 'semver'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const WATCHES_FILE = resolve(__dirname, '../.github/upstream-watch.json')
export const WORKFLOW_FILE = 'upstream-watch.yml'

/** Whether a peer range accepts the version. A missing range accepts nothing. */
export function accepts(range, version) {
  return range !== undefined && semver.satisfies(version, range)
}

/** The peer range `peer` has in the latest release of `pkg`, or undefined if it declares none. */
export async function latestPeerRange(pkg, peer, fetchImpl = fetch) {
  const res = await fetchImpl(`https://registry.npmjs.org/${pkg.replace('/', '%2F')}/latest`)
  if (!res.ok) throw new Error(`npm registry answered ${res.status} for ${pkg}`)
  const release = await res.json()
  return release.peerDependencies?.[peer]
}

/** The title doubles as the record that a ticket was raised, so it must stay stable. */
export function ticketTitle(w) {
  return `chore/upstream-watch: ${w.package} now accepts ${w.peer} ${w.version} (unblocks #${w.blocks})`
}

export function ticketBody(w, range) {
  return [
    `The latest release of \`${w.package}\` now peers \`${w.peer} ${range}\`, which accepts ${w.version}.`,
    '',
    `That was the upstream blocker on #${w.blocks}, which can now go ahead.`,
    '',
    `Raised by the upstream watch (\`.github/workflows/${WORKFLOW_FILE}\`). Remove the entry from \`.github/upstream-watch.json\` once #${w.blocks} is done.`,
  ].join('\n')
}

/**
 * Checks every watch before acting on any, so a registry failure raises nothing and leaves the
 * workflow enabled rather than reading as a cleared blocker.
 */
export async function run({ watches, fetchImpl = fetch, gh, log = () => {} }) {
  const checked = []
  for (const w of watches) {
    const range = await latestPeerRange(w.package, w.peer, fetchImpl)
    const cleared = accepts(range, w.version)
    log(`${w.package} peers ${w.peer} ${range ?? '(none)'}: ${cleared ? 'accepts' : 'does not accept'} ${w.version} (#${w.blocks})`)
    checked.push({ w, range, cleared })
  }

  const existing = new Set((await gh(['issue', 'list', '--state', 'all', '--limit', '1000', '--search', 'chore/upstream-watch in:title', '--json', 'title', '--jq', '.[].title'])).split('\n'))
  const raised = []
  for (const { w, range } of checked.filter(c => c.cleared)) {
    const title = ticketTitle(w)
    if (existing.has(title)) continue
    await gh(['issue', 'create', '--title', title, '--body', ticketBody(w, range), '--label', 'enhancement'])
    log(`raised: ${title}`)
    raised.push(title)
  }

  const disabled = checked.every(c => c.cleared)
  if (disabled) {
    await gh(['workflow', 'disable', WORKFLOW_FILE])
    log('every watch has cleared: workflow disabled')
  }
  return { raised, disabled }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const exec = promisify(execFile)
  const gh = async args => (await exec('gh', args)).stdout.trim()
  const watches = JSON.parse(readFileSync(WATCHES_FILE, 'utf8'))
  await run({ watches, gh, log: console.log })
}
