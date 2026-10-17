import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { runAiMatchups } from '../bench/aiMatchups'
import { runGeneralisation } from '../bench/generalisation'
import { buildMatchupDecks } from '../bench/matchupDecks'
import { benchRecord, recordsPath, type PlayedGame } from '../bench/records'
import { rowsForExport, trainingCardDb } from '../bench/trainingRows'
import { resolveAi } from '../ai/registry'
import { COMMIT_ID, RELEASE } from '../buildIdentity'
import { EXPORT_FORMAT_VERSION, type GameExport } from '../data/recordExport'
import '../engine/cardDefinitions'

/**
 * `--record` is a choice on every game run whose decks are a population (`DeckSource`): the
 * head-to-head, `--generalise` and `--matchups`. Each hands its completed games to the same recorder,
 * and each keeps its own file, because the same games, seed, AIs and decks under another mode are
 * different games.
 */

const CARDS = trainingCardDb()

/** Every record replays to the result it stored, and names the AI that sat each seat. */
function replays(played: PlayedGame[]): void {
  const records = played.map(benchRecord)
  const file: GameExport = { formatVersion: EXPORT_FORMAT_VERSION, build: { release: RELEASE, commitId: COMMIT_ID }, records }
  const result = rowsForExport(file, CARDS)
  expect(result.rejected).toEqual([])
  expect(result.games).toHaveLength(records.length)
}

describe('a generalisation run that records', () => {
  const played: PlayedGame[] = []
  const report = runGeneralisation({ gamesPerDeck: 2, seed: 5, aiA: 'greedy', aiB: 'random', decks: 'mirror', onGame: g => played.push(g) })

  it('hands over every completed game, in order, under its population', () => {
    expect(played).toHaveLength(report.totalGames - report.dropped)
    expect(played.map(g => g.index)).toEqual([...played.map(g => g.index)].sort((a, b) => a - b))
    for (const g of played) {
      expect(g.decks).toBe('mirror')
      expect(g.runSeed).toBe(5)
      expect(g.result.status).toBe('completed')
    }
  })

  it('names the AI each seat played as, swapping with the seats', () => {
    expect(new Set(played.map(g => g.ais.player))).toEqual(new Set(['greedy', 'random']))
    for (const g of played) expect([g.ais.player, g.ais.opponent].sort()).toEqual(['greedy', 'random'])
  })

  it('records games that replay to their stored result', () => replays(played))
})

describe('a matchups run that records', () => {
  const decks = buildMatchupDecks(undefined, 1).slice(0, 2)
  const played: PlayedGame[] = []
  runAiMatchups(decks, resolveAi('greedy'), resolveAi('random'), 'greedy', 'random', { gamesPerCell: 2, seed: 3, onGame: g => played.push(g) })

  it('hands over its games under the matchup population, each deck staying with its AI', () => {
    expect(played.length).toBeGreaterThan(0)
    for (const g of played) {
      expect(g.decks).toBe('matchup')
      const greedySeat = g.ais.player === 'greedy' ? 'player' : 'opponent'
      expect(decks.map(d => d.deck.name)).toContain(g.deck[greedySeat].name)
    }
  })

  it('records games that replay to their stored result', () => replays(played))
})

describe('a records file names its mode', () => {
  const base = { games: 40, seed: 3, aiA: 'beam-reply', aiB: 'greedy', decks: 'coverage' } as const

  it('keeps the head-to-head path it always had', () => {
    expect(recordsPath(base, 'records')).toBe(join('records', COMMIT_ID, 'beam-reply__vs__greedy__g40__s3__dcoverage.json'))
  })

  it('never lands a generalisation or matchups run in the head-to-head file, or in each other', () => {
    const generalise = recordsPath({ ...base, mode: 'generalise' }, 'records')
    const matchups = recordsPath({ ...base, decks: 'matchup', mode: 'matchups' }, 'records')
    expect(generalise).toBe(join('records', COMMIT_ID, 'beam-reply__vs__greedy__g40__s3__dcoverage__generalise.json'))
    expect(matchups).toBe(join('records', COMMIT_ID, 'beam-reply__vs__greedy__g40__s3__dmatchup__matchups.json'))
    expect(recordsPath({ ...base, decks: 'matchup' }, 'records')).not.toBe(matchups)
  })
})
