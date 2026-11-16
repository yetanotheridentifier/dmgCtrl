import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

/**
 * Running `wrangler` against the proxy Worker's bindings, which is how the collected-game commands
 * reach the account (`collectedStore.ts`, `staging.ts`): wrangler is already signed in and is how
 * the stores are read by hand (operations.md), so the bench needs no token of its own and no
 * dependency.
 */

/** Runs one command, given as its arguments from `wrangler` on, and returns what it printed. */
export type WranglerRun = (args: string[]) => string

/**
 * The proxy's config, always named: without it wrangler follows the main app's redirect and reads
 * the wrong Worker's bindings (operations.md, "the redirect trap").
 */
export const PROXY_CONFIG = 'proxy/wrangler.toml'

/** Wrangler, started in the repository root, where `proxy/wrangler.toml` is. The bench runs with `sealed/` as its working directory. */
export function runWrangler(args: string[]): string {
  const done = spawnSync('npx', args, { cwd: resolve(process.cwd(), '..'), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (done.error) throw new Error(`could not start wrangler: ${done.error.message}`)
  if (done.status !== 0) throw new Error(`wrangler ${args.slice(1, 4).join(' ')} failed: ${(done.stderr || done.stdout).trim()}`)
  return done.stdout
}

/** The JSON a command printed, read past any banner before it. Throws, quoting the output, when there is none. */
export function printedJson(stdout: string): unknown {
  const lines = stdout.split('\n')
  const start = lines.findIndex(line => line.startsWith('[') || line.startsWith('{'))
  try {
    if (start === -1) throw new Error('no JSON')
    return JSON.parse(lines.slice(start).join('\n'))
  } catch {
    throw new Error(`wrangler did not answer with JSON: ${stdout.trim().slice(0, 400)}`)
  }
}
