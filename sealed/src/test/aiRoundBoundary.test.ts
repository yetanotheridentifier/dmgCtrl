import { describe, it, expect } from 'vitest'
import { makeBeamAi, asSimulation, settleCrossing, lastSearchTrace, clearSearchTrace, DEFAULT_BEAM_LIMITS } from '../ai/search'
import { evaluate, DEFAULT_WEIGHTS } from '../ai/evaluate'
import { legalMoves } from '../engine/legalMoves'
import { resolve } from '../engine/resolve'
import { cardValue } from '../ai/cardValue'
import { resolveAi, aiNames } from '../ai/registry'
import { makeBeamGreedy } from '../ai/greedyAi'
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
const atBoundary = (deck: string[], pool = 4): GameState => state({
  cards,
  phase: 'action',
  activePlayer: 'player',
  initiative: 'opponent',
  initiativeTakenBy: 'opponent',
  players: {
    player: player({ deck, resources: ready(pool), units: [unit('a', 'TST_U1')] }),
    opponent: player({ deck: ['JUNK', 'JUNK', 'JUNK'], resources: ready(pool), units: [unit('e', 'TST_U3')] }),
  },
})

/**
 * A pool past any knee, so the scarcity rule is free to fire.
 *
 * The rule is a conjunction of a small hand AND a saturated pool, and the default fixture's pool of 4
 * is below the knee on purpose: at that pool another resource still buys reach, so a bot that declined
 * there would be the -3.52 failure mode rather than the behaviour under test.
 */
