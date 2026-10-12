import { describe, it, expect } from 'vitest'
import '../engine/cardDefinitions' // side effect: registers every implemented card ability
import { randomAi } from '../ai/randomAi'
import { buildCoverageDecks } from '../bench/coverageDecks'
import { playGame } from '../bench/selfPlay'
import { poolFor } from '../bench/setPools'
import { engineDeck, sweepCardDb } from '../bench/sweep'
import { withoutCards } from '../data/replayData'
import { replayStates } from '../engine/replay'
import { UNSEEN_CARD } from '../engine/resolve'
import { seatView } from '../engine/seatView'
import type { GameState, PendingChoice, PendingTrigger, PlayerId, PlayerState } from '../engine/types'
import { player, state, unit } from './helpers/engineFixtures'

/**
 * `seatView` is a game state as one seat sees it. The property it exists for is stated as a pair:
 * two states that differ only in something the seat cannot see have the SAME view, and two that
 * differ in something it can see have different ones. The first is what makes a hidden card
 * unrecoverable by any route, since a view that kept it anywhere would differ.
 */

const SEATS: PlayerId[] = ['player', 'opponent']
const otherSeat = (seat: PlayerId): PlayerId => (seat === 'player' ? 'opponent' : 'player')

/** A mid-game position with something in every zone of both seats, and different cards on each side. */
function position(): GameState {
  return state({
    rngSeed: 4242,
    players: {
      player: player({
        hand: ['TST_U1', 'TST_E1', 'TST_U3'],
        deck: ['TST_U2', 'TST_U3', 'TST_U1', 'TST_U4'],
        discard: ['TST_E1', 'TST_U2'],
        resources: [{ cardId: 'TST_U3', exhausted: true }, { cardId: 'TST_U4', exhausted: false }],
        units: [unit('u1', 'TST_U1', { damage: 1 })],
      }),
      opponent: player({
        hand: ['TST_U4', 'TST_U2'],
        deck: ['TST_E1', 'TST_U1', 'TST_U4', 'TST_U2', 'TST_U3'],
        discard: ['TST_U3'],
        resources: [{ cardId: 'TST_U1', exhausted: false }, { cardId: 'TST_E1', exhausted: true }, { cardId: 'TST_U2', exhausted: true }],
        units: [unit('u2', 'TST_U2', { exhausted: true }), unit('u3', 'TST_U4')],
      }),
    },
  })
}

const withPlayer = (s: GameState, id: PlayerId, patch: Partial<PlayerState>): GameState => (
  { ...s, players: { ...s.players, [id]: { ...s.players[id], ...patch } } }
)

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const inner of Object.values(value)) deepFreeze(inner)
  }
  return value
}

const searching = (controller: PlayerId, revealed: string[]): PendingChoice => (
  { kind: 'search', id: 'search-1', controller, unitId: controller === 'player' ? 'u1' : 'u2', revealed }
)

/** An ability of a card still in its owner's hand ("when you draw this card"), owed but not resolved. */
const drawnTrigger = (controller: PlayerId, cardId: string): PendingTrigger => (
  { id: `drawn-${cardId}-0`, controller, point: 'whenDrawn', cardId, abilityIndex: 0, layer: 0, ctx: { drawingPlayer: controller } }
)

