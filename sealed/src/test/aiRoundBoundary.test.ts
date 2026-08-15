import { describe, it, expect } from 'vitest'
import { makeBeamAi, asSimulation, lastSearchTrace, clearSearchTrace, DEFAULT_BEAM_LIMITS } from '../ai/search'
import { evaluate } from '../ai/evaluate'
import { legalMoves } from '../engine/legalMoves'
import { resolve } from '../engine/resolve'
import { cardValue } from '../ai/cardValue'
import { resolveAi, aiNames } from '../ai/registry'
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * **The search must never read a card the player has not drawn.**
 *
 * A line that reaches the end of the action phase runs `enterRegroup` inside `resolve`, which deals
 * both players their two cards off a fully-ordered deck held in state. The board that comes back is
 * then scored, and `evaluate` prices our hand. So the value of passing currently depends on which two
 * cards happen to be on top of our deck, which is information no player has.
 *
 * This is not one bad guard. Three separate sites in `search.ts` call `resolve` on a board that may end
 * the phase (the root candidate, the modelled reply, the frontier expansion), so the property has to
 * hold of the search as a whole rather than of any one of them.
 *
 * **Permuting the deck is the assertion, not inspecting the code.** Any leak, by any route, present or
 * future, changes what the search computes when the deck order changes and nothing else does. A test
 * that instead checked "the hand did not grow" would pass the moment someone crossed the boundary a
 * different way.
 */

const cards = {
  ...CARDS,
  // Two cards as far apart in value as the pool allows, so a leak moves the score by a lot rather than
  // by a rounding error. Both cost 0, so `hand.canAct` reads 1 whichever is drawn and the difference
  // lands squarely on `hand.hold`.
  BOMB: card({ id: 'BOMB', type: 'unit', arena: 'ground', cost: 0, power: 9, hp: 9, keywords: [{ name: 'Overwhelm' }, { name: 'Sentinel' }] }),
  JUNK: card({ id: 'JUNK', type: 'unit', arena: 'ground', cost: 0, power: 1, hp: 1 }),
}

const BOMBS_FIRST = ['BOMB', 'BOMB', 'JUNK', 'JUNK', 'JUNK']
const JUNK_FIRST = ['JUNK', 'JUNK', 'BOMB', 'BOMB', 'JUNK']

/**
 * Our turn, and our pass ends the phase on its own.
 *
 * The opponent has claimed, so `advanceTurn` sees `initiativeTakenBy` on the side it would hand the
 * turn to, counts the second consecutive pass and enters regroup (CR 1.15.5b). That reaches the
 * boundary in a single `resolve` from the root, which keeps the test about the boundary rather than
 * about whichever reply policy happens to be configured.
 */
const atBoundary = (deck: string[]): GameState => state({
  cards,
  phase: 'action',
  activePlayer: 'player',
  initiative: 'opponent',
  initiativeTakenBy: 'opponent',
  players: {
    player: player({ deck, resources: ready(4), units: [unit('a', 'TST_U1')] }),
    opponent: player({ deck: ['JUNK', 'JUNK', 'JUNK'], resources: ready(4), units: [unit('e', 'TST_U3')] }),
  },
})

/** What the search valued `pass` at. `candidates` is in `legalMoves` order, which is what makes this
 *  addressable at all. */
function passValue(s: GameState): number {
  const index = legalMoves(s).findIndex(m => m.type === 'pass')
  expect(index, 'pass should be a legal move at the boundary').toBeGreaterThanOrEqual(0)
  clearSearchTrace()
  makeBeamAi(evaluate, { ...DEFAULT_BEAM_LIMITS, nodes: 200_000 })(s)
  const trace = lastSearchTrace()
  expect(trace, 'the beam should have recorded a trace').not.toBeNull()
  return trace!.candidates[index]
}

