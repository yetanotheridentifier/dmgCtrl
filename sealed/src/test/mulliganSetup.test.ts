import { describe, it, expect } from 'vitest'
import { initGame } from '../engine/initGame'
import { legalMoves } from '../engine/legalMoves'
import { resolve } from '../engine/resolve'
import { describeAction } from '../utils/describeAction'
import { buildCardDb } from '../engine/cardDb'
import type { SwuCard } from '../data/cards'
import type { GameState } from '../engine/types'
import type { ParsedDeck } from '../utils/parseProtectThePod'

function makeUnit(number: string): SwuCard {
  return { Set: 'TST', Number: number, Name: `Unit ${number}`, Type: 'Unit', Arenas: ['Ground'], Cost: '2', Power: '2', HP: '2' }
}

const UNIT_NUMBERS = Array.from({ length: 15 }, (_, i) => String(100 + i))
const CARD_DB = buildCardDb([
  { Set: 'TST', Number: '001', Name: 'Test Leader', Type: 'Leader', Cost: '5', Power: '4', HP: '7' },
  { Set: 'TST', Number: '002', Name: 'Test Base', Type: 'Base', HP: '30' },
  ...UNIT_NUMBERS.map(makeUnit),
])

const DECK: ParsedDeck = {
  name: 'Test Deck',
  leader: 'TST_001',
  base: 'TST_002',
  cards: UNIT_NUMBERS.map(n => ({ id: `TST_${n}`, count: 2 })),
}

const identity = <T,>(arr: T[]) => arr

function freshGame(firstPlayer: 'player' | 'opponent' = 'player'): GameState {
  return initGame(DECK, DECK, CARD_DB, { firstPlayer, shuffle: identity, rngSeed: 42 })
}

describe('initGame — setup phase (CR 5.2)', () => {
  it('starts in the setup phase with 6-card hands and no resources', () => {
    const s = freshGame()
    expect(s.phase).toBe('setup')
    for (const side of ['player', 'opponent'] as const) {
      expect(s.players[side].hand).toHaveLength(6)
      expect(s.players[side].resources).toHaveLength(0)
      expect(s.players[side].deck).toHaveLength(24)
    }
  })

  it('the initiative holder decides first', () => {
    expect(freshGame('opponent').activePlayer).toBe('opponent')
  })

  it('carries the rng seed for in-game shuffles', () => {
    expect(freshGame().rngSeed).toBe(42)
  })
})

describe('legalMoves — setup phase', () => {
  it('offers exactly mulligan or keep hand', () => {
    expect(legalMoves(freshGame())).toEqual([{ type: 'mulligan' }, { type: 'keepHand' }])
  })
})

