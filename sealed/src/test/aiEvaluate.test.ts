import { describe, it, expect } from 'vitest'
import { evaluate, publicScore } from '../ai/evaluate'
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'

/**
 * The board evaluation the greedy AI maximises (#391). Higher is better for `me`. It is the seam the
 * later tickets grow (#392 trades, #395 role, #396 tokens); these tests pin the invariants it must
 * always hold: winning beats losing, your own board and card advantage help, and damage to the
 * enemy base helps while damage to yours hurts.
 *
 * Zero-sum is now scoped (#393). It holds over the PUBLIC terms, which is everything either player
 * can see. `evaluate` adds terms that read your own hand's contents, and those are private: reading
 * the opponent's hand would be cheating, so they are applied to the scored seat only. The invariant
 * below is asserted on `publicScore` for that reason.
 */
describe('evaluate', () => {
  it('scores a win far above a loss', () => {
    const won = state({ winner: 'player' })
    expect(evaluate(won, 'player')).toBeGreaterThan(0)
    expect(evaluate(won, 'opponent')).toBeLessThan(0)
    // A win dwarfs any material term: a lone unit cannot outweigh it.
    const material = state({ players: { player: player({ units: [unit('u1', 'TST_U1')] }), opponent: player() } })
    expect(evaluate(won, 'player')).toBeGreaterThan(evaluate(material, 'player'))
  })

  it('is zero-sum over the public terms: the two seats see equal and opposite scores', () => {
    const s = state({
      players: {
        player: player({ units: [unit('u1', 'TST_U1')], hand: ['TST_U1'], base: { cardId: 'TST_B', damage: 3 } }),
        opponent: player({ units: [unit('e1', 'TST_U2')], base: { cardId: 'TST_B', damage: 1 } }),
      },
    })
    // Sum rather than negate, so a symmetric position scoring 0 does not trip the +0 vs -0 quirk.
    expect(publicScore(s, 'player') + publicScore(s, 'opponent')).toBe(0)
  })

  /**
   * The private half. Hand CONTENTS are hidden information, so they may only ever be read for the
   * seat being scored. If this fails, the AI is peeking at the opponent's hand.
   */
  it('never reads the opponent’s hand contents', () => {
    const base = state({
      players: {
        player: player({ hand: ['TST_U1'], resources: ready(3) }),
        opponent: player({ hand: ['TST_U1'], resources: ready(3) }),
      },
    })
    const theirsUpgraded = state({
      players: {
        player: player({ hand: ['TST_U1'], resources: ready(3) }),
        // Same COUNT, far better cards: only a peeking evaluation would notice.
        opponent: player({ hand: ['TST_U4'], resources: ready(3) }),
      },
    })
    expect(evaluate(theirsUpgraded, 'player')).toBe(evaluate(base, 'player'))
  })

  /** The hand term itself: a castable hand beats an uncastable one of the same size. */
  it('prefers a hand it can actually cast', () => {
    const cards = { ...CARDS, BIG: card({ id: 'BIG', type: 'unit', cost: 9, power: 9, hp: 9 }) }
    const castable = state({ cards, players: { player: player({ hand: ['TST_U1'], resources: ready(2) }), opponent: player() } })
    const stranded = state({ cards, players: { player: player({ hand: ['BIG'], resources: ready(2) }), opponent: player() } })
    expect(evaluate(castable, 'player')).toBeGreaterThan(evaluate(stranded, 'player'))
  })

  /**
   * The guarantee that makes the private term safe to carry at all (#393): it is a TIE-BREAK, never
   * a vote. `publicScore` is integer-valued because every weight and quantity it multiplies is an
   * integer, and the hand term is squashed into [0, 1), so it cannot outweigh even a one-point
   * public difference. Letting it compete on equal footing measurably cost win rate.
   */
  it('can never override a public preference, only break a public tie', () => {
    const cards = { ...CARDS, BIG: card({ id: 'BIG', type: 'unit', cost: 9, power: 9, hp: 9 }) }
    // Identical hand SIZE, so the public halves differ only by one point of base damage. The hand
    // CONTENTS point the other way: a cheap castable card against a stranded 9-drop.
    const goodHand = state({
      cards,
      players: {
        player: player({ hand: ['TST_U1'], resources: ready(2) }),
        opponent: player({ base: { cardId: 'TST_B', damage: 0 } }),
      },
    })
    const betterBoard = state({
      cards,
      players: {
        player: player({ hand: ['BIG'], resources: ready(2) }),
        opponent: player({ base: { cardId: 'TST_B', damage: 1 } }),
      },
    })
    expect(publicScore(betterBoard, 'player')).toBeGreaterThan(publicScore(goodHand, 'player'))
    expect(evaluate(betterBoard, 'player')).toBeGreaterThan(evaluate(goodHand, 'player'))
  })

  it('is bounded strictly below one point of public score', () => {
    const rich = state({
      players: {
        player: player({ hand: ['TST_U1', 'TST_U2', 'TST_U3', 'TST_U4'], resources: ready(10) }),
        opponent: player(),
      },
    })
    const gap = evaluate(rich, 'player') - publicScore(rich, 'player')
    expect(gap).toBeGreaterThan(0)
    expect(gap).toBeLessThan(1)
  })

  it('values having a board over not having one', () => {
    const withUnit = state({ players: { player: player({ units: [unit('u1', 'TST_U1')] }), opponent: player() } })
    expect(evaluate(withUnit, 'player')).toBeGreaterThan(0)
  })

  it('rewards damage on the enemy base and punishes damage on your own', () => {
    const level = state()
    const hitEnemy = state({ players: { player: player(), opponent: player({ base: { cardId: 'TST_B', damage: 5 } }) } })
    const hitSelf = state({ players: { player: player({ base: { cardId: 'TST_B', damage: 5 } }), opponent: player() } })
    expect(evaluate(hitEnemy, 'player')).toBeGreaterThan(evaluate(level, 'player'))
    expect(evaluate(hitSelf, 'player')).toBeLessThan(evaluate(level, 'player'))
  })

  it('counts card advantage', () => {
    const ahead = state({ players: { player: player({ hand: ['TST_U1', 'TST_U1'] }), opponent: player({ hand: [] }) } })
    expect(evaluate(ahead, 'player')).toBeGreaterThan(0)
  })

  it('counts unit advantage: two small units beat one bigger of equal total stats (#392)', () => {
    const cards = { ...CARDS, ONE: card({ id: 'ONE', type: 'unit', power: 1, hp: 1 }), TWO: card({ id: 'TWO', type: 'unit', power: 2, hp: 2 }) }
    const twoUnits = state({ cards, players: { player: player({ units: [unit('a', 'ONE'), unit('b', 'ONE')] }), opponent: player() } })
    const oneUnit = state({ cards, players: { player: player({ units: [unit('c', 'TWO')] }), opponent: player() } })
    // Same summed power (2) and HP (2), but two bodies are worth more than one.
    expect(evaluate(twoUnits, 'player')).toBeGreaterThan(evaluate(oneUnit, 'player'))
  })

  it('treats losing a unit as far worse than chipping it (breakpoints, #392)', () => {
    const cards = { ...CARDS, MID: card({ id: 'MID', type: 'unit', power: 3, hp: 4 }) }
    const fresh = state({ cards, players: { player: player({ units: [unit('u', 'MID')] }), opponent: player() } })
    const chipped = state({ cards, players: { player: player({ units: [unit('u', 'MID', { damage: 2 })] }), opponent: player() } })
    const gone = state({ cards, players: { player: player({ units: [] }), opponent: player() } })
    const chipCost = evaluate(fresh, 'player') - evaluate(chipped, 'player')
    const removalCost = evaluate(chipped, 'player') - evaluate(gone, 'player')
    // A damaged-but-alive unit keeps its body and power; only defeating it is the real swing, so
    // losing the unit must cost more than chipping it. (Holds for any weights with a unit-count term.)
    expect(removalCost).toBeGreaterThan(chipCost)
  })
})
