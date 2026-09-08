import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { describeAction } from '../utils/describeAction'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import { loadReport, replayUpTo } from './helpers/replayReport'
import type { GameState } from '../engine/types'

/**
 * Grogu (ASH_155) reads "When you take the initiative: **You may** attack with a unit." The offer was
 * raised as a `mayAttackAnyUnit`, but that kind enumerated attacks and nothing else, so the only way
 * out was to attack: a player who took the initiative purely to end the phase was forced to swing.
 *
 * The kind is shared with abilities that are genuinely mandatory — Thrawn's leader action and the four
 * "Attack with a unit" events, none of which say "may" — so the decline has to be per-card, not per-kind.
 */

const F = {
  ...CARDS,
  ASH_155: card({ id: 'ASH_155', name: 'Grogu', type: 'unit', arena: 'ground', cost: 3, power: 2, hp: 6 }),
  ASH_004: card({ id: 'ASH_004', name: 'Grand Admiral Thrawn', type: 'leader', cost: 8, power: 5, hp: 8 }),
  ASH_162: card({ id: 'ASH_162', name: 'Rash Action', type: 'event', cost: 1 }),
  GRD: card({ id: 'GRD', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 5 }),
}

const choice = (s: GameState) => s.pendingChoices![0]
const skips = (s: GameState) => legalMoves(s).filter(m => m.type === 'skipTrigger')

describe('Grogu (ASH_155) — the initiative attack is optional', () => {
  /** Grogu and a friend both ready, one enemy to swing at, the initiative there for the taking. */
  const board = () => state({
    cards: F,
    initiative: 'opponent',
    activePlayer: 'player',
    players: {
      player: player({ resources: ready(10), units: [unit('grogu', 'ASH_155'), unit('a', 'GRD')] }),
      opponent: player({ units: [unit('e', 'GRD')] }),
    },
  })

  it('offers a decline alongside the attacks', () => {
    const took = resolve(board(), { type: 'takeInitiative' })
    expect(choice(took)).toMatchObject({ kind: 'mayAttackAnyUnit' })
    expect(legalMoves(took).some(m => m.type === 'attack'), 'attacking is still on offer').toBe(true)
    expect(skips(took)).toContainEqual({ type: 'skipTrigger', choiceId: choice(took).id })
  })

  it('declining costs nothing: no attack happens and every unit stays ready', () => {
    const took = resolve(board(), { type: 'takeInitiative' })
    const declined = resolve(took, { type: 'skipTrigger', choiceId: choice(took).id })
    expect(declined.pendingChoices ?? []).toHaveLength(0)
    expect(declined.players.player.units.every(u => !u.exhausted)).toBe(true)
    expect(declined.players.opponent.units[0].damage, 'nothing was attacked').toBe(0)
    expect(declined.players.opponent.base.damage).toBe(0)
  })

  it('labels the decline "Don\'t attack", not a bare "Decline"', () => {
    const took = resolve(board(), { type: 'takeInitiative' })
    expect(describeAction(took, 'player', { type: 'skipTrigger', choiceId: choice(took).id })).toBe("Don't attack")
  })
})

/**
 * The other users of `mayAttackAnyUnit` print "Attack with a unit" with no "may", so once their cost is
 * paid the attack is compulsory. They must keep offering no way out.
 */
describe('the mandatory users of the same choice keep no decline', () => {
  it('Grand Admiral Thrawn (ASH_004) leader action', () => {
    const s = state({
      cards: F,
      players: {
        player: player({
          leader: { cardId: 'ASH_004', deployed: false, epicActionUsed: false, exhausted: false },
          resources: ready(10),
          units: [unit('u1', 'GRD')],
        }),
        opponent: player({ units: [unit('e', 'GRD')] }),
      },
    })
    const raised = resolve(s, { type: 'useLeaderAbility', index: 0 })
    expect(choice(raised)).toMatchObject({ kind: 'mayAttackAnyUnit' })
    expect(skips(raised)).toHaveLength(0)
  })

  it('Rash Action (ASH_162), and the three events that share its shape', () => {
    const s = state({
      cards: F,
      players: {
        player: player({ resources: ready(10), hand: ['ASH_162'], units: [unit('a', 'GRD')] }),
        opponent: player({ units: [unit('e', 'GRD')] }),
      },
    })
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    expect(choice(played)).toMatchObject({ kind: 'mayAttackAnyUnit' })
    expect(skips(played)).toHaveLength(0)
  })
})

/**
 * The board the ticket was filed from. Move 40 is the `takeInitiative` that raised Grogu's offer; the
 * reporter had no way to turn it down and attacked with Desert Sharpshooter at move 41.
 */
describe('#575: the reported game', () => {
  const report = loadReport('grassrootsHeal')

  it('gives the reporter a decline at the moment they were forced to attack', () => {
    const board = replayUpTo(report, 41)
    expect(choice(board)).toMatchObject({ kind: 'mayAttackAnyUnit' })
    expect(skips(board)).toContainEqual({ type: 'skipTrigger', choiceId: choice(board).id })
  })
})
