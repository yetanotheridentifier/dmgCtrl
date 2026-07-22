import { describe, it, expect } from 'vitest'
import ashSet from './fixtures/ashSet.json'
import type { SwuCard } from '../data/cards'
import { buildBenchDeck, benchInputs } from '../bench/decks'

/**
 * The bench plays a FIXED sealed deck so results are comparable across tickets, and (for #390) the
 * same deck on both sides, which removes deck strength as a variable. These tests pin that the deck
 * is real, legal-sized and penalty-free, so a game is a clean measurement rather than a bot fighting
 * its own unplayable hand.
 */
const SET = ashSet as unknown as SwuCard[]
const byId = new Map(SET.map(c => [`${c.Set}_${c.Number}`, c]))

describe('bench deck', () => {
  it('is a real ASH leader, base and at least 30 cards', () => {
    const deck = buildBenchDeck(SET)
    expect(byId.get(deck.leader)?.Type).toBe('Leader')
    expect(byId.get(deck.base)?.Type).toBe('Base')
    const total = deck.cards.reduce((n, c) => n + c.count, 0)
    expect(total).toBeGreaterThanOrEqual(30)
    for (const entry of deck.cards) expect(byId.get(entry.id), entry.id).toBeTruthy()
  })

  it('carries no aspect penalty: every card is covered by the leader and base aspects', () => {
    const deck = buildBenchDeck(SET)
    const covered = new Set([
      ...(byId.get(deck.leader)?.Aspects ?? []),
      ...(byId.get(deck.base)?.Aspects ?? []),
    ])
    for (const entry of deck.cards) {
      const card = byId.get(entry.id)!
      for (const aspect of card.Aspects ?? []) {
        expect(covered.has(aspect), `${card.Name}: ${aspect} not covered`).toBe(true)
      }
    }
  })

  it('is deterministic: same set in, same deck out', () => {
    expect(buildBenchDeck(SET)).toEqual(buildBenchDeck(SET))
  })

  it('bundles a card database covering every id the deck names', () => {
    const { deck, cardDb } = benchInputs()
    for (const id of [deck.leader, deck.base, ...deck.cards.map(c => c.id)]) {
      expect(cardDb[id], id).toBeTruthy()
    }
  })
})
