import { describe, it, expect } from 'vitest'
import { initGame } from '../engine/initGame'
import { buildCardDb } from '../engine/cardDb'
import type { SwuCard } from '../data/cards'
import type { ParsedDeck } from '../utils/parseProtectThePod'

function makeUnit(number: string): SwuCard {
  return {
    Set: 'TST',
    Number: number,
    Name: `Unit ${number}`,
    Type: 'Unit',
    Arenas: ['Ground'],
    Cost: '2',
    Power: '2',
    HP: '2',
  }
}

const LEADER: SwuCard = { Set: 'TST', Number: '001', Name: 'Test Leader', Type: 'Leader', Cost: '5', Power: '4', HP: '7' }
const BASE: SwuCard = { Set: 'TST', Number: '002', Name: 'Test Base', Type: 'Base', HP: '30' }

// 15 distinct units × 2 copies = a legal 30-card deck.
const UNIT_NUMBERS = Array.from({ length: 15 }, (_, i) => String(100 + i))
const CARD_DB = buildCardDb([LEADER, BASE, ...UNIT_NUMBERS.map(makeUnit)])

const DECK: ParsedDeck = {
  name: 'Test Deck',
  leader: 'TST_001',
  base: 'TST_002',
  cards: UNIT_NUMBERS.map(n => ({ id: `TST_${n}`, count: 2 })),
}

const identity = <T,>(arr: T[]) => arr

describe('initGame', () => {
  it('places leader and base for both players', () => {
    const state = initGame(DECK, DECK, CARD_DB, { firstPlayer: 'player', shuffle: identity })
    for (const side of ['player', 'opponent'] as const) {
      expect(state.players[side].leader).toEqual({
        cardId: 'TST_001',
        deployed: false,
        epicActionUsed: false,
        exhausted: false,
      })
      expect(state.players[side].base).toEqual({ cardId: 'TST_002', damage: 0 })
    }
  })

  it('expands deck entries by count and deals 6 (resources are taken after mulligans — #304)', () => {
    const state = initGame(DECK, DECK, CARD_DB, { firstPlayer: 'player', shuffle: identity })
    for (const side of ['player', 'opponent'] as const) {
      const p = state.players[side]
      expect(p.hand).toHaveLength(6)
      expect(p.resources).toHaveLength(0)
      expect(p.deck).toHaveLength(24)
      expect(p.discard).toEqual([])
      expect(p.units).toEqual([])
    }
  })

  it('deals in shuffled order (injectable shuffle)', () => {
    const reverse = <T,>(arr: T[]) => [...arr].reverse()
    const state = initGame(DECK, DECK, CARD_DB, { firstPlayer: 'player', shuffle: reverse })
    expect(state.players.player.hand.slice(0, 2)).toEqual(['TST_114', 'TST_114'])
  })

  it('begins in the setup phase with the initiative holder deciding first', () => {
    const state = initGame(DECK, DECK, CARD_DB, { firstPlayer: 'opponent', shuffle: identity })
    expect(state.phase).toBe('setup')
    expect(state.initiative).toBe('opponent')
    expect(state.activePlayer).toBe('opponent')
    expect(state.initiativeTakenBy).toBeNull()
    expect(state.round).toBe(1)
    expect(state.consecutivePasses).toBe(0)
    expect(state.regroupResourced).toEqual({ player: false, opponent: false })
    expect(state.instanceCounter).toBe(1)
    expect(state.winner).toBeNull()
  })

  it('uses the provided rng seed and defaults to a random one', () => {
    const seeded = initGame(DECK, DECK, CARD_DB, { firstPlayer: 'player', shuffle: identity, rngSeed: 7 })
    expect(seeded.rngSeed).toBe(7)
    const defaulted = initGame(DECK, DECK, CARD_DB, { firstPlayer: 'player', shuffle: identity })
    expect(Number.isInteger(defaulted.rngSeed)).toBe(true)
  })

  it('produces a JSON-serialisable state carrying the card db', () => {
    const state = initGame(DECK, DECK, CARD_DB, { firstPlayer: 'player', shuffle: identity, rngSeed: 1 })
    expect(JSON.parse(JSON.stringify(state))).toEqual(state)
    expect(state.cards['TST_001'].type).toBe('leader')
  })
})