describe('the search at the round boundary', () => {
  /**
   * Without this the invariance below is unfalsifiable: if the two decks were worth the same, or if
   * passing never reached regroup, the test would pass while measuring nothing.
   */
  it('sets up a boundary crossing that a leak could actually be seen through', () => {
    const s = atBoundary(BOMBS_FIRST)
    const crossed = resolve(s, { type: 'pass' })
    expect(crossed.phase, 'passing here should end the action phase').not.toBe('action')
    expect(crossed.players.player.hand.length, 'regroup deals two cards').toBe(2)

    // And the two orderings genuinely differ in what they would put in hand.
    const worth = (id: string): number => cardValue(s, 'player', cards[id as keyof typeof cards])
    expect(worth('BOMB')).toBeGreaterThan(worth('JUNK'))
  })

  /**
   * The property itself. Same board, same seed, same everything the player can see; only the order of
   * cards nobody has looked at differs.
   */
  it('values passing the same however the deck is ordered', () => {
    expect(passValue(atBoundary(BOMBS_FIRST))).toBe(passValue(atBoundary(JUNK_FIRST)))
  })

  /**
   * And the whole decision, not just the one candidate. A search that scored `pass` identically but
   * reached a different move by some other route would still be acting on cards it cannot see.
   */
  it('chooses the same move however the deck is ordered', () => {
    const ai = makeBeamAi(evaluate, { ...DEFAULT_BEAM_LIMITS, nodes: 200_000 })
    expect(ai(atBoundary(BOMBS_FIRST))).toEqual(ai(atBoundary(JUNK_FIRST)))
  })
})

describe('the simulated regroup', () => {
  const crossed = (s: GameState): GameState => resolve(asSimulation(s), { type: 'pass' })

  /**
   * **The point of the whole exercise.** The real regroup leaves the phase at `regroup` awaiting two
   * resourcing choices, and the beam abandons any node not in the action phase. Settling those choices
   * inside the crossing is what turns the boundary from a wall into a step: one `resolve` lands on the
   * opening of the next round, so the frontier keeps expanding with no change to the beam at all.
   */
  it('lands on the opening of the next round in a single step', () => {
    const before = atBoundary(BOMBS_FIRST)
    const after = crossed(before)
    expect(after.phase).toBe('action')
    expect(after.round).toBe(before.round + 1)
    expect(legalMoves(after).length, 'and the search can continue from it').toBeGreaterThan(0)
  })

  /** Two cards leave the deck and one becomes a resource. Neither reaches a hand. */
  it('spends the two cards without reading them', () => {
    const before = atBoundary(BOMBS_FIRST)
    const after = crossed(before)
    for (const id of ['player', 'opponent'] as const) {
      const was = before.players[id]
      const now = after.players[id]
      expect(now.hand, `${id} draws nothing`).toEqual(was.hand)
      expect(now.deck.length, `${id} spends both cards`).toBe(was.deck.length - 2)
      expect(now.resources.length, `${id} banks one of them`).toBe(was.resources.length + 1)
    }
  })

  /**
   * Deck size is public and running out is a real way to lose, so the clock has to keep ticking. A
   * crossing that quietly stopped consuming the deck would make a losing line look survivable.
   */
  it('still charges for an empty deck', () => {
    const short = atBoundary(['JUNK'])
    const after = crossed(short)
    // One card short of the two owed: 3 damage, and the one card there still banks.
    expect(after.players.player.base.damage).toBe(3)
    expect(after.players.player.resources.length).toBe(short.players.player.resources.length + 1)

    const empty = atBoundary([])
    const afterEmpty = crossed(empty)
    expect(afterEmpty.players.player.base.damage).toBe(6)
    expect(afterEmpty.players.player.resources.length, 'nothing to bank').toBe(empty.players.player.resources.length)
  })

  /**
   * The flag is the only thing separating the two, and real play never sets it. Without this the
   * tests above would pass just as well if the simulated regroup had replaced the real one.
   */
  it('leaves the real regroup alone', () => {
    const real = resolve(atBoundary(BOMBS_FIRST), { type: 'pass' })
    expect(real.phase, 'the real game stops to make its resourcing choices').toBe('regroup')
    expect(real.players.player.hand).toEqual(['BOMB', 'BOMB'])
  })

  /** The line the search recorded for `pass`, which is the candidate that reaches the boundary. */
  function passLine(s: GameState, maxCrossings: number) {
    clearSearchTrace()
    makeBeamAi(evaluate, { ...DEFAULT_BEAM_LIMITS, nodes: 200_000, explain: true, maxCrossings })(s)
    return lastSearchTrace()!.lines![legalMoves(s).findIndex(m => m.type === 'pass')]
  }

  /**
   * **The horizon itself, and the one assertion the ticket turns on.**
   *
   * Reaching a next-round board is not the achievement: the engine hands one back either way, and it is
   * scored either way. The achievement is CONTINUING from it, so the line contains our own actions taken
   * on the far side. `path` is what distinguishes the two, and nothing else does.
   */
  it('plays on into the next round when allowed to', () => {
    const s = atBoundary(BOMBS_FIRST)
    const withHorizon = passLine(s, 1)
    expect(withHorizon.board.round).toBe(s.round + 1)
    expect(withHorizon.path.length, 'our own actions taken after the boundary').toBeGreaterThan(1)
    expect(withHorizon.peakDepth).toBeGreaterThan(1)
  })

  /**
   * And the control, without which the test above is just a description of the engine. At the default
   * the boundary is still where the line stops, which is the behaviour every existing measurement was
   * taken against.
   */
  it('stops at the boundary by default, so the horizon is a separate change', () => {
    const s = atBoundary(BOMBS_FIRST)
    const noHorizon = passLine(s, 0)
    expect(noHorizon.board.round, 'the crossed board is still scored').toBe(s.round + 1)
    expect(noHorizon.path, 'but nothing is played from it').toEqual([{ type: 'pass' }])
    expect(noHorizon.peakDepth).toBe(1)
  })

  /**
   * Why the allowance is bounded rather than open. The opponent's modelled pass plus our own claim ends
   * the phase a second time, and each crossing hands us a resource from a player who is doing nothing,
   * so an unbounded line runs as far as its depth allows.
   */
  it('would run further than one round if it were not stopped', () => {
    const s = atBoundary(BOMBS_FIRST)
    expect(passLine(s, 2).board.round).toBe(s.round + 2)
  })
})

