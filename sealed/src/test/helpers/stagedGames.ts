import { recordForCollection } from '../../data/collection'
import { defaultSettings, saveSettings } from '../../data/settingsStore'
import { STAGING_PREFIX, type StagingStore } from '../../bench/staging'
import { gameKey } from '../../bench/trainingRows'
import { playedRecord } from './playedRecord'

/**
 * Games as the collection Worker stages them: the app's own outbound payload for a played game
 * (`recordForCollection`), serialised the way the Worker writes it, under the key the Worker gives
 * it. Nothing here is written by hand, so the pull is tested against what is really staged.
 *
 * Needs a DOM (`@vitest-environment jsdom`): the payload is only built for a player who opted in,
 * and that answer is read from storage.
 */
export interface StagedGame {
  /** `records/<gameKey>`, as the Worker names it. */
  key: string
  gameKey: string
  /** The staged value: the payload as JSON. */
  text: string
}

export function stagedGame(seed: number): StagedGame {
  saveSettings({ ...defaultSettings(), shareGames: 'yes' })
  const payload = recordForCollection({ ...playedRecord(seed), consentedAtFinish: true })
  if (!payload) throw new Error('stagedGame: the collection gate refused a consented record')
  const text = JSON.stringify(payload)
  const key = gameKey(JSON.parse(text) as typeof payload)
  return { key: STAGING_PREFIX + key, gameKey: key, text }
}

export interface FakeStaging extends StagingStore {
  /** What is staged now, by key. */
  values: Map<string, string>
  /** Every call made, in order, with the keys it named. */
  calls: { op: 'list' | 'get' | 'delete'; keys: string[] }[]
  /** Set to make the next delete fail before it removes anything. */
  failDelete?: Error
  /** Called at the start of a delete, before anything is removed. */
  onDelete?: (keys: string[]) => void
}

/** A staging store in memory that lists `pageSize` keys a page, as KV lists 1,000. */
export function fakeStaging(games: Iterable<{ key: string; text: string }>, pageSize = 1000): FakeStaging {
  const values = new Map<string, string>()
  for (const game of games) values.set(game.key, game.text)
  const fake: FakeStaging = {
    values,
    calls: [],
    list(cursor) {
      const names = [...values.keys()].sort()
      const from = cursor === undefined ? 0 : Number(cursor)
      const keys = names.slice(from, from + pageSize)
      fake.calls.push({ op: 'list', keys })
      return from + pageSize < names.length ? { keys, cursor: String(from + pageSize) } : { keys }
    },
    get(keys) {
      fake.calls.push({ op: 'get', keys: [...keys] })
      const found = new Map<string, string>()
      for (const key of keys) {
        const text = values.get(key)
        if (text !== undefined) found.set(key, text)
      }
      return found
    },
    delete(keys) {
      fake.calls.push({ op: 'delete', keys: [...keys] })
      fake.onDelete?.([...keys])
      if (fake.failDelete) throw fake.failDelete
      for (const key of keys) values.delete(key)
    },
  }
  return fake
}
