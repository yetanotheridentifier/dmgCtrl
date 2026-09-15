import { describe, it, expect } from 'vitest'
import ashSet from './fixtures/ashSet.json'
import type { SwuCard } from '../data/cards'
import type { SavedDeck } from '../data/deckStore'
import { generateRandomDeck, generationOptions } from '../deckgen/randomDeck'
import { DECK_SIZE } from '../deckgen/rules'

/**
 * Choosing the leader and base aspect of a generated deck.
 *
 * It exists so a suspect leader can be watched in a game: the matrix rates a leader, and playing
 * against it shows whether the rating belongs to the leader or to the bot. **A random pick never pairs
 * a leader with a base sharing one of its aspects**, since no card in this set carries a doubled aspect
 * and the overlap buys nothing. Choosing both deliberately is the one way to get that pairing.
 */
const POOL = ashSet as unknown as SwuCard[]
const byId = new Map(POOL.map(c => [`${c.Set}_${c.Number}`, c]))
const idOf = (c: SwuCard) => `${c.Set}_${c.Number}`
const CAD_BANE = POOL.find(c => c.Type === 'Leader' && c.Name === 'Cad Bane')!
const SEEDS = Array.from({ length: 10 }, (_, i) => i + 1)

const baseAspect = (deck: SavedDeck) => byId.get(deck.base)?.Aspects?.[0]
const leaderAspects = (deck: SavedDeck) => byId.get(deck.leader)?.Aspects ?? []

describe('generateRandomDeck', () => {
  it('never pairs a random leader with a base of an aspect it already has', () => {
    for (const seed of SEEDS) {
      const { deck } = generateRandomDeck(POOL, seed)!
      expect(leaderAspects(deck), `seed ${seed}`).not.toContain(baseAspect(deck))
    }
  })

  it('builds around a chosen leader, still avoiding its aspects for a random base', () => {
    for (const seed of SEEDS) {
      const { deck } = generateRandomDeck(POOL, seed, { leaderId: idOf(CAD_BANE) })!
      expect(deck.leader).toBe(idOf(CAD_BANE))
      expect(CAD_BANE.Aspects, `seed ${seed}`).not.toContain(baseAspect(deck))
    }
  })

  it('uses a chosen base aspect, with a random leader that does not carry it', () => {
    for (const seed of SEEDS) {
      const { deck } = generateRandomDeck(POOL, seed, { baseAspect: 'Command' })!
      expect(baseAspect(deck)).toBe('Command')
      expect(leaderAspects(deck), `seed ${seed}`).not.toContain('Command')
    }
  })

  it('honours a matching pair when both are chosen deliberately', () => {
    const { deck } = generateRandomDeck(POOL, 1, { leaderId: idOf(CAD_BANE), baseAspect: 'Aggression' })!
    expect(deck.leader).toBe(idOf(CAD_BANE))
    expect(baseAspect(deck)).toBe('Aggression')
  })

  it('builds a whole deck from a full set', () => {
    for (const seed of SEEDS) {
      const { deck } = generateRandomDeck(POOL, seed)!
      expect(deck.cards.reduce((n, c) => n + c.count, 0), `seed ${seed}`).toBe(DECK_SIZE)
    }
  })

  /**
   * A deck of one to three cards is not a deck: the engine deals a short opening hand from it and the
   * setup AI has nothing to resource. A pool that thin (a partial cache, a test fixture) builds nothing,
   * so a caller falls back the way it does with no set cached.
   */
  it('builds nothing from a pool too thin to fill a deck', () => {
    const thin: SwuCard[] = [
      { Set: 'TST', Number: '001', Name: 'Test Leader', Type: 'Leader', Cost: '5', Power: '4', HP: '7' },
      { Set: 'TST', Number: '002', Name: 'Test Base', Type: 'Base', HP: '30' },
      { Set: 'TST', Number: '900', Name: 'Big Test Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '4', HP: '3' },
    ]
    for (const seed of SEEDS) expect(generateRandomDeck(thin, seed), `seed ${seed}`).toBeNull()
  })
})

describe('generationOptions', () => {
  it('lists every leader in card order with its aspects, and every base aspect', () => {
    const { leaders, aspects } = generationOptions(POOL)
    expect(leaders).toHaveLength(18)
    expect(leaders[0].name).toBe('The Armorer')
    expect(leaders.find(l => l.id === idOf(CAD_BANE))?.aspects).toEqual(CAD_BANE.Aspects)
    expect(aspects).toEqual(['Aggression', 'Command', 'Cunning', 'Vigilance'])
  })
})
