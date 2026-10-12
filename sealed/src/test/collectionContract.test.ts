// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { recordForCollection } from '../data/collection'
import { COLLECTION_URL } from '../data/collectionSend'
import { defaultSettings, saveSettings } from '../data/settingsStore'
import { gameKey } from '../bench/trainingRows'
import { playedRecord } from './helpers/playedRecord'

/**
 * The collection endpoint refuses anything that is not the payload it expects, and the app swallows
 * a refusal quietly, so a payload the Worker stopped accepting would be lost without a sound. The
 * Worker's rules are data (`proxy/recordContract.json`, which the Worker imports), and these read
 * that file and hold a real game's payload to it. The file is read as data: no code crosses the
 * package boundary.
 */
interface Contract {
  path: string
  maxBytes: number
  required: string[]
  optional: string[]
  text: string
  maxTextLength: number
  maxDepth: number
}

const contract = JSON.parse(readFileSync(resolve(process.cwd(), '../proxy/recordContract.json'), 'utf8')) as Contract

/** Every string in a value, keys included, with the depth it was found at. */
function texts(value: unknown, depth = 0, found: { text: string; depth: number }[] = []): { text: string; depth: number }[] {
  if (typeof value === 'string') found.push({ text: value, depth })
  else if (Array.isArray(value)) value.forEach(item => texts(item, depth + 1, found))
  else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      found.push({ text: key, depth: depth + 1 })
      texts(item, depth + 1, found)
    }
  }
  return found
}

describe('the payload against the collection endpoint’s contract', () => {
  beforeEach(() => {
    localStorage.clear()
    saveSettings({ ...defaultSettings(), shareGames: 'yes' })
  })

  const payloads = () => [7, 11, 23].map(seed => recordForCollection({ ...playedRecord(seed), consentedAtFinish: true })!)

  it('is posted to the path the Worker serves', () => {
    expect(new URL(COLLECTION_URL).pathname).toBe(contract.path)
  })

  it('carries every required field and nothing outside the two lists', () => {
    for (const payload of payloads()) {
      const keys = Object.keys(JSON.parse(JSON.stringify(payload)) as object)
      expect(keys).toEqual(expect.arrayContaining(contract.required))
      expect(keys.filter(key => !contract.required.includes(key) && !contract.optional.includes(key))).toEqual([])
    }
  })

  it('fits under the size cap with room to spare', () => {
    for (const payload of payloads()) {
      const bytes = new TextEncoder().encode(JSON.stringify(payload)).length
      expect(bytes).toBeLessThan(contract.maxBytes / 2)
    }
  })

  /** The rule that keeps anything typed by a person out of storage: ids and counters only. */
  it('holds no text the Worker would refuse', () => {
    const pattern = new RegExp(contract.text)
    for (const payload of payloads()) {
      const found = texts(JSON.parse(JSON.stringify(payload)))
      expect(found.filter(({ text }) => !pattern.test(text) || text.length > contract.maxTextLength).map(f => f.text)).toEqual([])
      expect(Math.max(...found.map(f => f.depth))).toBeLessThanOrEqual(contract.maxDepth)
    }
  })

  /**
   * The Worker stages a game under the key the training rows give it, computed its own way from
   * the same definition. The vector is pinned on both sides (`proxy/worker.test.js`).
   */
  it('gives the pinned starting position and moves the pinned game key', () => {
    expect(gameKey({ initialState: { turn: 1 }, moves: [{ by: 'player', action: { type: 'pass' } }] } as never)).toBe('4b65e2ad9cfd3a18')
  })
})
