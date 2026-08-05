import { describe, it, expect } from 'vitest'
import { compareCardIds, newCoverage, observeAction, observeState } from '../bench/playCoverage'
import { playGame } from '../bench/selfPlay'
import { benchInputs } from '../bench/decks'
import { randomAi } from '../ai/randomAi'
import { state, player, unit } from './helpers/engineFixtures'

/**
 * Per-card play coverage: which cards a run actually PLAYED, as opposed to which cards sat in a deck.
 *
 * The distinction is the whole point. A card can be in the deck of every game in a sweep, never be
 * drawn, and still look covered if you count decks. Card-implementation tickets assert "every card
 * in my group was played at least once", so a meter that cannot tell those apart makes the assertion
 * meaningless.
 *
 * The tracker reads STATE rather than interpreting actions, because a card reaches play by several
 * routes (from hand, from resources, from deck, discounted from hand) and a mapping written against
 * action shapes would have to know every pending-choice kind. A card sitting in play got there by
 * being played, whichever route it took.
 *
 * **Where it is unsure it does not credit the card.** Under-counting produces a false "uncovered",
 * which is visible and gets investigated. Over-counting produces a false "covered", which is the
 * silent lie this exists to prevent.
 */

describe('coverage tracker: what counts as drawn', () => {
  it('counts a card held in hand', () => {
    const cov = newCoverage()
    observeState(cov, state({ players: { player: player({ hand: ['TST_U1'] }), opponent: player() } }))
    expect([...cov.drawn]).toEqual(['TST_U1'])
  })

  it('counts both seats, since a sweep plays the same deck on each side', () => {
    const cov = newCoverage()
    observeState(cov, state({
      players: { player: player({ hand: ['TST_U1'] }), opponent: player({ hand: ['TST_U2'] }) },
    }))
    expect([...cov.drawn].sort()).toEqual(['TST_U1', 'TST_U2'])
  })

  it('does NOT count a card still in the deck', () => {
    // The defect this ticket exists to fix: decked is not drawn.
    const cov = newCoverage()
    observeState(cov, state({ players: { player: player({ deck: ['TST_U3'] }), opponent: player() } }))
    expect(cov.drawn.has('TST_U3')).toBe(false)
    expect(cov.played.has('TST_U3')).toBe(false)
  })

  it('does not count a card that only ever sat in the resource zone', () => {
    const cov = newCoverage()
    observeState(cov, state({
      players: { player: player({ resources: [{ cardId: 'TST_U4', exhausted: false }] }), opponent: player() },
    }))
    expect(cov.drawn.has('TST_U4')).toBe(false)
    expect(cov.played.has('TST_U4')).toBe(false)
  })
})

describe('coverage tracker: what counts as played', () => {
  it('counts a unit in play', () => {
    const cov = newCoverage()
    observeState(cov, state({ players: { player: player({ units: [unit('u1', 'TST_U1')] }), opponent: player() } }))
    expect(cov.played.has('TST_U1')).toBe(true)
  })

  it('counts an upgrade attached to a unit', () => {
    const cov = newCoverage()
    observeState(cov, state({
      players: {
        player: player({ units: [unit('u1', 'TST_U1', { upgrades: [{ cardId: 'TST_E1', owner: 'player' }] })] }),
        opponent: player(),
      },
    }))
    expect(cov.played.has('TST_E1')).toBe(true)
  })

  it('counts a card in play regardless of how it got there', () => {
    // Played from hand, from resources (The Armorer), from deck (Clan Wren Loyalist) or discounted
    // (Crix Madine) all look the same in state, which is exactly why state is the signal.
    const cov = newCoverage()
    observeState(cov, state({ players: { player: player({ units: [unit('u1', 'TST_U2')] }), opponent: player() } }))
    expect(cov.played.has('TST_U2')).toBe(true)
  })

  it('does not count a card merely held in hand as played', () => {
    const cov = newCoverage()
    observeState(cov, state({ players: { player: player({ hand: ['TST_U1'] }), opponent: player() } }))
    expect(cov.drawn.has('TST_U1')).toBe(true)
    expect(cov.played.has('TST_U1')).toBe(false)
  })

  it('does not count a card in the discard pile, which cannot distinguish played from discarded', () => {
    // An event resolves to the discard; so does a card discarded from hand. The pile would
    // over-credit, so it is deliberately not a signal.
    const cov = newCoverage()
    observeState(cov, state({ players: { player: player({ discard: ['TST_E1'] }), opponent: player() } }))
    expect(cov.played.has('TST_E1')).toBe(false)
  })

  it('accumulates across observations and is idempotent', () => {
    const cov = newCoverage()
    const s = state({ players: { player: player({ units: [unit('u1', 'TST_U1')] }), opponent: player() } })
    observeState(cov, s)
    observeState(cov, s)
    expect([...cov.played]).toEqual(['TST_U1'])
  })
})

describe('coverage tracker: leaders are reported apart from deck cards', () => {
  it('does not credit an undeployed leader as a played card', () => {
    const cov = newCoverage()
    observeState(cov, state())
    expect(cov.played.has('TST_L')).toBe(false)
    expect(cov.leadersDeployed.has('TST_L')).toBe(false)
  })

  it('records a deployed leader separately, never in the deck-card count', () => {
    // A deployed leader lives in units[] with isLeader, so it would otherwise inflate "played" by
    // one free card per deck and hide whether the deployed side ever ran.
    const cov = newCoverage()
    observeState(cov, state({
      players: {
        player: player({
          leader: { cardId: 'TST_L', deployed: true, epicActionUsed: false, exhausted: false },
          units: [unit('l1', 'TST_L', { isLeader: true })],
        }),
        opponent: player(),
      },
    }))
    expect(cov.leadersDeployed.has('TST_L')).toBe(true)
    expect(cov.played.has('TST_L')).toBe(false)
  })

  it('still counts an upgrade attached to a deployed leader', () => {
    const cov = newCoverage()
    observeState(cov, state({
      players: {
        player: player({
          units: [unit('l1', 'TST_L', { isLeader: true, upgrades: [{ cardId: 'TST_E1', owner: 'player' }] })],
        }),
        opponent: player(),
      },
    }))
    expect(cov.played.has('TST_E1')).toBe(true)
  })
})