describe('resolve — mulligan decisions (CR 5.2.1e)', () => {
  it('keepHand leaves the hand alone and passes the decision over', () => {
    const s = freshGame()
    const next = resolve(s, { type: 'keepHand' })
    expect(next.players.player.hand).toEqual(s.players.player.hand)
    expect(next.phase).toBe('setup')
    expect(next.activePlayer).toBe('opponent')
  })

  it('mulligan reshuffles the entire hand into the deck and draws a new 6', () => {
    const s = freshGame()
    const before = s.players.player
    const next = resolve(s, { type: 'mulligan' })
    const after = next.players.player

    expect(after.hand).toHaveLength(6)
    expect(after.deck).toHaveLength(24)
    // same 30 cards overall, just redistributed
    expect([...after.hand, ...after.deck].sort()).toEqual([...before.hand, ...before.deck].sort())
    expect(next.activePlayer).toBe('opponent')
  })

  it('is deterministic for a given seed and advances the seed', () => {
    const a = resolve(freshGame(), { type: 'mulligan' })
    const b = resolve(freshGame(), { type: 'mulligan' })
    expect(a.players.player.hand).toEqual(b.players.player.hand)
    expect(a.rngSeed).not.toBe(42)
  })

  it('after both mulligan decisions, the resource stage begins with the initiative holder', () => {
    const s = freshGame()
    const afterFirst = resolve(s, { type: 'keepHand' })
    const inResource = resolve(afterFirst, { type: 'keepHand' })

    expect(inResource.phase).toBe('setup')
    expect(inResource.setupStage).toBe('resource')
    expect(inResource.activePlayer).toBe('player')
  })

  it('offers one resourcing action per hand card', () => {
    const inResource = resolve(resolve(freshGame(), { type: 'keepHand' }), { type: 'keepHand' })
    const moves = legalMoves(inResource)
    expect(moves).toHaveLength(6)
    expect(moves[0]).toEqual({ type: 'setupResource', handIndex: 0 })
    expect(moves[5]).toEqual({ type: 'setupResource', handIndex: 5 })
  })

  it('each player resources two single cards; after both are done round 1 starts', () => {
    const inResource = resolve(resolve(freshGame(), { type: 'keepHand' }), { type: 'keepHand' })
    // identity shuffle: hand = 100,100,101,101,102,102 — resource a 100 then a 102
    const afterFirstPick = resolve(inResource, { type: 'setupResource', handIndex: 0 })

    // still the same player's turn until they have 2 resources
    expect(afterFirstPick.activePlayer).toBe('player')
    expect(afterFirstPick.players.player.resources.map(r => r.cardId)).toEqual(['TST_100'])
    expect(legalMoves(afterFirstPick)).toHaveLength(5)

    const afterPlayer = resolve(afterFirstPick, { type: 'setupResource', handIndex: 3 }) // TST_102 (index shifted)
    expect(afterPlayer.players.player.hand).toEqual(['TST_100', 'TST_101', 'TST_101', 'TST_102'])
    expect(afterPlayer.players.player.resources.map(r => r.cardId)).toEqual(['TST_100', 'TST_102'])
    expect(afterPlayer.players.player.resources.every(r => !r.exhausted)).toBe(true) // ready (CR 5.2.1f)
    expect(afterPlayer.phase).toBe('setup')
    expect(afterPlayer.activePlayer).toBe('opponent')

    const afterOppFirst = resolve(afterPlayer, { type: 'setupResource', handIndex: 4 })
    expect(afterOppFirst.activePlayer).toBe('opponent')
    const started = resolve(afterOppFirst, { type: 'setupResource', handIndex: 4 })
    expect(started.phase).toBe('action')
    expect(started.round).toBe(1)
    expect(started.activePlayer).toBe('player') // initiative holder acts first
    expect(started.players.opponent.hand).toHaveLength(4)
    expect(started.players.opponent.resources).toHaveLength(2)
  })

  it('each player decides at most once — after both, mulligan is no longer offered', () => {
    const inResource = resolve(resolve(freshGame(), { type: 'mulligan' }), { type: 'mulligan' })
    expect(inResource.setupStage).toBe('resource')
    expect(legalMoves(inResource).map(a => a.type)).not.toContain('mulligan')
  })

  it('rejects mulligan during the resource stage and outside setup', () => {
    const inResource = resolve(resolve(freshGame(), { type: 'keepHand' }), { type: 'keepHand' })
    expect(() => resolve(inResource, { type: 'mulligan' })).toThrow(/stage|phase/i)

    const started = [0, 0, 0, 0].reduce(
      s => resolve(s, { type: 'setupResource', handIndex: 0 }),
      inResource,
    )
    expect(() => resolve(started, { type: 'mulligan' })).toThrow(/phase/i)
  })

  it('rejects setupResource during the mulligan stage and with invalid indexes', () => {
    expect(() => resolve(freshGame(), { type: 'setupResource', handIndex: 0 })).toThrow(/stage|phase/i)
    const inResource = resolve(resolve(freshGame(), { type: 'keepHand' }), { type: 'keepHand' })
    expect(() => resolve(inResource, { type: 'setupResource', handIndex: 9 })).toThrow(/index/i)
    expect(() => resolve(inResource, { type: 'setupResource', handIndex: -1 })).toThrow(/index/i)
  })

  it('rejects action-phase actions during setup', () => {
    expect(() => resolve(freshGame(), { type: 'pass' })).toThrow(/phase/i)
  })
})

describe('describeAction — setup labels', () => {
  it('labels the setup decisions', () => {
    const s = freshGame()
    expect(describeAction(s, 'player', { type: 'mulligan' })).toMatch(/mulligan/i)
    expect(describeAction(s, 'player', { type: 'keepHand' })).toMatch(/keep/i)
    expect(describeAction(s, 'player', { type: 'setupResource', handIndex: 2 }))
      .toBe('Resource Unit 101')
  })

  it('redacts resource card names for the opponent (private information)', () => {
    const s = freshGame()
    expect(describeAction(s, 'opponent', { type: 'setupResource', handIndex: 2 }, { redact: true }))
      .toBe('Resource a card (facedown)')
    expect(describeAction(s, 'opponent', { type: 'resourceCard', handIndex: 0 }, { redact: true }))
      .toBe('Resource a card (facedown)')
    // non-private actions are never redacted
    expect(describeAction(s, 'opponent', { type: 'pass' }, { redact: true })).toBe('Pass')
  })
})

describe('randomisation (production defaults — no injected shuffle/seed)', () => {
  function defaultGame() {
    return initGame(DECK, DECK, CARD_DB, { firstPlayer: 'player' })
  }

  it('shuffles the deck before the opening draw', () => {
    // With 30 cards dealt 6, three independent games all sharing one exact
    // hand order has probability ~0 unless shuffling is broken.
    const hands = [defaultGame(), defaultGame(), defaultGame()].map(s => s.players.player.hand.join(','))
    expect(new Set(hands).size).toBeGreaterThan(1)
  })

  it('deals the two players independently shuffled decks', () => {
    const s = defaultGame()
    // identical 30-card lists, but independent shuffles — decks matching
    // exactly would mean the same shuffle was reused
    expect(s.players.player.deck.join(',')).not.toBe(s.players.opponent.deck.join(','))
  })

  it('mulligan reshuffles rather than redealing the same hand', () => {
    // Across three games, at least one mulligan must change the hand order.
    const changed = [defaultGame(), defaultGame(), defaultGame()].some(s => {
      const before = s.players.player.hand.join(',')
      const after = resolve(s, { type: 'mulligan' }).players.player.hand.join(',')
      return after !== before
    })
    expect(changed).toBe(true)
  })
})
