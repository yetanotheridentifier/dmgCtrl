import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROXY_CONFIG, printedJson, runWrangler, type WranglerRun } from './wrangler'

export type { WranglerRun } from './wrangler'

/**
 * The KV staging store games were sent to before the Worker wrote them to D1 (`collectedStore.ts`).
 * The Worker no longer writes it; what it holds is read to move it into D1 (`--migrate`) and is
 * otherwise left in place.
 *
 * `StagingStore` is all a pull knows of it (`pull.ts`): list the keys, get some values, delete some
 * keys. The one implementation shells out to `wrangler` (`wrangler.ts`).
 *
 * **Nothing about a request is read here.** A listing can carry an expiry and metadata beside each
 * key name; only the name is taken. The Worker wrote neither, and this is the second lock on the
 * same door: a pull cannot bring in a time or an address even if one appeared.
 */

/** Every staged game's key starts with this: the prefix the Worker staged games under. */
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

const CONFIG = PROXY_CONFIG
const BINDING = 'GAME_RECORDS'

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
