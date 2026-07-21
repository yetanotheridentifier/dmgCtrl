import { describe, it, expect } from 'vitest'
import { hydrate, replay, replaySteps, loadReport } from './helpers/replayReport'
import type { Report } from './helpers/replayReport'

/**
 * The harness itself. A filed report replays to the board its reporter was looking at, so a ticket
 * becomes a fixture rather than a description. Exercised here against the Treacherous Minefield
 * report (#379), whose pool is all-ASH and so needs no extra card data.
 */
describe('replaying a filed report', () => {
  const report = loadReport('minefieldArenaChoice')

  it('rebuilds the card database the report strips out', () => {
    const state = hydrate(report)
    // Both leaders and bases resolve, so the deck lists were enough to reconstruct the db.
    expect(state.cards[state.players.player.leader.cardId]?.name).toBe('Ahsoka Tano')
    expect(state.cards[state.players.opponent.base.cardId]).toBeDefined()
    expect(Object.keys(state.cards).length).toBeGreaterThan(100)
  })

  it('replays every move and lands on the reported position', () => {
    const final = replay(report)
    // The report was filed with Treacherous Minefield just played and its choice outstanding.
    expect(final.pendingChoices?.map(c => c.kind)).toContain('selectArenaToGrant')
    expect(final.phase).toBe('action')
    expect(final.winner).toBeNull()
  })

  it('exposes every intermediate state, so a divergence can be found by stepping', () => {
    const steps = replaySteps(report)
    expect(steps).toHaveLength(report.moves.length + 1)
    expect(steps[0].phase).toBe('setup')
    // The board fills up as the game runs.
    expect(steps[steps.length - 1].players.player.units.length).toBeGreaterThan(0)
  })

  it('is deterministic — replaying twice gives an identical game', () => {
    expect(replay(report)).toEqual(replay(report))
  })

  /** Reports from mixed-set pools reference cards the ASH-only fixture lacks (#378 is one). */
  it('names the missing cards rather than failing somewhere unrelated', () => {
    const foreign: Report = {
      ...report,
      initialState: {
        ...report.initialState,
        players: {
          ...report.initialState.players,
          player: { ...report.initialState.players.player, hand: ['SEC_019', 'JTL_132'] },
        },
      },
    }
    expect(() => hydrate(foreign)).toThrow(/SEC_019.*JTL_132|JTL_132.*SEC_019/)
    expect(() => hydrate(foreign)).toThrow(/ASH only/)
  })
})
