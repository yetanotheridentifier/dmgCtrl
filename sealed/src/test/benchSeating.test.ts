import { describe, it, expect } from 'vitest'
import { seating, resultForA, movedFirstForA, firstPlayerFor } from '../bench/seating'

/**
 * Seat assignment for a two-AI comparison.
 *
 * Every harness used to pin `aiA` to the `player` seat and alternate only who moved first, so an AI
 * measured against ITSELF read 49.4% to 50.0% rather than 50%. That bias is the same size as the
 * effects the AI series is now chasing: the one weight change to survive the whole tuning sweep was
 * +0.62%.
 *
 * The fix has to balance seat and first-player **independently**, or the two confound: alternating
 * both together would only ever produce two of the four combinations.
 */
describe('seating', () => {
  it('covers all four seat and first-player combinations over any four games', () => {
    const combos = [0, 1, 2, 3].map(g => {
      const s = seating(g)
      return `${s.swapped ? 'B-first-seat' : 'A-first-seat'}/${s.firstPlayer}`
    })
    expect(new Set(combos).size).toBe(4)
  })

  it('gives each AI each seat equally often, and each the first move equally often', () => {
    const n = 400
    const all = Array.from({ length: n }, (_, g) => seating(g))
    expect(all.filter(s => s.swapped).length).toBe(n / 2)
    expect(all.filter(s => s.firstPlayer === 'player').length).toBe(n / 2)
  })

  /**
   * The two axes have to be independent, not merely balanced: if `swapped` implied `firstPlayer`,
   * seat advantage and first-player advantage would be perfectly confounded and neither could be
   * cancelled.
   */
  it('varies seat independently of who moves first', () => {
    const n = 400
    const joint = new Map<string, number>()
    for (let g = 0; g < n; g++) {
      const s = seating(g)
      const key = `${s.swapped}/${s.firstPlayer}`
      joint.set(key, (joint.get(key) ?? 0) + 1)
    }
    expect(joint.size).toBe(4)
    for (const count of joint.values()) expect(count).toBe(n / 4)
  })

  it('is a pure function of the game index', () => {
    expect(seating(11)).toEqual(seating(11))
  })
})

/**
 * Reading a result back from aiA's point of view. `playGame` reports the winner by SEAT and a margin
 * of `baseDamage.opponent - baseDamage.player`, both of which invert when aiA sits in the opponent
 * seat. Getting the margin wrong would be silent: it would still look like a plausible number.
 */
describe('resultForA', () => {
  const game = (winner: 'player' | 'opponent' | 'draw', margin: number) => ({ winner, margin })

  it('reads the winner from aiA\'s seat', () => {
    expect(resultForA(game('player', 5), { swapped: false, firstPlayer: 'player' }).won).toBe(true)
    expect(resultForA(game('opponent', -5), { swapped: false, firstPlayer: 'player' }).won).toBe(false)
    // Swapped: aiA is the `opponent` seat, so an `opponent` win is aiA's win.
    expect(resultForA(game('opponent', -5), { swapped: true, firstPlayer: 'player' }).won).toBe(true)
    expect(resultForA(game('player', 5), { swapped: true, firstPlayer: 'player' }).won).toBe(false)
  })

  it('negates the margin when aiA is in the other seat', () => {
    expect(resultForA(game('player', 7), { swapped: false, firstPlayer: 'player' }).margin).toBe(7)
    expect(resultForA(game('opponent', -7), { swapped: true, firstPlayer: 'player' }).margin).toBe(7)
  })

  it('treats a draw as a draw from either seat', () => {
    for (const swapped of [false, true]) {
      const r = resultForA(game('draw', 0), { swapped, firstPlayer: 'player' })
      expect(r.won).toBe(false)
      expect(r.draw).toBe(true)
    }
  })
})

/**
 * Did aiA move first? Every harness reports who moved first by SEAT, and aiA's seat changes every
 * other game, so the two have to be read together. Stated once here rather than at each of the three
 * call sites, because it is the same question with the same silent failure mode: reading the seat
 * without the swap gives a first-mover split that is exactly inverted on half the games.
 */
describe('movedFirstForA', () => {
  it('is true exactly when the first player holds aiA\'s seat', () => {
    expect(movedFirstForA({ swapped: false, firstPlayer: 'player' })).toBe(true)
    expect(movedFirstForA({ swapped: false, firstPlayer: 'opponent' })).toBe(false)
    // Swapped: aiA is the `opponent` seat, so the `opponent` moving first is aiA moving first.
    expect(movedFirstForA({ swapped: true, firstPlayer: 'opponent' })).toBe(true)
    expect(movedFirstForA({ swapped: true, firstPlayer: 'player' })).toBe(false)
  })

  it('gives each AI the first move equally often over a whole cycle', () => {
    const n = 400
    const first = Array.from({ length: n }, (_, g) => movedFirstForA(seating(g))).filter(Boolean).length
    expect(first).toBe(n / 2)
  })

  /**
   * A partial cycle is deliberately uneven, and in a known direction: over three games aiA moves
   * first once. That asymmetry is what pins a first-mover split the right way round, since a balanced
   * count cannot tell a correct split from an inverted one.
   */
  it('is uneven over a partial cycle, in a known direction', () => {
    expect([0, 1, 2].map(g => movedFirstForA(seating(g)))).toEqual([true, false, false])
  })
})

/**
 * Who moves first in a **single-agent corpus**: one AI driving both seats, every decision
 * instrumented whoever takes it. `--decisions`, `--terms`, `--lethal` and `--cost` all sample that
 * way, and `seating` does not apply to them: there is no aiA to pin to a seat, and a seat asymmetry
 * averages out because both seats' decisions are collected.
 *
 * The first player is a variable there, and the only one. It must be balanced across the **whole**
 * corpus, which is what indexing by the corpus-wide game number buys: alternating within a deck
 * instead balanced nothing at one game per deck, which is the default for three of those four modes.
 */
describe('firstPlayerFor', () => {
  it('alternates every game', () => {
    expect([0, 1, 2, 3].map(firstPlayerFor)).toEqual(['player', 'opponent', 'player', 'opponent'])
  })

  /** The property the modes depend on: over any even sample, neither side opens more often. */
  it('is balanced over any even count', () => {
    for (const n of [2, 8, 44, 200]) {
      const first = Array.from({ length: n }, (_, i) => firstPlayerFor(i))
      expect(first.filter(p => p === 'player'), `n=${n}`).toHaveLength(n / 2)
    }
  })

  it('is a pure function of the index', () => {
    expect(firstPlayerFor(37)).toBe(firstPlayerFor(37))
  })
})
