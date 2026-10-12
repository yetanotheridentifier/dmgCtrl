// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { recordForCollection } from '../data/collection'
import { defaultSettings, saveSettings } from '../data/settingsStore'
import type { GameRecord } from '../data/gameRecords'
import type { BenchProvenance } from '../data/recordExport'
import { playedRecord } from './helpers/playedRecord'

/**
 * What a bench record says about its run is the bench's own. The payload a player's game is sent
 * as is a list of named fields (`collection.ts`), and the bench's are not on it: a record carrying
 * them is sent without them.
 */

const bench: BenchProvenance = {
  ais: { player: 'beam-reply', opponent: 'greedy' }, seed: 12345, runSeed: 1, game: 0, decks: 'coverage',
}

describe('the bench\'s provenance and the outbound payload', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('is not sent, even on a record that carries it and has consent', () => {
    saveSettings({ ...defaultSettings(), shareGames: 'yes' })
    const record = { ...playedRecord(7), consentedAtFinish: true, bench } as GameRecord

    const payload = JSON.parse(JSON.stringify(recordForCollection(record))) as Record<string, unknown>

    expect(Object.keys(payload).sort()).toEqual([
      'build', 'durationMs', 'humanSeat', 'initialState', 'moves', 'opponentAi', 'opponentBase',
      'opponentLeader', 'playerBase', 'playerLeader', 'undoCount', 'winner',
    ])
    expect(JSON.stringify(payload)).not.toContain('runSeed')
    expect(JSON.stringify(payload)).not.toContain('greedy')
  })
})