const DEEP_POOL = 12

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

  /**
   * The engine models the MECHANICAL half of the regroup and predicts nothing (#519).
   *
   * It used to bank one of the two drawn cards on each side's behalf and leave the hand untouched.
   * That was faithful while `resource - card` was +2 and banking was the only thing the bot ever did.
   * It is not a rule the engine can state any more: whether a seat banks now depends on evaluation
   * weights, which the engine has no business knowing.
   *
   * So the cards enter the hand **unidentified**. Hand SIZE is public and the draw is deterministic,
   * so modelling the size is honest; the identities stay unreadable, which is the guarantee the whole
   * boundary exercise exists to keep. The resourcing choice is applied afterwards by the search, in
   * `settleCrossing`, from public quantities alone.
   */
  it('draws the two cards face down and banks nothing', () => {
    const before = atBoundary(BOMBS_FIRST)
    const after = crossed(before)
    for (const id of ['player', 'opponent'] as const) {
      const was = before.players[id]
      const now = after.players[id]
      expect(now.hand.length, `${id} draws two`).toBe(was.hand.length + 2)
      expect(now.deck.length, `${id} spends both cards`).toBe(was.deck.length - 2)
      expect(now.resources.length, `${id} banks nothing here`).toBe(was.resources.length)
    }
  })

  /**
   * The drawn cards are placeholders, not cards. Every consumer already guards on an unknown id, so
   * they are unplayable and unpriced rather than special-cased: `legalMoves` skips a hand entry with no
   * definition, and so does `handValue`. That is the correct reading of "you know you drew two cards
   * and not what they are".
   */
  it('leaves the drawn cards unidentified, so nothing can read or play them', () => {
    const after = crossed(atBoundary(BOMBS_FIRST))
    const drawn = after.players.player.hand
    expect(drawn.length, 'not vacuous: there are cards to be unreadable').toBe(2)
    expect(drawn.every(id => after.cards[id] === undefined), 'no definition to read').toBe(true)
    expect(legalMoves(after).some(m => 'handIndex' in m), 'and none of them is playable').toBe(false)
  })

  /**
   * Deck size is public and running out is a real way to lose, so the clock has to keep ticking. A
   * crossing that quietly stopped consuming the deck would make a losing line look survivable.
   */
  it('still charges for an empty deck', () => {
    const short = atBoundary(['JUNK'])
    const after = crossed(short)
    // One card short of the two owed: 3 damage, and the one card there is still drawn.
    expect(after.players.player.base.damage).toBe(3)
    expect(after.players.player.hand.length).toBe(short.players.player.hand.length + 1)

    const empty = atBoundary([])
    const afterEmpty = crossed(empty)
    expect(afterEmpty.players.player.base.damage).toBe(6)
    expect(afterEmpty.players.player.hand.length, 'nothing to draw').toBe(empty.players.player.hand.length)
  })

  /**
   * The half the engine gave up, now applied by the side that owns the policy (#519).
   *
   * `settleCrossing` runs once per crossing, on both seats, from PUBLIC quantities only: hand size,
   * pool, leader cost and deploy state. That it can be done for the opponent at all is a consequence
   * of the gates being public terms; a hand-reading rule could not model their choice without cheating.
   *
   * Banking a placeholder rather than a known card keeps the model honest in the other direction too:
   * the search is predicting THAT a card is banked, not choosing which, and which is private.
   */
  it('applies the resourcing choice for both seats, under the shipped weights', () => {
    const before = atBoundary(BOMBS_FIRST)
    const after = settleCrossing(crossed(before), DEFAULT_WEIGHTS)
    for (const id of ['player', 'opponent'] as const) {
      const was = before.players[id]
      const now = after.players[id]
      // Shipped weights bank every regroup: two drawn, one banked, so the hand is up one net.
      expect(now.resources.length, `${id} banks`).toBe(was.resources.length + 1)
      expect(now.hand.length, `${id} keeps the other`).toBe(was.hand.length + 1)
    }
  })

  /**
   * The reason the crossing could not stay a constant. With the scarcity bonus on, a seat holding few
   * cards declines, and the modelled future has to reflect the policy the bot is actually playing or
   * the search is measuring an arm that contradicts itself.
   */
  it('declines instead, once the weights say a small hand is worth more', () => {
    const w = { ...DEFAULT_WEIGHTS, cardScarcity: 3, handKnee: 3 }
    const before = atBoundary(BOMBS_FIRST, DEEP_POOL)
    const after = settleCrossing(crossed(before), w)
    for (const id of ['player', 'opponent'] as const) {
      const was = before.players[id]
      const now = after.players[id]
      expect(now.resources.length, `${id} declines`).toBe(was.resources.length)
      expect(now.hand.length, `${id} keeps both`).toBe(was.hand.length + 2)
    }
  })

  /**
   * **That the settlement reaches the SEARCH, not only the helper.**
   *
   * `step` is the single funnel, and the property it carries is "no site calls `resolve` directly".
   * Testing `settleCrossing` alone would pass just as well if nothing in the search ever called it,
   * which is the failure mode this whole area has form for. Two bots differing only in weights must
   * therefore reach differently-settled boards through the real search.
   */
  it('settles inside the search, and follows the deciding bot’s own weights', () => {
    const s = atBoundary(BOMBS_FIRST, DEEP_POOL)
    const passIndex = legalMoves(s).findIndex(m => m.type === 'pass')
    const boardAfterPass = (w: typeof DEFAULT_WEIGHTS): GameState => {
      clearSearchTrace()
      makeBeamGreedy(w, { ...DEFAULT_BEAM_LIMITS, nodes: 200_000, explain: true })(s)
      return lastSearchTrace()!.lines![passIndex].board
    }
    // The control is stated explicitly: the shipped weights now CARRY the bonus, so reading them as
    // the term-off arm would compare the term with itself and prove nothing.
    const banking = boardAfterPass({ ...DEFAULT_WEIGHTS, cardScarcity: 0 })
    const scarce = boardAfterPass(DEFAULT_WEIGHTS)
    expect(banking.players.player.resources.length, 'without the bonus the bot banks at the crossing')
      .toBe(s.players.player.resources.length + 1)
    expect(scarce.players.player.resources.length, 'the shipped weights decline')
      .toBe(s.players.player.resources.length)
  })

  /** Settling reads sizes and the leader, never a card. Permuting the deck cannot reach it. */
  it('settles identically however the deck is ordered', () => {
    const w = { ...DEFAULT_WEIGHTS, cardScarcity: 3, handKnee: 3 }
    const bombs = settleCrossing(crossed(atBoundary(BOMBS_FIRST)), w)
    const junk = settleCrossing(crossed(atBoundary(JUNK_FIRST)), w)
    expect(bombs.players.player.resources.length).toBe(junk.players.player.resources.length)
    expect(bombs.players.player.hand.length).toBe(junk.players.player.hand.length)
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