/**
 * The A/B arm has to be a different bot from its control, and that is worth asserting rather than
 * assuming. An arm that silently resolved to the shipped model would run for hours and report a clean
 * null result, which is the most expensive way this can fail: it does not look like a bug, it looks
 * like an answer.
 */
describe('the beam-horizon arm', () => {
  const valuesFrom = (name: string, s: GameState): number[] => {
    clearSearchTrace()
    resolveAi(name)(s)
    return lastSearchTrace()!.candidates
  }

  it('is registered', () => {
    expect(aiNames()).toContain('beam-horizon')
  })

  it('searches differently from the control it will be measured against', () => {
    const s = atBoundary(BOMBS_FIRST)
    expect(valuesFrom('beam-horizon', s)).not.toEqual(valuesFrom('beam-reply', s))
  })

  /**
   * And differs only in the horizon. Both arms redact the regroup, so the deck-order invariance that
   * the control now has must hold for the arm too, or the A/B would be measuring the leak fix as well.
   */
  it('is just as blind to the deck as the control', () => {
    expect(valuesFrom('beam-horizon', atBoundary(BOMBS_FIRST)))
      .toEqual(valuesFrom('beam-horizon', atBoundary(JUNK_FIRST)))
  })
})

/**
 * What claiming the initiative costs.
 *
 * Claiming makes us pass for the rest of the round while the opponent keeps playing, and `advanceTurn`
 * bounces the turn back to them after every action. The search modelled that as **one** action followed
 * by them giving up the rest of their turn, so the price of a claim was almost entirely unpriced. This
 * is the half of #516 the crossing alone does not fix.
 */
