import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

/**
 * The bench as `npm run bench` starts it: its real entry point, under tsx, in a child process.
 *
 * Vitest loads modules its own way, so an import cycle that leaves a binding uninitialised under
 * Node's loader can pass every other test and still stop the bench before it does anything. Only
 * running the entry point catches that. A command line the bench refuses is the cheapest run that
 * loads it whole and reaches its own code: no network, no wrangler, nothing written. A cycle would
 * stop it at import, with a stack, before it could print its usage.
 */

const TSX = resolve(process.cwd(), 'node_modules/.bin/tsx')

describe('bench entry point', () => {
  it('starts under Node and reaches its own argument checks', () => {
    const run = spawnSync(TSX, ['src/bench/main.ts', '--games', '0'], { encoding: 'utf8', timeout: 60_000 })
    expect(run.stderr).not.toMatch(/Error/)
    expect(run.stderr).toMatch(/^bench: --games must be a positive integer\nusage: /)
    expect(run.status).toBe(2)
  }, 90_000)
})
