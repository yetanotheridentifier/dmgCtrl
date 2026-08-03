import ashSet from '../test/fixtures/ashSet.json'
import '../engine/cardDefinitions' // side effect: registers every implemented card ability
import type { SwuCard } from '../data/cards'
import type { GameState, PlayerId } from '../engine/types'
import type { Action } from '../engine/actions'
import { hasPendingChoices } from '../engine/types'
import { buildCardDb } from '../engine/cardDb'
import { initGame } from '../engine/initGame'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { seededShuffle, nextSeed, seededUnit } from '../engine/rng'
import { setupAi } from '../ai/setupAi'
import { publicBreakdown, makeEvaluate, DEFAULT_WEIGHTS } from '../ai/evaluate'
import { DEFAULT_HAND_WEIGHTS, handQuantities } from '../ai/handValue'
import { makeQuiescent } from '../ai/search'
import { role } from '../ai/race'
import { BUILD_TAG } from '../buildTag'
import { buildCoverageDecks } from './coverageDecks'
import { SCALAR_KEYS, weightsFrom, type WeightKey } from './tune'

/**
 * Term sensitivity (#430): which evaluation weights can actually change a decision.
 *
 * ## The mechanism
 *
 * A one-ply evaluation is only ever used to compare candidates from a SINGLE position, so the score
 * is `sum_k w_k * q_k(candidate)` and a term whose quantity is equal across those candidates adds the
 * same constant to every score. It cancels exactly, whatever its weight.
 *
 * ## Three columns, because no one of them is enough
 *
 * - **Varies**: does `q_k` take more than one value across the candidate set? If never, the weight is
 *   structurally incapable of influencing anything at one ply.
 * - **Pivotal**: does nudging `w_k` by a step change the move the bot picks? Not implied by the
 *   first. A 400,000-game sweep found nothing even for `base` and `unit`, which vary at nearly every
 *   decision: the argmax was robust, not the terms flat. This is "is it worth sweeping".
 * - **Load-bearing**: does setting `w_k` to zero change the pick? This is "can it be deleted", and it
 *   is not implied by the second either. A tie-break whose ordering survives rescaling reads as never
 *   pivotal while still deciding thousands of positions, which is exactly what `hand.hold` does.
 *
 * Read together: never varies is **dead**. Varies but not load-bearing is **inert**. Load-bearing but
 * not pivotal is **doing its job at a value the data cannot improve on**, which is the null sweep
 * result made visible in minutes. Pivotal is **tunable**.
 *
 * Pivotal also covers the two weights that have no `q_k` at all. `saturation` is a knee that splits
 * the pool and `roleShift` bends other weights, so neither is a price and neither can be reported by
 * a variance measure. Perturbation re-runs the real scorer and needs no per-term algebra.
 *
 * ## Reading it after lookahead
 *
 * This is the gate for #410. Several weights are predicted **dormant** rather than dead: they price
 * futures that one ply has no way to see. Re-running this once search lands is how the two are told
 * apart, and "dormant" is a claim about the Pivotal column.
 */

const POOL = ashSet as unknown as SwuCard[]

export interface TermConfig {
  gamesPerDeck: number
  seed: number
  /** Limit the coverage decks used. Every decision is re-scored once per weight per direction, so a
   *  full pass is ~30x a plain one and tests want a couple of decks rather than all 42. */
  decks?: number
  stepCeiling?: number
}

/** Where a decision happened. Regroup and answering a choice offer homogeneous candidate sets, so
 *  "inert at regroup but live during attacks" is visible rather than averaged into one number. */
export type DecisionKind = 'action phase' | 'regroup' | 'answering a choice'

const KINDS: DecisionKind[] = ['action phase', 'regroup', 'answering a choice']

export interface TermKindStat {
  kind: DecisionKind
  decisions: number
  varies: number
  pivotal: number
  loadBearing: number
}

export interface TermStat {
  weight: WeightKey
  /** The perturbation applied, reported because "never pivotal" means nothing without it. */
  step: number
  /**
   * Whether this weight prices a quantity at all.
   *
   * `saturation` and `roleShift` do not: the first decides how the pool is SPLIT between two rates,
   * the second bends other weights. There is nothing to take the variance of, so `varies` is not a
   * finding for them and must not be read as one. Reporting a bare 0 would have said the opposite of
   * the truth for `roleShift`, which is pivotal in 8% of decisions.
   */
  hasQuantity: boolean
  /** Decisions where the term's quantity took more than one value across the candidates. Meaningless
   *  unless `hasQuantity`. */
  varies: number
  /** Decisions where nudging the weight either way changed the chosen move: would TUNING it help. */
  pivotal: number
  /**
   * Decisions where setting the weight to zero changed the chosen move: is it doing anything AT ALL.
   *
   * Not implied by `pivotal`, and the gap is the point. A pure tie-break whose ordering survives
   * scaling reads as never pivotal while still deciding thousands of positions: `hand.hold` varies in
   * 57.7% of decisions with a spread of 13.9 and is pivotal in 0.0%, because it is squashed into
   * `[0, 1)` and rescaling it barely reorders what it discriminates. Deleting it on the strength of
   * the pivotal column alone would remove the fix for the regroup blind spot.
   *
   * So: `pivotal` answers "is this worth sweeping", `loadBearing` answers "can this be deleted".
   */
  loadBearing: number
  /** Mean `max - min` of the quantity, over the decisions where it varies. Magnitude, not just
   *  presence: a term that moves by 1 is not the finding a term that moves by 40 is. */
  spread: number
  byKind: TermKindStat[]
}