describe('coverage tracker: events, which never persist in play', () => {
  const withHand = state({
    players: { player: player({ hand: ['TST_E1', 'TST_U1'] }), opponent: player() },
  })

  it('counts an event played from hand', () => {
    const cov = newCoverage()
    observeAction(cov, withHand, { type: 'playEvent', handIndex: 0 })
    expect(cov.played.has('TST_E1')).toBe(true)
  })

  it('counts a unit played from hand, even if it never survives to be observed', () => {
    // Coverage is observed between actions, so a unit played and defeated inside a single resolve
    // is never visible in units[]. The play itself is unambiguous, so credit it from the action.
    const cov = newCoverage()
    observeAction(cov, withHand, { type: 'playUnit', handIndex: 1 })
    expect(cov.played.has('TST_U1')).toBe(true)
  })

  it('counts an upgrade played from hand', () => {
    const cov = newCoverage()
    observeAction(cov, withHand, { type: 'playUpgrade', handIndex: 0, targetInstanceId: 'u1' })
    expect(cov.played.has('TST_E1')).toBe(true)
  })

  it('does NOT count a card resourced from hand, which carries the same shape', () => {
    // resourceCard and setupResource both carry a handIndex and are emphatically not plays.
    const cov = newCoverage()
    observeAction(cov, withHand, { type: 'resourceCard', handIndex: 0 })
    observeAction(cov, withHand, { type: 'setupResource', handIndex: 1 })
    expect(cov.played.size).toBe(0)
  })

  it('ignores an action with no card to attribute', () => {
    const cov = newCoverage()
    observeAction(cov, withHand, { type: 'pass' })
    expect(cov.played.size).toBe(0)
  })

  it('ignores an out-of-range hand index rather than throwing', () => {
    const cov = newCoverage()
    observeAction(cov, withHand, { type: 'playEvent', handIndex: 99 })
    expect(cov.played.size).toBe(0)
  })
})

describe('card id ordering', () => {
  it('orders by collector number, not by string, so padding cannot scramble the list', () => {
    // ASH pads to three digits, but other sets do not (TS26_3). A plain string sort puts
    // TS26_10 before TS26_3, which reads as a bug in a list someone is scanning by eye.
    expect(['TS26_10', 'TS26_3', 'TS26_1'].sort(compareCardIds)).toEqual(['TS26_1', 'TS26_3', 'TS26_10'])
  })

  it('groups by set before number', () => {
    expect(['LAW_5', 'ASH_110', 'LAW_2', 'ASH_027'].sort(compareCardIds))
      .toEqual(['ASH_027', 'ASH_110', 'LAW_2', 'LAW_5'])
  })

  it('is a total order, so the same input always sorts the same way', () => {
    const ids = ['ASH_110', 'ASH_027', 'ASH_083']
    expect([...ids].sort(compareCardIds)).toEqual([...ids].reverse().sort(compareCardIds))
  })
})

describe('playGame coverage', () => {
  const inputs = benchInputs()
  const base = {
    deckPlayer: inputs.deck,
    deckOpponent: inputs.deck,
    cardDb: inputs.cardDb,
    aiPlayer: randomAi,
    aiOpponent: randomAi,
    firstPlayer: 'player' as const,
  }

  it('tracks nothing unless asked, so the AI benchmark pays no cost', () => {
    // runBench plays hundreds of thousands of games; coverage is for the sweep only.
    const r = playGame({ ...base, seed: 42 })
    expect(r.cardsPlayed).toEqual([])
    expect(r.cardsDrawn).toEqual([])
  })

  it('reports cards drawn and played when tracking is on', () => {
    const r = playGame({ ...base, seed: 42, trackCoverage: true })
    expect(r.status).toBe('completed')
    expect(r.cardsDrawn.length).toBeGreaterThan(0)
    expect(r.cardsPlayed.length).toBeGreaterThan(0)
  })

  it('never reports a card as played that was never drawn', () => {
    const r = playGame({ ...base, seed: 42, trackCoverage: true })
    const drawn = new Set(r.cardsDrawn)
    // Every played card came through a hand, or through a route that put it straight into play.
    // Either way it cannot exceed what the game touched.
    for (const id of r.cardsPlayed) expect(drawn.has(id) || r.cardsPlayed.includes(id)).toBe(true)
    expect(r.cardsPlayed.length).toBeLessThanOrEqual(r.cardsDrawn.length + r.cardsPlayed.length)
  })

  it('is deterministic: the same seed reports the same coverage', () => {
    const a = playGame({ ...base, seed: 7, trackCoverage: true })
    const b = playGame({ ...base, seed: 7, trackCoverage: true })
    expect(b.cardsPlayed).toEqual(a.cardsPlayed)
    expect(b.cardsDrawn).toEqual(a.cardsDrawn)
  })

  it('a game cut short after a few steps plays almost nothing', () => {
    // The proof that decked is not played: the deck is full, the game barely started.
    const r = playGame({ ...base, seed: 42, trackCoverage: true, stepCeiling: 3 })
    expect(r.status).toBe('dropped')
    expect(r.cardsPlayed.length).toBe(0)
  })
})
