import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { d1Store, type CollectedStore } from '../../bench/collectedStore'

/**
 * The D1 store of collected games with wrangler stood in for: the Worker's own migrations, every one
 * in order, applied to a local SQLite database, and `d1 execute` answered from it. So the SQL the
 * bench sends is the SQL that is run, against the table a deploy has.
 */

const MIGRATIONS = resolve(process.cwd(), '../proxy/migrations')

/** The Worker's schema as a deploy applies it: each migration file, in name order. */
export const SCHEMA = readdirSync(MIGRATIONS)
  .filter(name => name.endsWith('.sql'))
  .sort()
  .map(name => readFileSync(join(MIGRATIONS, name), 'utf8'))
  .join('\n')

export interface FakeD1 {
  db: DatabaseSync
  /** Every wrangler command run, as its arguments. */
  calls: string[][]
  store: CollectedStore
}

/** wrangler's `d1 execute`, answered from a local database holding the Worker's table. */
export function fakeD1(): FakeD1 {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA)
  const calls: string[][] = []
  const run = (args: string[]): string => {
    calls.push(args)
    const at = (flag: string): string | undefined => {
      const i = args.indexOf(flag)
      return i === -1 ? undefined : args[i + 1]
    }
    const file = at('--file')
    if (file !== undefined) {
      db.exec(readFileSync(file, 'utf8'))
      return ' ⛅️ wrangler 4.154.0\n🚣 Executed 3 queries\n'
    }
    const results = db.prepare(at('--command')!).all()
    return ` ⛅️ wrangler 4.154.0\n───────────\n${JSON.stringify([{ results, success: true, meta: {} }], null, 2)}\n`
  }
  return { db, calls, store: d1Store(run) }
}