export interface TermReport {
  buildTag: string
  games: number
  /** Decisions with a real choice. A single forced move cannot be mis-ranked against anything. */
  decisions: number
  stats: TermStat[]
}

/**
 * How hard to push a weight.
 *
 * A quarter of the shipped value, so every weight gets a proportionate nudge: a flat step of 1 would
 * have moved `lethalExposure` by 4% and then called it inert. Floored at 1 for integer weights,
 * because `publicScore` is integer-valued and a sub-integer nudge to an integer weight could not move
 * anything even in principle. The fractional hand weights keep their fractional step.
 */
export function stepFor(key: WeightKey): number {
  const shipped = key === 'hand.canAct' ? DEFAULT_HAND_WEIGHTS.canAct
    : key === 'hand.hold' ? DEFAULT_HAND_WEIGHTS.hold
    : DEFAULT_WEIGHTS[key as keyof Omit<typeof DEFAULT_WEIGHTS, 'hand'>]
  const quarter = Math.abs(shipped) / 4
  return Number.isInteger(shipped) ? Math.max(1, Math.round(quarter)) : quarter
}

/** The shipped scorer, and the perturbed ones, all built through the same factory the deployed bot
 *  uses so a nudge measures the real thing rather than a lookalike. */
const shippedScore = makeQuiescent(makeEvaluate(DEFAULT_WEIGHTS))

const shippedValue = (key: WeightKey): number =>
  key === 'hand.canAct' ? DEFAULT_HAND_WEIGHTS.canAct
    : key === 'hand.hold' ? DEFAULT_HAND_WEIGHTS.hold
      : DEFAULT_WEIGHTS[key as keyof Omit<typeof DEFAULT_WEIGHTS, 'hand'>]

interface Scorers {
  /** One step either way. Both directions, because a weight can sit at a plateau edge where lowering
   *  it moves the choice and raising it does not. */
  nudged: Array<ReturnType<typeof makeQuiescent>>
  /** The weight switched off entirely. */
  ablated: ReturnType<typeof makeQuiescent>
}

function perturbedScorers(): Map<WeightKey, Scorers> {
  const out = new Map<WeightKey, Scorers>()
  for (const key of SCALAR_KEYS) {
    const step = stepFor(key)
    const shipped = shippedValue(key)
    out.set(key, {
      nudged: [shipped - step, shipped + step].map(v => makeQuiescent(makeEvaluate(weightsFrom({ [key]: v })))),
      ablated: makeQuiescent(makeEvaluate(weightsFrom({ [key]: 0 }))),
    })
  }
  return out
}

/**
 * The move the greedy driver would pick, given already-scored candidates.
 *
 * Reproduced rather than called so the perturbed runs use the SAME seeded tie-break as the shipped
 * one: with an identical best set, both land on the same move, so a difference is the weight's doing
 * and never the coin flip's.
 */
function pick(moves: Action[], scores: number[], rngSeed: number): Action {
  let best = -Infinity
  const bestMoves: Action[] = []
  for (let i = 0; i < moves.length; i++) {
    if (scores[i] > best) {
      best = scores[i]
      bestMoves.length = 0
      bestMoves.push(moves[i])
    } else if (scores[i] === best) {
      bestMoves.push(moves[i])
    }
  }
  return bestMoves[Math.floor(seededUnit(rngSeed) * bestMoves.length)]
}

function kindOf(state: GameState): DecisionKind {
  if (hasPendingChoices(state)) return 'answering a choice'
  return state.phase === 'regroup' ? 'regroup' : 'action phase'
}

/**
 * Every weight that prices a quantity, and the quantity it prices, for one candidate position.
 *
 * The public terms come from `publicBreakdown`; the two hand weights are linear in `handValue`
 * (before the squash, which is strictly monotone and so cannot change whether they vary). Absent
 * keys are the weights that price nothing: `saturation` and `roleShift`.
 */
function quantitiesOf(state: GameState, me: PlayerId, asRole: ReturnType<typeof role>): Partial<Record<WeightKey, number>> {
  const out: Partial<Record<WeightKey, number>> = {}
  for (const [key, term] of Object.entries(publicBreakdown(state, me, DEFAULT_WEIGHTS, asRole))) {
    out[key as WeightKey] = term.quantity
  }
  const hand = handQuantities(state, me)
  out['hand.canAct'] = hand.canAct
  out['hand.hold'] = hand.hold
  return out
}

