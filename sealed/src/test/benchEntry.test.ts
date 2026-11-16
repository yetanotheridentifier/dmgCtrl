import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * The bench as `npm run bench` starts it: its real entry point, under tsx, in a child process.
 *
 * Vitest loads modules its own way, so an import cycle that leaves a binding uninitialised under
 * Node's loader can pass every other test and still stop the bench before it does anything. Only
 * running the entry point catches that. `--collected` on an empty local archive is the cheapest
 * command that loads it whole: no network, no wrangler, nothing written but the empty file.
 */

const TSX = resolve(process.cwd(), 'node_modules/.bin/tsx')

describe('bench entry point', () => {
  it('starts and runs a read-only command under Node', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bench-entry-'))
    try {
      const run = spawnSync(TSX, ['src/bench/main.ts', '--collected', '--archive', join(dir, 'archive.sqlite')], {
        encoding: 'utf8',
        timeout: 60_000,
      })
      expect(run.stderr).not.toMatch(/Error/)
      expect(run.status).toBe(0)
      expect(run.stdout).toMatch(/archive/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 90_000)
})
