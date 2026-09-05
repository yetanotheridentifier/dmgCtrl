import { describe, it, expect } from 'vitest'
import { makeBeamGreedy, BEAM_REPLY_LIMITS, BEAM_HORIZON_LIMITS } from '../ai/greedyAi'
import { DEFAULT_WEIGHTS, makeEvaluate } from '../ai/evaluate'
import { DEFAULT_HAND_WEIGHTS, reach } from '../ai/handValue'
import { cardValue } from '../ai/cardValue'
import { effectiveCost } from '../engine/legalMoves'
import { resolve } from '../engine/resolve'
import { buildCardDb } from '../engine/cardDb'
import ashSet from './fixtures/ashSet.json'
import type { SwuCard } from '../data/cards'
import type { BeamLimits } from '../ai/search'
import type { EngineCard, GameState } from '../engine/types'
import { state, player, ready, CARDS } from './helpers/engineFixtures'
import '../engine/cardDefinitions'

/**
 * Is `hand.canAct` load-bearing, or is it removable? (#557)
 *
 * ## Why this is a scripted position rather than a rate
 *
 * Term sensitivity run through `beam-horizon`, 2736 decisions, reports the weight **inert**: its
 * quantity varies across candidates 4.7% of the time, and yet nudging it changes the pick zero times
 * and zeroing it changes the pick zero times. Dead even through the search built to wake it.
 *
 * It is still not removable on that reading. `handValue.test.ts` asserts a LOWER bound, that keeping a
 * castable card must beat holding the biggest uncastable bomb in the pool, and the bound inverts at
 * `canAct: 0`. Both readings are true at once because they describe different populations: the weight
 * changes no decision the bench reaches, and removing it inverts a preference in a position the bench
 * does not reach. A measured null is evidence about the corpus, not about the rule.
 *
 * So the question is settled the way the shielded-Sentinel lockout was: build the position the bound
 * describes, and let the shipped bot decide it with the weight at its shipped value and at zero. The
 * two arms are two calls rather than 2000 games.
 *
 * ## The mechanism, which is what makes the position decidable at all
 *
 * Which card you bank is a **public tie**: hand size falls by one and the pool rises by one whichever
 * card goes, so every public term scores both options identically. The hand value is squashed into
 * `[0, 1)` precisely so it can break ties it cannot override, and this is one of the ties. That is
 * why `canAct` can decide here and nowhere the bench looks.
 */

/** The real pool, plus the fixture leader and base so aspect penalties behave like a real deck. */
const db: Record<string, EngineCard> = { ...buildCardDb(ashSet as unknown as SwuCard[]), ...CARDS }

/**
 * One resource in the pool, so banking leaves two.
 *
 * Small on purpose: it is what makes "the only card you can cast" a real category rather than a
 * contrivance, and it puts the bomb three or more beyond reach, where `reach` bottoms out at 0.3 and
 * the bound is at its tightest.
 */
const RESOURCES = 1
const AFTER_BANKING = RESOURCES + 1

const board = (hand: string[] = []): GameState => state({
  phase: 'regroup',
  activePlayer: 'player',
  cards: db,
  players: {
    player: player({ hand, resources: ready(RESOURCES) }),
    opponent: player(),
  },
})

/**
 * Real cards only, and playable types only: the fixture cards are here to be a leader and a base, and
 * a leader or a base is never in hand and never banked.
 */
const playable = Object.values(db).filter(c =>
  c.id.startsWith('ASH_') && (c.type === 'unit' || c.type === 'event' || c.type === 'upgrade'))

const probe = board()
const cost = (c: EngineCard) => effectiveCost(probe, 'player', c)
const value = (c: EngineCard) => cardValue(probe, 'player', c)

const castable = playable.filter(c => cost(c) <= AFTER_BANKING && value(c) > 0)
const stranded = playable.filter(c => cost(c) > AFTER_BANKING)

/**
 * The two cards, DERIVED from the pool rather than named, so the position cannot rot as cards land.
 *
 * `keep` is the poorest thing castable once the banking is done: the weakest possible reason to keep
 * a play, which is the hardest case for the bound and the same quantity it calls `poorest`. `bank` is
 * the richest thing that is not castable and will not be for three turns, which is the hardest case
 * in the other direction and the bound's `richest`.
 */
const keep = castable.slice().sort((a, b) => value(a) - value(b))[0]
const bank = stranded.filter(c => cost(c) > AFTER_BANKING + 2).sort((a, b) => value(b) - value(a))[0]

const position = (): GameState => board([keep.id, bank.id])
const bankMove = (handIndex: number) => ({ type: 'resourceCard', handIndex }) as const

/**
 * The same trap at the size the bot actually meets it.
 *
 * Measured over the 44 coverage decks, a banking decision holds **five** cards 44.4% of the time and
 * two cards 3.5%, and of the 36 decisions where exactly one card was castable, 22 were at five cards.
 * So the two-card fixture above is the bound's worst case and a 3.5% tail; this is the population.
 */
const REALISTIC = [keep, ...stranded.slice().sort((a, b) => value(b) - value(a)).slice(0, 4)]
const realistic = (): GameState => board(REALISTIC.map(c => c.id))