/** Weights with no quantity to vary. Derived from the breakdown rather than listed, so adding a
 *  coefficient does not silently leave it marked unmeasurable. */
function pricesAQuantity(key: WeightKey, sample: Partial<Record<WeightKey, number>>): boolean {
  return sample[key] !== undefined
}

interface Acc {
  varies: number
  pivotal: number
  loadBearing: number
  spreadSum: number
  byKind: Map<DecisionKind, { decisions: number; varies: number; pivotal: number; loadBearing: number }>
}

const emptyAcc = (): Acc => ({
  varies: 0,
  pivotal: 0,
  loadBearing: 0,
  spreadSum: 0,
  byKind: new Map(KINDS.map(k => [k, { decisions: 0, varies: 0, pivotal: 0, loadBearing: 0 }])),
})

export function runTerms(config: TermConfig): TermReport {
  const all = buildCoverageDecks(POOL, config.seed).decks
  const decks = config.decks === undefined ? all : all.slice(0, config.decks)
  const cardDb = buildCardDb(POOL)
  const ceiling = config.stepCeiling ?? 4000
  const scorers = perturbedScorers()

  const acc = new Map<WeightKey, Acc>(SCALAR_KEYS.map(k => [k, emptyAcc()]))
  let games = 0
  let decisions = 0

  decks.forEach((deck, d) => {
    for (let g = 0; g < config.gamesPerDeck; g++) {
      const seed = nextSeed(config.seed + d * 37 + g)
      const shuffleSeed = { v: seed }
      const shuffle = <T,>(arr: T[]): T[] => { shuffleSeed.v = nextSeed(shuffleSeed.v); return seededShuffle(arr, shuffleSeed.v) }
      let s: GameState = initGame(deck, deck, cardDb, {
        firstPlayer: g % 2 === 0 ? 'player' : 'opponent',
        shuffle,
        rngSeed: seed,
      })
      games++

      for (let i = 0; i < ceiling && s.winner === null; i++) {
        const moves = legalMoves(s)
        if (moves.length === 0) break

        // The setup heuristic drives the opening, exactly as a real game does, and never consults the
        // evaluation. Scoring those positions would report on decisions the weights never make.
        const forced = setupAi(s)
        if (forced) { s = resolve(s, forced); continue }
        if (moves.length < 2) { s = resolve(s, moves[0]); continue }

        const me: PlayerId = s.activePlayer
        // Fixed once per decision, as the greedy driver does it, so what is measured here is what
        // happens there.
        const asRole = role(s, me)
        const kind = kindOf(s)
        const nexts = moves.map(m => resolve(s, m))
        decisions++

        const shipped = nexts.map(n => shippedScore(n, me, asRole))
        const chosen = pick(moves, shipped, s.rngSeed)

        // Decomposed once per candidate, not once per candidate per weight. A decided position
        // short-circuits to +/-WIN before any term is computed, so it has no decomposition and is not
        // evidence either way.
        const decomposed = nexts.filter(n => n.winner === null).map(n => quantitiesOf(n, me, asRole))

        for (const key of SCALAR_KEYS) {
          const a = acc.get(key)!
          const bucket = a.byKind.get(kind)!
          bucket.decisions++

          const quantities = decomposed
            .map(q => q[key])
            .filter((q): q is number => q !== undefined)
          if (quantities.length > 1) {
            const lo = Math.min(...quantities)
            const hi = Math.max(...quantities)
            if (hi > lo) {
              a.varies++
              bucket.varies++
              a.spreadSum += hi - lo
            }
          }

          const sc = scorers.get(key)!
          const picks = (scorer: ReturnType<typeof makeQuiescent>): Action =>
            pick(moves, nexts.map(n => scorer(n, me, asRole)), s.rngSeed)

          if (sc.nudged.some(scorer => picks(scorer) !== chosen)) {
            a.pivotal++
            bucket.pivotal++
          }
          if (picks(sc.ablated) !== chosen) {
            a.loadBearing++
            bucket.loadBearing++
          }
        }

        s = resolve(s, chosen)
      }
    }
  })

  // Any real position answers "does this weight price a quantity", since that is structural rather
  // than positional. Taken from the last decision seen, falling back to the opening board.
  const sample = quantitiesOf(
    initGame(decks[0], decks[0], cardDb, { firstPlayer: 'player', shuffle: a => a, rngSeed: config.seed }),
    'player',
    'neutral',
  )

  const stats: TermStat[] = SCALAR_KEYS.map(key => {
    const a = acc.get(key)!
    return {
      weight: key,
      step: stepFor(key),
      hasQuantity: pricesAQuantity(key, sample),
      varies: a.varies,
      pivotal: a.pivotal,
      loadBearing: a.loadBearing,
      spread: a.varies === 0 ? 0 : a.spreadSum / a.varies,
      byKind: KINDS.map(kind => ({ kind, ...a.byKind.get(kind)! })),
    }
  })

  return { buildTag: BUILD_TAG, games, decisions, stats }
}