describe('the opponent tail after we claim', () => {
  /**
   * We hold nothing back and they have three ready attackers and an empty board opposite, so every
   * action they get is 3 more damage on our base. That makes "how many actions did we let them have"
   * directly readable in the score, rather than inferred.
   */
  const beforeClaim = (): GameState => state({
    cards,
    phase: 'action',
    activePlayer: 'player',
    initiative: 'player',
    initiativeTakenBy: null,
    consecutivePasses: 0,
    players: {
      player: player({ deck: ['JUNK', 'JUNK', 'JUNK'], resources: ready(4) }),
      opponent: player({
        deck: ['JUNK', 'JUNK', 'JUNK'],
        resources: ready(4),
        units: [unit('e1', 'TST_U1'), unit('e2', 'TST_U1'), unit('e3', 'TST_U1')],
      }),
    },
  })

  /** What the search thinks claiming is worth, with the opponent allowed `tailActions` afterwards. */
  function claimValue(tailActions: number): number {
    const s = beforeClaim()
    const index = legalMoves(s).findIndex(m => m.type === 'takeInitiative')
    expect(index, 'the fixture must offer a claim').toBeGreaterThanOrEqual(0)
    clearSearchTrace()
    makeBeamAi(evaluate, {
      ...DEFAULT_BEAM_LIMITS, nodes: 200_000, reply: 'pessimistic', maxCrossings: 1, tailActions,
    })(s)
    return lastSearchTrace()!.candidates[index]
  }

  it('charges for the actions we hand over', () => {
    expect(claimValue(3)).toBeLessThan(claimValue(0))
  })

  /** Monotone, because each extra action they get is more damage we take. A tail that saturated after
   *  one action would be the old behaviour wearing a parameter. */
  it('charges more the longer they get to play', () => {
    expect(claimValue(3)).toBeLessThan(claimValue(1))
  })

  /**
   * And it fires only where we have claimed. Everywhere else the opponent holding the turn is the
   * ordinary null move between our own actions, and handing them free actions there would change the
   * whole search rather than the claim.
   */
  it('leaves every other decision alone', () => {
    const s = atBoundary(BOMBS_FIRST)
    const values = (tailActions: number): number[] => {
      clearSearchTrace()
      makeBeamAi(evaluate, {
        ...DEFAULT_BEAM_LIMITS, nodes: 200_000, reply: 'pessimistic', maxCrossings: 1, tailActions,
      })(s)
      return lastSearchTrace()!.candidates
    }
    // On this board the OPPONENT holds the claim, so nothing we do triggers a tail.
    expect(s.initiativeTakenBy).toBe('opponent')
    expect(values(3)).toEqual(values(0))
  })
})

/**
 * The control for the redaction itself.
 *
 * A control that quietly behaved like the arm would run for hours and report "no difference", which is
 * indistinguishable from a real null result and far more expensive. So the property asserted here is
 * the one the control exists to have: **it still reads the deck.**
 */
describe('the beam-reply-unredacted control', () => {
  const valuesFrom = (name: string, s: GameState): number[] => {
    clearSearchTrace()
    resolveAi(name)(s)
    return lastSearchTrace()!.candidates
  }

  it('is registered', () => {
    expect(aiNames()).toContain('beam-reply-unredacted')
  })

  it('still values the boundary by cards nobody has drawn', () => {
    expect(valuesFrom('beam-reply-unredacted', atBoundary(BOMBS_FIRST)))
      .not.toEqual(valuesFrom('beam-reply-unredacted', atBoundary(JUNK_FIRST)))
  })

  /** And the shipped bot, on the same two boards, does not. Both halves or neither. */
  it('is the only one of the two that does', () => {
    expect(valuesFrom('beam-reply', atBoundary(BOMBS_FIRST)))
      .toEqual(valuesFrom('beam-reply', atBoundary(JUNK_FIRST)))
  })
})