describe.each(SEATS)('the state as %s sees it', seat => {
  const other = otherSeat(seat)
  const full = position()
  const view = seatView(full, seat)

  describe('is the same whatever the seat cannot see', () => {
    it('the cards in the other hand', () => {
      const changed = withPlayer(full, other, { hand: full.players[other].hand.map(() => 'TST_U3') })
      expect(changed.players[other].hand).not.toEqual(full.players[other].hand)
      expect(seatView(changed, seat)).toEqual(view)
    })

    it('the order of the other deck', () => {
      const changed = withPlayer(full, other, { deck: [...full.players[other].deck].reverse() })
      expect(changed.players[other].deck).not.toEqual(full.players[other].deck)
      expect(seatView(changed, seat)).toEqual(view)
    })

    it('the cards in the other deck', () => {
      const changed = withPlayer(full, other, { deck: full.players[other].deck.map(() => 'TST_E1') })
      expect(seatView(changed, seat)).toEqual(view)
    })

    it('the order of its own deck', () => {
      const changed = withPlayer(full, seat, { deck: [...full.players[seat].deck].reverse() })
      expect(changed.players[seat].deck).not.toEqual(full.players[seat].deck)
      expect(seatView(changed, seat)).toEqual(view)
    })

    it('the cards face down in the other resource row', () => {
      const changed = withPlayer(full, other, { resources: full.players[other].resources.map(r => ({ ...r, cardId: 'TST_U3' })) })
      expect(changed.players[other].resources).not.toEqual(full.players[other].resources)
      expect(seatView(changed, seat)).toEqual(view)
    })

    /**
     * The seed advances on every move and seeds the mulligan shuffle, so it is a function of the
     * shuffles so far and, with a known deck list, a way back to a deck's order.
     */
    it('the shuffle seed', () => {
      expect(seatView({ ...full, rngSeed: full.rngSeed + 1 }, seat)).toEqual(view)
    })

    /** What a choice shows its chooser is the chooser's alone: a search holds cards off their deck. */
    it('what a choice the other seat is answering holds, and that it is there at all', () => {
      const asked = { ...full, activePlayer: other, pendingChoices: [searching(other, ['TST_E1', 'TST_U1'])] }
      const askedOther = { ...full, activePlayer: other, pendingChoices: [searching(other, ['TST_U4', 'TST_U2', 'TST_U3'])] }
      const notAsked = { ...full, activePlayer: other }
      expect(seatView(asked, seat)).toEqual(seatView(notAsked, seat))
      expect(seatView(askedOther, seat)).toEqual(seatView(notAsked, seat))
    })

    /** An ability owed to the other seat can belong to a card still in their hand, and names it. */
    it('an ability the other seat is owed, waiting or held behind an attack', () => {
      const owed = { ...full, pendingTriggers: [drawnTrigger(other, 'TST_U4')] }
      const held = { ...full, heldTriggers: [{ attackerId: 'u1', triggers: [drawnTrigger(other, 'TST_U4')] }] }
      const heldNone = { ...full, heldTriggers: [{ attackerId: 'u1', triggers: [] }] }
      expect(seatView(owed, seat)).toEqual(view)
      expect(seatView(held, seat)).toEqual(seatView(heldNone, seat))
    })

    it('every one of those at once', () => {
      const changed: GameState = {
        ...withPlayer(withPlayer(full, other, {
          hand: full.players[other].hand.map(() => 'TST_E1'),
          deck: full.players[other].deck.map(() => 'TST_U3'),
          resources: full.players[other].resources.map(r => ({ ...r, cardId: 'TST_U4' })),
        }), seat, { deck: [...full.players[seat].deck].reverse() }),
        rngSeed: 7,
        pendingTriggers: [drawnTrigger(other, 'TST_U2')],
      }
      expect(seatView(changed, seat)).toEqual(view)
    })
  })

  describe('differs with what the seat can see', () => {
    const differs = (changed: GameState) => expect(seatView(changed, seat)).not.toEqual(view)

    it('its own hand, and the order it is held in', () => {
      differs(withPlayer(full, seat, { hand: full.players[seat].hand.map(() => 'TST_U4') }))
      differs(withPlayer(full, seat, { hand: [...full.players[seat].hand].reverse() }))
    })

    it('which cards are left in its own deck', () => {
      differs(withPlayer(full, seat, { deck: full.players[seat].deck.map(() => 'TST_E1') }))
    })

    it('its own face-down resources', () => {
      differs(withPlayer(full, seat, { resources: full.players[seat].resources.map(r => ({ ...r, cardId: 'TST_E1' })) }))
    })

    it('how many cards the other seat holds, has left to draw and has resourced', () => {
      const p = full.players[other]
      differs(withPlayer(full, other, { hand: p.hand.slice(1) }))
      differs(withPlayer(full, other, { deck: p.deck.slice(1) }))
      differs(withPlayer(full, other, { resources: p.resources.slice(1) }))
    })

    it('which of the other resources are exhausted', () => {
      differs(withPlayer(full, other, { resources: full.players[other].resources.map(r => ({ ...r, exhausted: !r.exhausted })) }))
    })

    it('either discard pile', () => {
      differs(withPlayer(full, other, { discard: ['TST_U1'] }))
      differs(withPlayer(full, seat, { discard: ['TST_U1'] }))
    })

    it('the units in play, and the damage on a base', () => {
      const p = full.players[other]
      differs(withPlayer(full, other, { units: p.units.map(u => ({ ...u, damage: u.damage + 1 })) }))
      differs(withPlayer(full, other, { units: p.units.map(u => ({ ...u, cardId: 'TST_U3' })) }))
      differs(withPlayer(full, other, { base: { ...p.base, damage: 5 } }))
    })

    it('a choice it is answering itself, with the cards it is being shown', () => {
      const asked = { ...full, activePlayer: seat, pendingChoices: [searching(seat, ['TST_E1', 'TST_U1'])] }
      const askedOther = { ...full, activePlayer: seat, pendingChoices: [searching(seat, ['TST_U4', 'TST_U1'])] }
      expect(seatView(asked, seat).pendingChoices).toEqual(asked.pendingChoices)
      expect(seatView(askedOther, seat)).not.toEqual(seatView(asked, seat))
    })

    it('an ability it is owed itself', () => {
      const owed = { ...full, pendingTriggers: [drawnTrigger(seat, 'TST_U1'), drawnTrigger(other, 'TST_U4')] }
      expect(seatView(owed, seat).pendingTriggers).toEqual([drawnTrigger(seat, 'TST_U1')])
    })
  })

  it('keeps the sizes of the zones it hides', () => {
    for (const id of SEATS) {
      expect(view.players[id].hand).toHaveLength(full.players[id].hand.length)
      expect(view.players[id].deck).toHaveLength(full.players[id].deck.length)
      expect(view.players[id].resources).toHaveLength(full.players[id].resources.length)
      expect(view.players[id].resources.map(r => r.exhausted)).toEqual(full.players[id].resources.map(r => r.exhausted))
    }
  })

  it('holds the hidden cards as the placeholder the simulated regroup already uses', () => {
    expect(new Set(view.players[other].hand)).toEqual(new Set([UNSEEN_CARD]))
    expect(new Set(view.players[other].deck)).toEqual(new Set([UNSEEN_CARD]))
    expect(new Set(view.players[other].resources.map(r => r.cardId))).toEqual(new Set([UNSEEN_CARD]))
  })

  it('holds its own side as it is, the deck as its cards in a fixed order', () => {
    expect(view.players[seat].hand).toEqual(full.players[seat].hand)
    expect(view.players[seat].resources).toEqual(full.players[seat].resources)
    expect(view.players[seat].deck).toEqual([...full.players[seat].deck].sort())
    expect(view.players[seat].units).toEqual(full.players[seat].units)
  })

  /** CR 1.7.5: a resource an opponent owns is open information, whichever row it is in. */
  it('shows a resource that changed hands, in either row', () => {
    const taken = withPlayer(full, other, { resources: [...full.players[other].resources, { cardId: 'TST_U3', exhausted: false, owner: seat }] })
    const lost = withPlayer(full, seat, { resources: [...full.players[seat].resources, { cardId: 'TST_U2', exhausted: false, owner: other }] })
    expect(seatView(taken, seat).players[other].resources.at(-1)).toEqual({ cardId: 'TST_U3', exhausted: false, owner: seat })
    expect(seatView(lost, seat).players[seat].resources.at(-1)).toEqual({ cardId: 'TST_U2', exhausted: false, owner: other })
  })

  it('leaves out the bookkeeping of a move in progress', () => {
    const mid: GameState = {
      ...full,
      resolvingSource: { cardId: 'TST_E1', controller: other },
      triggerTurn: { side: other, layer: 0 },
      paying: {} as GameState['paying'],
    }
    const seen = seatView(mid, seat)
    expect(seen).toEqual(view)
    expect('resolvingSource' in seen || 'triggerTurn' in seen || 'paying' in seen).toBe(false)
  })

  it('does not change the state it is given, and shares its card database', () => {
    const frozen = deepFreeze(position())
    const before = JSON.stringify(frozen)
    const seen = seatView(frozen, seat)
    expect(JSON.stringify(frozen)).toBe(before)
    expect(seen.cards).toBe(frozen.cards)
    expect(seen).not.toBe(frozen)
  })

  it('is its own view: seen again from the same seat, nothing more goes', () => {
    expect(seatView(view, seat)).toEqual(view)
  })
})

