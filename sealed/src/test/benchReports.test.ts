import { describe, it, expect, afterAll } from 'vitest'
import { tmpdir } from 'node:os'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { failureFixture, writeFailures } from '../bench/reports'
import { playGame } from '../bench/selfPlay'
import { benchInputs } from '../bench/decks'
import { randomAi } from '../ai/randomAi'
import type { Ai } from '../ai/types'
import { replay } from './helpers/replayReport'

/**
 * A dropped game becomes a replayable fixture. `failureFixture` emits the `{ initialState, moves }`
 * shape the existing replay harness reads (card database stripped, rebuilt from the ASH fixture on
 * load), so a bench hang or throw drops straight into the bug workflow with no conversion.
 */
const inputs = benchInputs()
const base = {
  deckPlayer: inputs.deck,
  deckOpponent: inputs.deck,
  cardDb: inputs.cardDb,
  aiPlayer: randomAi,
  aiOpponent: randomAi,
  firstPlayer: 'player' as const,
}
const tmp = mkdtempSync(join(tmpdir(), 'bench-reports-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('failureFixture', () => {
  it('strips the card database but keeps the starting position and moves', () => {
    const game = playGame({ ...base, seed: 7 })
    const fx = failureFixture(game)
    expect((fx.initialState as { cards?: unknown }).cards).toBeUndefined()
    expect(fx.moves).toHaveLength(game.moves.length)
    expect(fx.initialState.players.player.leader.cardId).toBeTruthy()
  })

  it('replays through the standard harness to the same outcome', () => {
    const game = playGame({ ...base, seed: 11 })
    const end = replay(failureFixture(game))
    expect(end.winner).toBe(game.winner)
  })
})

describe('writeFailures', () => {
  it('writes one JSON file per dropped game and nothing for completed ones', () => {
    const boom: Ai = () => {
      throw new Error('defect')
    }
    const dropped = playGame({ ...base, aiPlayer: boom, aiOpponent: boom, seed: 3 })
    const completed = playGame({ ...base, seed: 4 })
    const written = writeFailures('run-test', [completed, dropped], tmp)
    expect(written).toHaveLength(1)
    expect(existsSync(written[0])).toBe(true)
    const parsed = JSON.parse(readFileSync(written[0], 'utf8'))
    expect(parsed.initialState.players.opponent.base).toBeTruthy()
    expect(Array.isArray(parsed.moves)).toBe(true)
  })
})
