import { describe, it, expect } from 'vitest'
import { greedyAi } from '../ai/greedyAi'
import { evaluate } from '../ai/evaluate'
import { makeQuiescent } from '../ai/search'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { state, player, card, unit, ready, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * **The AI always takes a win it can reach in one action.**
 *
 * This is a guarantee rather than a tuning outcome, and it rests on one arithmetic fact: `evaluate`
 * returns +/-WIN = 1,000,000 for a decided game, while every other term is a small weight times a
 * board-sized quantity. No reachable material score approaches a million, so a winning move is
 * always the unique maximum and the greedy driver must pick it.
 *
 * Worth pinning explicitly because it is easy to break by accident: capping the evaluation,
 * normalising it, or letting the private hand term escape its `[0, 1)` bound would all quietly turn
 * "certain win" into "quite a good move".
 */

const cards = {
  ...CARDS,
  FINISHER: card({ id: 'FINISHER', type: 'unit', arena: 'ground', cost: 2, power: 8, hp: 5 }),
  HALF: card({ id: 'HALF', type: 'unit', arena: 'ground', cost: 2, power: 4, hp: 4 }),
  JUICY: card({ id: 'JUICY', type: 'unit', arena: 'ground', cost: 6, power: 9, hp: 9 }),
  WALL: card({ id: 'WALL', type: 'unit', arena: 'ground', cost: 2, power: 1, hp: 6, keywords: [{ name: 'Sentinel' }] }),
  TINY_BASE: card({ id: 'TINY_BASE', type: 'base', hp: 8 }),
}

/** `mine` are ready; the enemy base is on 8 HP unless damaged further. */
function position(mine: string[], theirs: string[] = [], baseDamage = 0): GameState {
  return state({
    cards,
    players: {
      player: player({ resources: ready(6), units: mine.map((c, i) => unit(`u${i}`, c)) }),
      opponent: player({
        base: { cardId: 'TINY_BASE', damage: baseDamage },
        units: theirs.map((c, i) => unit(`e${i}`, c)),
      }),
    },
  })
}

const wins = (s: GameState, action: ReturnType<typeof greedyAi>): boolean =>
  action !== null && resolve(s, action).winner === 'player'

describe('the AI takes a one-action win', () => {
  it('swings for the win when a single attack finishes the base', () => {
    const s = position(['FINISHER'])
    expect(wins(s, greedyAi(s))).toBe(true)
  })

  /**
   * The case that matters: a fat enemy unit is the most attractive target by every material term,
   * and the win still has to beat it. WIN dwarfing the board score is what guarantees that.
   */
  it('ignores a juicy trade and takes the win instead', () => {
    const s = position(['FINISHER'], ['JUICY'])
    expect(wins(s, greedyAi(s))).toBe(true)
  })

  it('finishes a chipped base with a small attacker', () => {
    const s = position(['HALF'], [], 5) // 3 HP left, 4 power
    expect(wins(s, greedyAi(s))).toBe(true)
  })

  /** The arithmetic the guarantee rests on, asserted directly rather than inferred. */
  it('scores a won board far above any reachable material score', () => {
    const s = position(['FINISHER'])
    const score = makeQuiescent(evaluate)
    const winning = legalMoves(s).filter(m => resolve(s, m).winner === 'player')
    expect(winning.length).toBeGreaterThan(0)
    for (const m of winning) expect(score(resolve(s, m), 'player')).toBeGreaterThan(1000)
    for (const m of legalMoves(s).filter(m => resolve(s, m).winner === null)) {
      expect(score(resolve(s, m), 'player')).toBeLessThan(1000)
    }
  })
})

/**
 * The limit of the guarantee, pinned so it is not mistaken for a bug later.
 *
 * One ply guarantees a win reachable in ONE action. A lethal needing two attacks is not one action,
 * and in SWU the opponent acts in between, so it is not even guaranteed to still be available. The
 * AI can only start the sequence and hope.
 */
describe('the guarantee stops at one action', () => {
  it('cannot promise a two-attack finish, and only starts the sequence', () => {
    const s = position(['HALF', 'HALF']) // 4 + 4 against 8 HP: lethal in aggregate, not in one action
    const action = greedyAi(s)
    expect(wins(s, action)).toBe(false)
    // It does at least swing at the base rather than dawdle.
    expect(action).toMatchObject({ type: 'attack', target: { kind: 'base' } })
  })

  /**
   * A Sentinel makes even the aggregate unreachable this action: every attacker is locked onto the
   * wall. Clearing it and swinging with the rest is a multi-step line, which is exactly what one ply
   * cannot plan.
   */
  it('cannot clear a Sentinel and swing in the same action', () => {
    const s = position(['FINISHER'], ['WALL'])
    expect(wins(s, greedyAi(s))).toBe(false)
  })
})