/** Which card the bot turns into a resource, with `canAct` set to `w`. */
function banked(w: number, limits: BeamLimits = BEAM_REPLY_LIMITS, from = position): string {
  const ai = makeBeamGreedy({ ...DEFAULT_WEIGHTS, hand: { ...DEFAULT_HAND_WEIGHTS, canAct: w } }, limits)
  const s = from()
  const move = ai(s)
  expect(move?.type, 'the regroup decision must be a banking decision').toBe('resourceCard')
  return s.players.player.hand[move?.type === 'resourceCard' ? move.handIndex : -1]
}

describe('the position the lower bound describes', () => {
  /** The fixture has to be the described position, or the rest proves nothing. */
  it('holds exactly one castable card beside a better one it cannot cast', () => {
    expect(keep, 'a castable card must exist in the pool').toBeDefined()
    expect(bank, 'an out-of-reach card must exist in the pool').toBeDefined()
    expect(cost(keep)).toBeLessThanOrEqual(AFTER_BANKING)
    expect(cost(bank)).toBeGreaterThan(AFTER_BANKING + 2)
    expect(reach(cost(bank), AFTER_BANKING), 'the bomb must be at the floor of reach').toBe(0.3)
    expect(value(bank), 'the card we want banked must be the better card').toBeGreaterThan(value(keep))
  })

  it('leaves the kept card castable next round, and the banked one still out of reach', () => {
    const after = resolve(position(), bankMove(1))
    expect(after.players.player.resources.length).toBe(AFTER_BANKING)
    expect(after.players.player.hand).toContain(keep.id)
    expect(cost(keep)).toBeLessThanOrEqual(after.players.player.resources.length)
    expect(cost(bank)).toBeGreaterThan(after.players.player.resources.length)
  })

  /**
   * The public half cannot see the difference, which is the whole reason the private half decides it.
   * With both hand weights at zero the two banking options score EXACTLY alike and a seeded coin flip
   * picks, which is the state the hand model was built to end.
   */
  it('is a public tie: without the hand term the two options are indistinguishable', () => {
    const blind = makeEvaluate({ ...DEFAULT_WEIGHTS, hand: { canAct: 0, hold: 0 } })
    const bankTheBomb = resolve(position(), bankMove(1))
    const bankThePlay = resolve(position(), bankMove(0))
    expect(blind(bankTheBomb, 'player')).toBe(blind(bankThePlay, 'player'))
  })
})

describe('hand.canAct decides it', () => {
  it('at the shipped weight, banks the bomb and keeps the play', () => {
    expect(banked(DEFAULT_HAND_WEIGHTS.canAct)).toBe(bank.id)
  })

  /**
   * The answer to the ticket. At zero the bot banks the only card it can play and keeps one it cannot
   * cast for at least three turns, holding a hand it has no way to use.
   */
  it('at zero, banks its last castable card and keeps a card it cannot play', () => {
    expect(banked(0)).toBe(keep.id)
  })

  /**
   * Lookahead is not a substitute, which is worth pinning because it is the obvious next hypothesis.
   * `beam-horizon` is allowed to search on into the next round, where the kept card could actually be
   * played, and it makes the same mistake at zero: the value of holding a play is not something the
   * search recovers on its own.
   */
  it('crossing the round boundary does not recover it', () => {
    expect(banked(0, BEAM_HORIZON_LIMITS)).toBe(keep.id)
    expect(banked(DEFAULT_HAND_WEIGHTS.canAct, BEAM_HORIZON_LIMITS)).toBe(bank.id)
  })

  /**
   * And at the hand size the bot actually meets, which is where 22 of the 36 measured live decisions
   * were. A five-card hand does not dilute the trap: `canAct` is a property of the whole hand, so it
   * still turns on the single castable card whatever else is held beside it.
   */
  it('holds at a five-card hand, not just at the two-card extreme', () => {
    expect(REALISTIC).toHaveLength(5)
    expect(REALISTIC.filter(c => cost(c) <= AFTER_BANKING), 'exactly one castable card').toHaveLength(1)
    expect(banked(0, BEAM_REPLY_LIMITS, realistic)).toBe(keep.id)
    expect(banked(DEFAULT_HAND_WEIGHTS.canAct, BEAM_REPLY_LIMITS, realistic)).not.toBe(keep.id)
  })
})

/**
 * Breadth, so the finding cannot be dismissed as one contrived pair.
 *
 * Over every (castable, stranded) pair the pool can make at this pool size, the term flips the pick in
 * about a third of them: measured 35.8% at a pool of 1, and 34% to 40% at every pool from 1 to 6. This
 * is prevalence over CARD PAIRS, not over positions the game reaches: it says the region is wide, and
 * says nothing about how often play enters it.
 */
describe('how wide the region is', () => {
  it('flips a third of all castable-against-stranded pairs in the pool', () => {
    let flips = 0
    for (const k of castable) {
      for (const b of stranded) {
        const play = DEFAULT_HAND_WEIGHTS.hold * value(k)
        const bomb = DEFAULT_HAND_WEIGHTS.hold * reach(cost(b), AFTER_BANKING) * value(b)
        if ((play > bomb) !== (play + DEFAULT_HAND_WEIGHTS.canAct > bomb)) flips++
      }
    }
    const share = flips / (castable.length * stranded.length)
    expect(share, `${(100 * share).toFixed(1)}% of pairs`).toBeGreaterThan(0.25)
  })
})
