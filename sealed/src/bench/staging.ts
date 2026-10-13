import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Where collected games wait before they are pulled: the collection Worker's staging store.
 *
 * `StagingStore` is all a pull knows of it (`pull.ts`): list the keys, get some values, delete some
 * keys. The one implementation shells out to `wrangler`, which is already signed in and is how the
 * store is read by hand (operations.md), so a pull needs no token of its own and no dependency. A
 * store that moves (to D1, to R2, to the REST API) is another implementation of the same three
 * calls.
 *
 * **Nothing about a request is read here.** A listing can carry an expiry and metadata beside each
 * key name; only the name is taken. The Worker writes neither (`proxy/records.js`), and this is the
 * second lock on the same door: a pull cannot bring in a time or an address even if one appeared.
 */

/** Every staged game's key starts with this. The same prefix as `KEY_PREFIX` in `proxy/records.js`. */
export const STAGING_PREFIX = 'records/'

export interface StagingStore {
  /**
   * One page of key names under the prefix, and the cursor to pass for the next page when there is
   * one. KV lists 1,000 keys a page; a caller reads pages until no cursor comes back.
   */
  list(cursor?: string): { keys: string[]; cursor?: string }
  /** The stored text of each key that has one. A key that is gone is absent from the answer. */
  get(keys: string[]): Map<string, string>
  delete(keys: string[]): void
}

/** The most keys one bulk get takes: the limit of the KV API call behind `wrangler kv bulk get`. */
export const GET_BATCH = 100

/** Runs one command, given as its arguments from `wrangler` on, and returns what it printed. */
export type WranglerRun = (args: string[]) => string

const CONFIG = 'proxy/wrangler.toml'
const BINDING = 'GAME_RECORDS'

/**
 * Wrangler, started in the repository root, where `proxy/wrangler.toml` is. The config is always
 * named: without it wrangler follows the main app's redirect and reads the wrong Worker's bindings
 * (operations.md, "the redirect trap"). The bench runs with `sealed/` as its working directory.
 */
function runWrangler(args: string[]): string {
  const done = spawnSync('npx', args, { cwd: resolve(process.cwd(), '..'), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (done.error) throw new Error(`could not start wrangler: ${done.error.message}`)
  if (done.status !== 0) throw new Error(`wrangler ${args.slice(1, 4).join(' ')} failed: ${(done.stderr || done.stdout).trim()}`)
  return done.stdout
}

/** The JSON a command printed, read past any banner before it. Throws, quoting the output, when there is none. */
function printedJson(stdout: string): unknown {
  const lines = stdout.split('\n')
  const start = lines.findIndex(line => line.startsWith('[') || line.startsWith('{'))
  try {
    if (start === -1) throw new Error('no JSON')
    return JSON.parse(lines.slice(start).join('\n'))
  } catch {
    throw new Error(`wrangler did not answer with JSON: ${stdout.trim().slice(0, 400)}`)
  }
}

/** The key names in what `wrangler kv key list` printed. Names only: see the note at the top. */
export function parseKeyList(stdout: string): string[] {
  const listed = printedJson(stdout)
  if (!Array.isArray(listed)) throw new Error('wrangler kv key list: not a list of keys')
  return listed.map(entry => {
    const name = (entry as { name?: unknown } | null)?.name
    if (typeof name !== 'string') throw new Error('wrangler kv key list: not a list of keys')
    return name
  })
}

/**
 * Each key's stored text from what `wrangler kv bulk get` printed. The remote store answers with
 * the text itself and the local one with `{ value }`; a key with nothing stored is left out.
 */
export function parseBulkGet(stdout: string): Map<string, string> {
  const answer = printedJson(stdout)
  if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) throw new Error('wrangler kv bulk get: not a set of values')
  const values = new Map<string, string>()
  for (const [key, entry] of Object.entries(answer)) {
    const value = typeof entry === 'string' ? entry : (entry as { value?: unknown } | null)?.value
    if (typeof value === 'string') values.set(key, value)
  }
  return values
}

/** Run `body` with a file holding these key names, which is how the bulk commands take them. */
function withKeysFile<T>(keys: string[], body: (file: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'staged-keys-'))
  const file = join(dir, 'keys.json')
  try {
    writeFileSync(file, JSON.stringify(keys))
    return body(file)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * The staging store, through wrangler. `where` says which store: the account's by default, or
 * wrangler's local one (`['--local', '--persist-to', DIR]`), which is how the commands are tried
 * without touching the account.
 *
 * Three commands and no others: `kv key list`, `kv bulk get` and `kv bulk delete`. Nothing here
 * can write a value. A listing comes back whole, because wrangler follows the cursor itself, so
 * this implementation never returns one. Each call is one wrangler process, a second or two, which
 * is why values are fetched a batch at a time and never a key at a time.
 */
export function wranglerStaging(run: WranglerRun = runWrangler, where: string[] = ['--remote']): StagingStore {
  const namespace = ['--binding', BINDING, ...where, '--config', CONFIG]
  return {
    list() {
      return { keys: parseKeyList(run(['wrangler', 'kv', 'key', 'list', '--prefix', STAGING_PREFIX, ...namespace])) }
    },
    get(keys) {
      const values = new Map<string, string>()
      for (let from = 0; from < keys.length; from += GET_BATCH) {
        const found = withKeysFile(keys.slice(from, from + GET_BATCH), file => parseBulkGet(run(['wrangler', 'kv', 'bulk', 'get', file, ...namespace])))
        for (const [key, value] of found) values.set(key, value)
      }
      return values
    },
    delete(keys) {
      if (keys.length === 0) return
      // `--force` because nothing is there to answer the prompt. What is deleted was decided, and
      // shown, before this is called (`pull.ts`).
      withKeysFile(keys, file => run(['wrangler', 'kv', 'bulk', 'delete', file, '--force', ...namespace]))
    },
  }
}
