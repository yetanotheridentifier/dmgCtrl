import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { applyUnitDamage, defeatUnit, dealDamageToUnit, sweepStateBasedDefeats } from '../engine/combat'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'

/**
 * A `whenDefeated` fires exactly once, whichever route the unit leaves play by (#376 item 6).
 *
 * The report was Ant Droid: defeating one took a hand from 3 cards to 11, and Ant Droid draws
 * exactly 1. Hand size is public, so the player really did see eight extra cards. It was never
 * reproduced, and it was pinned on "repeated firing" without a route being named, so this pins down
 * every route a unit can be defeated by and counts the draws. `sweepStateBasedDefeats` is the
 * suspect worth naming: it loops up to EIGHT passes, and eight is exactly the number reported.
 */
const D = {
  ...CARDS,
  ASH_116: card({ id: 'ASH_116', name: 'Ant Droid', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 2 }),
  ASH_050: card({ id: 'ASH_050', name: 'Morgan Elsbeth', type: 'unit', arena: 'ground', cost: 5, power: 3, hp: 4 }),
  BRUISER: card({ id: 'BRUISER', name: 'Bruiser', type: 'unit', arena: 'ground', power: 6, hp: 8 }),
}

/**
 * Answer any outstanding trigger-ordering prompt, taking each in queue order.
 *
 * Needed only where a batch leaves one player several abilities at once: the engine holds the batch
 * rather than picking an order for them. Every test using it has a batch whose members do the same
 * thing, so the pick is arbitrary and the assertion is about the total, not the sequence.
 */
function settleOrdering(s: GameState): GameState {
  let next = s
  for (let i = 0; i < 16; i++) {
    const ask = (next.pendingChoices ?? [])
      .find(c => c.kind === 'chooseNextTrigger' || c.kind === 'chooseTriggerOrder')
    if (!ask) return next
    next = resolve(next, { type: 'acceptChoice', choiceId: ask.id, optionIndex: 0 })
  }
  return next
}

/** One Ant Droid, an empty hand, and a deck deep enough that a runaway draw is visible. */
const board = (droid = unit('ant', 'ASH_116', { arena: 'ground' })): GameState => state({
  phase: 'action',
  activePlayer: 'player',
  cards: D,
  players: {
    player: player({ resources: ready(8), deck: Array.from({ length: 20 }, () => 'TST_U1'), units: [droid] }),
    opponent: player({ units: [unit('br', 'BRUISER', { arena: 'ground' })] }),
  },
})

const drawn = (s: GameState) => s.players.player.hand.length

describe('Ant Droid draws exactly one card however it is defeated (#376)', () => {
  it('by combat damage', () => {
    expect(drawn(resolve(board(), { type: 'attack', attackerId: 'ant', target: { kind: 'unit', instanceId: 'br' } }))).toBe(1)
  })

  it('by direct damage', () => {
    expect(drawn(dealDamageToUnit(board(), 'ant', 2))).toBe(1)
  })

  it('by a targeted defeat that bypasses damage', () => {
    expect(drawn(defeatUnit(board(), 'ant'))).toBe(1)
  })

  /**
   * The state-based sweep, which is the one that loops. A unit already at lethal damage is defeated
   * by the sweep rather than by the hit that put it there; every later sweep in the same action
   * must find nothing left to do.
   */
  it('by the state-based sweep, and not once per pass', () => {
    const doomed = sweepStateBasedDefeats(board(unit('ant', 'ASH_116', { arena: 'ground', damage: 2 })))
    expect(drawn(doomed)).toBe(1)
    expect(drawn(sweepStateBasedDefeats(doomed)), 'a second sweep must be a no-op').toBe(1)
  })

  /** Several Ant Droids in one damage batch: one draw each, not one draw per droid per droid. */
  it('once per droid when three die to the same damage event', () => {
    const three = state({
      phase: 'action',
      activePlayer: 'player',
      cards: D,
      players: {
        player: player({
          resources: ready(8),
          deck: Array.from({ length: 20 }, () => 'TST_U1'),
          units: ['a', 'b', 'c'].map(id => unit(id, 'ASH_116', { arena: 'ground' })),
        }),
        opponent: player(),
      },
    })
    const wiped = applyUnitDamage(three, 'player', new Map([['a', 2], ['b', 2], ['c', 2]]))
    expect(wiped.players.player.units).toHaveLength(0)
    // Three abilities on cards one player controls, so the order is theirs to pick (CR 7.6.9) and the
    // batch waits to be told. All three are the same draw, so the order cannot matter here: the count
    // is what #376 is about, and it is unchanged once the prompts are answered.
    expect(drawn(settleOrdering(wiped))).toBe(3)
  })
})
