#!/usr/bin/env node
/**
 * PreToolUse hook for Bash: blocks the commands that act on the user's behalf (commit, push, opening
 * or merging MRs, board edits, filing tickets) unless the local autonomy grant `.claude/autonomy.md`
 * exists and has not expired. The expiry is enforced here rather than left to instructions, so an
 * autonomous run cannot outlive its permission. See `scripts/claude/README.md`.
 *
 * Deliberately conservative: a guarded phrase anywhere in the command blocks it, so a ticket body that
 * quotes `git push` is blocked too. Rewording the text is cheaper than a guard that can be slipped.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const GUARDS = [
  { pattern: /\bgit\s+commit\b/, action: 'commit' },
  { pattern: /\bgit\s+push\b/, action: 'push' },
  { pattern: /\bgh\s+pr\s+create\b/, action: 'open an MR' },
  { pattern: /\bgh\s+pr\s+merge\b/, action: 'merge an MR', needs: 'merge', field: 'merge' },
  { pattern: /\bgh\s+project\s+item-(?:edit|add)\b/, action: 'edit the project board' },
  { pattern: /\bgh\s+issue\s+create\b/, action: 'file a ticket', needs: 'fileTickets', field: 'file_tickets' },
]

/** The grant's fields. Prose around them is ignored; an unreadable expiry reads as none. */
export function parseGrant(text) {
  const fields = {}
  for (const line of text.split('\n')) {
    const match = /^\s*(expires|merge|file_tickets)\s*:\s*(\S+)\s*$/.exec(line)
    if (match) fields[match[1]] = match[2]
  }
  const expires = fields.expires ? new Date(fields.expires) : null
  return {
    expires: expires && !Number.isNaN(expires.getTime()) ? expires : null,
    merge: fields.merge === 'yes',
    fileTickets: fields.file_tickets === 'yes',
  }
}

/** Whether `command` may run under `grant` (null when there is no grant file) at `now`. */
export function evaluate({ command, grant, now }) {
  for (const guard of GUARDS.filter(g => g.pattern.test(command))) {
    if (!grant) {
      return { allow: false, reason: `No autonomy grant (.claude/autonomy.md), so Claude may not ${guard.action}. That step is the user's.` }
    }
    if (!grant.expires) {
      return { allow: false, reason: `The autonomy grant has no readable expires time, so Claude may not ${guard.action}.` }
    }
    if (now >= grant.expires) {
      return { allow: false, reason: `The autonomy grant expired at ${grant.expires.toISOString()}, so Claude may not ${guard.action}. Record progress and hand off to the user.` }
    }
    if (guard.needs && !grant[guard.needs]) {
      return { allow: false, reason: `The autonomy grant does not allow Claude to ${guard.action} (${guard.field} is not yes).` }
    }
  }
  return { allow: true }
}

function main() {
  let command
  try {
    command = JSON.parse(readFileSync(0, 'utf8'))?.tool_input?.command ?? ''
  } catch {
    // Unreadable hook input: allow rather than break every shell command. The guard fails open only
    // on its own malfunction, never on a missing or expired grant.
    return
  }
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()
  let grant = null
  try {
    grant = parseGrant(readFileSync(join(projectDir, '.claude', 'autonomy.md'), 'utf8'))
  } catch {
    grant = null
  }
  const result = evaluate({ command, grant, now: new Date() })
  if (!result.allow) {
    process.stderr.write(`${result.reason}\n`)
    process.exit(2)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
