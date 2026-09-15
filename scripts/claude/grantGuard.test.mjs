// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { evaluate, parseGrant } from './grantGuard.mjs'

/**
 * The guard behind an autonomous run. Claude Code runs it before every Bash command; it blocks the
 * commands that act on the user's behalf (commit, push, MRs, board edits, filing tickets) unless the
 * local grant file is present and unexpired. The expiry is enforced here rather than left to
 * instructions, so a run cannot outlive the permission by forgetting to check the clock.
 */

const NOW = new Date('2026-09-15T20:00:00+01:00')
const grant = (lines) => parseGrant(lines.join('\n'))
const LIVE = grant(['expires: 2026-09-16T00:00:00+01:00', 'merge: yes', 'file_tickets: yes'])
const EXPIRED = grant(['expires: 2026-09-15T12:00:00+01:00', 'merge: yes', 'file_tickets: yes'])

const GUARDED = [
  'git commit -m "feat: thing"',
  'git push -u origin chore/x',
  'gh pr create --title t --body-file b.md',
  'gh pr merge 12 --squash',
  'gh project item-edit --id X --field-id Y',
  'gh project item-add 1 --owner someone --url u',
  'gh issue create --title t --body b',
]

describe('parseGrant', () => {
  it('reads key: value lines and ignores the prose around them', () => {
    const g = parseGrant('# Autonomy grant\n\nexpires: 2026-09-16T00:00:00+01:00\nmerge: yes\nfile_tickets: no\n\nSome text: with a colon.')
    expect(g.expires?.toISOString()).toBe('2026-09-15T23:00:00.000Z')
    expect(g.merge).toBe(true)
    expect(g.fileTickets).toBe(false)
  })

  it('treats an unreadable expiry as no expiry at all', () => {
    expect(parseGrant('expires: tonight').expires).toBeNull()
  })
})

describe('evaluate', () => {
  it('leaves ordinary commands alone, grant or not', () => {
    for (const command of ['git status', 'npm test', 'gh issue view 12', 'gh pr view 3', 'git switch -c chore/x']) {
      expect(evaluate({ command, grant: null, now: NOW }).allow, command).toBe(true)
    }
  })

  it.each(GUARDED)('blocks %s when there is no grant file', command => {
    const result = evaluate({ command, grant: null, now: NOW })
    expect(result.allow).toBe(false)
    expect(result.reason).toMatch(/no autonomy grant/i)
  })

  it.each(GUARDED)('allows %s while the grant is live', command => {
    expect(evaluate({ command, grant: LIVE, now: NOW }).allow).toBe(true)
  })

  it.each(GUARDED)('blocks %s once the grant has expired, saying when', command => {
    const result = evaluate({ command, grant: EXPIRED, now: NOW })
    expect(result.allow).toBe(false)
    expect(result.reason).toMatch(/expired/i)
    expect(result.reason).toContain('2026-09-15')
  })

  it('blocks a guarded command hidden in a compound command', () => {
    expect(evaluate({ command: 'npm test && git push', grant: null, now: NOW }).allow).toBe(false)
  })

  it('blocks everything when the expiry cannot be read', () => {
    expect(evaluate({ command: 'git push', grant: grant(['expires: soon']), now: NOW }).allow).toBe(false)
  })

  it('blocks merging when the grant says merge: no', () => {
    const noMerge = grant(['expires: 2026-09-16T00:00:00+01:00', 'merge: no', 'file_tickets: yes'])
    expect(evaluate({ command: 'gh pr merge 12', grant: noMerge, now: NOW }).allow).toBe(false)
    expect(evaluate({ command: 'gh pr create --title t', grant: noMerge, now: NOW }).allow).toBe(true)
  })

  it('blocks filing tickets when the grant says file_tickets: no', () => {
    const noTickets = grant(['expires: 2026-09-16T00:00:00+01:00', 'merge: yes', 'file_tickets: no'])
    expect(evaluate({ command: 'gh issue create --title t', grant: noTickets, now: NOW }).allow).toBe(false)
    expect(evaluate({ command: 'gh issue comment 12 --body b', grant: noTickets, now: NOW }).allow).toBe(true)
  })
})

/** The hook contract itself: tool input as JSON on stdin, exit 2 with the reason on stderr to block. */
describe('as a PreToolUse hook', () => {
  const run = (projectDir, command) => spawnSync('node', [join(import.meta.dirname, 'grantGuard.mjs')], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    encoding: 'utf8',
  })

  const projectWith = (grantText) => {
    const dir = mkdtempSync(join(tmpdir(), 'grant-guard-'))
    if (grantText !== undefined) {
      mkdirSync(join(dir, '.claude'))
      writeFileSync(join(dir, '.claude', 'autonomy.md'), grantText)
    }
    return dir
  }

  it('exits 2 with the reason when the grant file is missing', () => {
    const result = run(projectWith(undefined), 'git push')
    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/no autonomy grant/i)
  })

  it('exits 0 for a guarded command under a live grant', () => {
    expect(run(projectWith('expires: 2999-01-01T00:00:00+00:00\nmerge: yes\nfile_tickets: yes'), 'git push').status).toBe(0)
  })

  it('exits 0 for an ordinary command with no grant file', () => {
    expect(run(projectWith(undefined), 'git status').status).toBe(0)
  })
})