it('the two seats see different states, and neither sees the whole one', () => {
  const full = position()
  expect(seatView(full, 'player')).not.toEqual(seatView(full, 'opponent'))
  expect(seatView(full, 'player')).not.toEqual(full)
})

/**
 * The same property on positions the engine actually reaches, where a hidden card can be named by
 * fields no hand-built position thinks of. Two different decks, so that most of what one seat holds
 * is a card the other has never been shown.
 *
 * A card id counts as known to a seat once it has been somewhere that seat can look: its own zones,
 * a discard pile, in play (attached and captured cards included), or a choice it was asked itself.
 * Every other id in the other seat's hand, deck and face-down resources must be nowhere in the view.
 */
describe('over whole played games', () => {
  const pool = poolFor(['ASH'])
  const decks = buildCoverageDecks(pool).decks
  const cardDb = sweepCardDb(pool)

  const idsShownTo = (s: GameState, seat: PlayerId): string[] => {
    const other = otherSeat(seat)
    const mine = s.players[seat]
    const ids = [...mine.hand, ...mine.deck, ...mine.resources.map(r => r.cardId)]
    ids.push(...s.players[other].resources.filter(r => r.owner === seat).map(r => r.cardId))
    for (const id of SEATS) {
      const p = s.players[id]
      ids.push(p.leader.cardId, p.base.cardId, ...p.discard)
      ids.push(...(p.base.upgrades ?? []).map(u => u.cardId), ...(p.base.captured ?? []).map(c => c.cardId))
      for (const u of p.units) {
        ids.push(u.cardId, ...u.upgrades.map(up => up.cardId), ...(u.captured ?? []).map(c => c.cardId))
        if (u.physicalCardId) ids.push(u.physicalCardId)
      }
    }
    const asked = JSON.stringify((s.pendingChoices ?? []).filter(c => c.controller === seat))
    ids.push(...Object.keys(cardDb).filter(id => asked.includes(`"${id}"`)))
    return ids
  }

  const names = (text: string, id: string): boolean => new RegExp(`(?<![A-Za-z0-9_])${id}(?![A-Za-z0-9_])`).test(text)

  it.each([[5, 0, 1], [6, 2, 3]])('seed %i: no card a seat has never been shown is named anywhere in its view', (seed, a, b) => {
    const game = playGame({
      deckPlayer: engineDeck(decks[a]), deckOpponent: engineDeck(decks[b]), cardDb,
      aiPlayer: randomAi, aiOpponent: randomAi, firstPlayer: 'player', seed,
    })
    const states = replayStates(game.initialState!, game.moves)
    expect(states.length).toBeGreaterThan(40)

    let checked = 0
    for (const seat of SEATS) {
      const other = otherSeat(seat)
      const shown = new Set<string>()
      states.forEach((s, i) => {
        for (const id of idsShownTo(s, seat)) shown.add(id)
        const p = s.players[other]
        const hidden = new Set([...p.hand, ...p.deck, ...p.resources.filter(r => r.owner !== seat).map(r => r.cardId)].filter(id => !shown.has(id)))
        const text = JSON.stringify(withoutCards(seatView(s, seat)))
        const leaked = [...hidden].filter(id => names(text, id))
        expect(leaked, `${seat}'s view before move ${i}`).toEqual([])
        // The same walk finds them in the full state, so an empty result is not a walk that cannot see.
        if (hidden.size > 0) expect([...hidden].every(id => names(JSON.stringify(withoutCards(s)), id))).toBe(true)
        checked += hidden.size
      })
    }
    expect(checked).toBeGreaterThan(1000)
  })
})
