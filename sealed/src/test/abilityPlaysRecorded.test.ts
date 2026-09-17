import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, PendingChoice } from '../engine/types'
import { cardsPlayedThisPhase } from '../engine/types'

/**
 * A unit played by an ability is played (CR 6.2.0a and the modified "Play a Card" action), so it counts
 * for everything that reads the cards played this phase: Caretaker Matron, General Hux, Tribunal and the
 * "first X you play each phase" discounts. Each way an ability plays a unit is checked here, once each.
 */

const F: Record<string, EngineCard> = {
  ...CARDS,
  FORCE_U: card({ id: 'FORCE_U', arena: 'ground', cost: 2, power: 2, hp: 3, traits: ['FORCE'] }),
  SOR_093: card({ id: 'SOR_093', name: 'Alliance Dispatcher', arena: 'ground', cost: 1, power: 1, hp: 2, traits: ['REBEL'] }),
  LOF_243: card({ id: 'LOF_243', name: 'Caretaker Matron', arena: 'ground', cost: 2, power: 0, hp: 4, traits: ['FRINGE'] }),
}

type Side = Parameters<typeof player>[0]
const board = (mine: Side = {}, choices: PendingChoice[] = []): GameState =>
  state({
    cards: F,
    players: { player: player({ resources: ready(10), deck: ['TST_U1'], ...mine }), opponent: player({ resources: ready(10), deck: [] }) },
    ...(choices.length > 0 ? { pendingChoices: choices } : {}),
  })
const accept = (s: GameState, extra: { deckIndex?: number; optionIndex?: number; handIndex?: number } = {}) =>
  resolve(s, { type: 'acceptChoice', choiceId: s.pendingChoices![0].id, ...extra })
const unitIds = (s: GameState) => s.players.player.units.map(u => u.cardId)

describe('a unit played by an ability counts as played this phase', () => {
  it('Alliance Dispatcher plays a Force unit, so Caretaker Matron can draw', () => {
    const s = board({ units: [unit('disp', 'SOR_093'), unit('mat', 'LOF_243')], hand: ['FORCE_U'] })
    const matronOffered = (x: GameState) =>
      legalMoves(x).some(m => m.type === 'useAbility' && m.instanceId === 'mat' && m.cardId === 'LOF_243')
    expect(matronOffered(s)).toBe(false)
    const used = resolve(s, { type: 'useAbility', instanceId: 'disp', cardId: 'SOR_093', index: 0 })
    expect(used.pendingChoices?.[0].kind).toBe('playUnitFromHand')
    const done = accept(used, { handIndex: 0 })
    expect(unitIds(done)).toContain('FORCE_U')
    expect(cardsPlayedThisPhase(done, 'player')).toEqual(['FORCE_U'])
    expect(matronOffered({ ...done, activePlayer: 'player' })).toBe(true)
  })

  it('a unit played from a search (searchPlayFree)', () => {
    const s = board({}, [{ kind: 'searchPlayFree', id: 'c', controller: 'player', revealed: ['FORCE_U'], eligibleIndices: [0], budget: 5, playOne: true }])
    const done = accept(s, { deckIndex: 0 })
    expect(unitIds(done)).toEqual(['FORCE_U'])
    expect(cardsPlayedThisPhase(done, 'player')).toEqual(['FORCE_U'])
  })

  it('a unit played from the discard (mayPlayUnitFromDiscard)', () => {
    const s = board({ discard: ['FORCE_U'] }, [{ kind: 'mayPlayUnitFromDiscard', id: 'c', controller: 'player', candidates: ['FORCE_U'], remaining: 1 }])
    const done = accept(s, { optionIndex: 0 })
    expect(unitIds(done)).toEqual(['FORCE_U'])
    expect(cardsPlayedThisPhase(done, 'player')).toEqual(['FORCE_U'])
  })

  it('a unit played from the top of the deck (mayPlayTopFree)', () => {
    const s = board({ deck: ['FORCE_U', 'TST_U1'] }, [{ kind: 'mayPlayTopFree', id: 'c', controller: 'player', unitId: 'x', cardId: 'FORCE_U' }])
    const done = accept(s)
    expect(unitIds(done)).toEqual(['FORCE_U'])
    expect(cardsPlayedThisPhase(done, 'player')).toEqual(['FORCE_U'])
  })

  it('a unit played from hand is recorded once, not twice', () => {
    const s = board({ hand: ['FORCE_U'] })
    const done = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(cardsPlayedThisPhase(done, 'player')).toEqual(['FORCE_U'])
  })
})
