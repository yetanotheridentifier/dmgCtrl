import { describe, it, expect } from 'vitest'
import { seating, resultForA } from '../bench/seating'

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
