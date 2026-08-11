import { describe, it, expect } from 'vitest'
import ashSet from './fixtures/ashSet.json'
import type { SwuCard } from '../data/cards'
import type { GameState } from '../engine/types'
import { makeBeamAi, DEFAULT_BEAM_LIMITS } from '../ai/search'
import { makeEvaluate, DEFAULT_WEIGHTS } from '../ai/evaluate'
import { blockedReach } from '../ai/race'
import { buildCardDb } from '../engine/cardDb'
import { buildCoverageDecks } from '../bench/coverageDecks'
import { initGame } from '../engine/initGame'
import { legalMoves } from '../engine/legalMoves'
import { resolve } from '../engine/resolve'
import { seededShuffle, nextSeed } from '../engine/rng'
import { setupAi } from '../ai/setupAi'
import { greedyAi } from '../ai/greedyAi'
import '../engine/cardDefinitions'

/**
 * Does the gated term still do anything? (#499)
 *
 * Gating denied reach to shielded blockers took the weight-12 A/B from **25.0%** to **48.8%**, which
 * is the catastrophic loss removed. But it matched the `beam-reply` self-play control game for game,
 * 39 of 80 both, and a term that changes no decisions would produce exactly that.
 *
 * "Identical to the control" therefore has two readings, and a win rate cannot separate them:
 * a term that helps as often as it hurts, or a term that is **inert**. This counts the thing directly.
 *
 * A small beam rather than the shipped one, because this asks whether the evaluation reorders
 * candidates, not how deep the search is, and the shipped configuration over a real corpus is minutes.
 */

const POOL = ashSet as unknown as SwuCard[]

/** Real positions, walked with greedy so they are boards the bot actually meets. */
function corpus(limit: number): GameState[] {
  const { decks } = buildCoverageDecks(POOL, 42)
  const cardDb = buildCardDb(POOL)
  const states: GameState[] = []
  let seed = 42

  for (const deck of decks.slice(0, 6)) {
    if (states.length >= limit) break
    seed = nextSeed(seed)
    let s = seed
    let g = initGame(deck, deck, cardDb, {
      firstPlayer: 'player',
      shuffle: <T,>(arr: T[]): T[] => { s = nextSeed(s); return seededShuffle(arr, s) },
      rngSeed: seed,
    })
    while (g.winner === null && states.length < limit) {
      const action = setupAi(g) ?? greedyAi(g)
      if (!action) break
      if (legalMoves(g).length > 1) states.push(g)
      g = resolve(g, action)
    }
  }
  return states
}

describe('the gated blocked-reach term over real positions', () => {
  const states = corpus(200)
  /**
   * **One ply, no reply.** The question is whether the *evaluation* reorders candidates, and no
   * amount of search depth is needed to ask it.
   *
   * This matters for suite health, not just speed. A width-2 depth-2 version of this file ran 7.4s
   * alone and **30.6s** under the full parallel suite, failing its own 30s budget: expensive tests
   * here push unrelated marginal ones over their timeouts, which has now happened twice in this work.
   * The beam figure quoted below was measured once, deliberately, and recorded rather than re-run on
   * every commit.
   */
  const limits = { ...DEFAULT_BEAM_LIMITS, reply: 'null' as const, width: 1, depth: 1 }
  const off = makeBeamAi(makeEvaluate(DEFAULT_WEIGHTS), limits)
  const at = (blockedReach: number) => makeBeamAi(makeEvaluate({ ...DEFAULT_WEIGHTS, blockedReach }), limits)
  const on = at(12)
  // The AI is built ONCE per weight, not once per position. Constructing it inside the filter rebuilt
  // the evaluator 200 times and was most of this test's cost.
  const changedAt = (w: number): number => {
    const ai = at(w)
    return states.filter(s => JSON.stringify(off(s)) !== JSON.stringify(ai(s))).length
  }

  it('collects a corpus worth asking the question of', () => {
    expect(states.length).toBeGreaterThan(150)
  })

  /**
   * **A smaller weight buys the same fix for a quarter of the disturbance.**
   *
   * Both weights escape the lockout identically, because the term removes an option rather than
   * outweighing one: the beam's max over reachable boards drops the passing line from 52 to 43 at any
   * non-zero weight, and no larger weight moves it further. Away from that position they are not
   * equivalent at all, and this is the measurement that separates them.
   *
   * Measured one ply over 200 real positions: **3 changed at weight 1 (1.5%)** against **11 at weight
   * 12 (5.5%)**. Same fix, a quarter of the footprint, and weight 1 sits at the bottom of the model's
   * scale beside `hp` rather than at triple a whole unit.
   */
  it('disturbs far less at an in-scale weight than at twelve', () => {
    const w1 = changedAt(1)
    const w12 = changedAt(12)
    expect(w1, 'weight 1 must still do something, or it cannot fix anything').toBeGreaterThan(0)
    expect(w1, 'and must disturb less than the out-of-scale weight').toBeLessThan(w12)
    // Cheap in isolation, but this file runs inside an 8-way parallel suite where a 2s case stretches
    // past the 5s default. The budget is generous on purpose: the assertion is about behaviour, and a
    // tight limit here fails on load and teaches nothing.
  }, 60_000)

  /**
   * **How often the term is live at all.** Gated, this should be a small fraction: the shielded
   * lockout is 2.1% of decisions, against 24.2% for the ungated version that measured 25.0%.
   */
  it('is live on far fewer positions than the ungated term was', () => {
    const live = states.filter(s => {
      const me = s.activePlayer
      const foe = me === 'player' ? 'opponent' : 'player'
      return blockedReach(s, foe) !== blockedReach(s, me)
    }).length
    // The ungated term measured 24.2% of decisions. Anything near that means the gate is not working.
    expect(live / states.length, 'the gate must actually narrow the term').toBeLessThan(0.10)
  })

  /**
   * **It still changes decisions, which is what "identical to the control" could not tell us.**
   *
   * Measured at **12 of 300 (4.0%)** with a width-2 depth-2 beam. So the 48.8% A/B result is a term
   * that reorders real decisions and comes out level, not a term that does nothing: those look the
   * same in a win rate and are completely different findings.
   *
   * Bounded on both sides. Zero would mean the gate had made it inert, and a term that cannot reorder
   * anything cannot fix the lockout in real play whatever it does on a scripted board. A large
   * fraction would mean the gate had stopped working and we were back to the 24.2% version that
   * measured 25.0%.
   */
  it('still changes decisions, without rewriting the bot', () => {
    let changed = 0
    for (const s of states) {
      if (JSON.stringify(off(s)) !== JSON.stringify(on(s))) changed++
    }
    expect(changed, 'a gate that made the term inert would fix nothing').toBeGreaterThan(0)
    expect(changed / states.length, 'and one that reorders everything is the ungated term again').toBeLessThan(0.15)
  }, 30_000)
})
