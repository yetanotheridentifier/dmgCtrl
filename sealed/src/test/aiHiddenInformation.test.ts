import { describe, it, expect, beforeAll } from 'vitest'
import type { GameState } from '../engine/types'
import { seatView } from '../engine/seatView'
import { resolveAi, beamLimitsFor, namedLimitsFor, aiNames } from '../ai/registry'
import { makeBeamGreedy, BEAM_REPLY_LIMITS, BEAM_REPLY_OMNISCIENT_LIMITS } from '../ai/greedyAi'
import { DEFAULT_WEIGHTS } from '../ai/evaluate'
import { OPPONENT_AI } from '../config'
import {
  HIDDEN_ZONES, withHiddenChanged, probeGames, quietActionPositions, probeHidden, found,
} from './helpers/hiddenInformation'

/**
 * **The bot's move must not depend on a card its seat cannot see.**
 *
 * The search runs the engine, and the engine holds everything: both hands, both decks in draw order,
 * every face-down resource. Asked for the opponent's legal moves it offers the plays of the cards
 * actually in their hand, so a search that models a reply on the real state plans around those cards.
 * Against a person that is the person's hand.
 *
 * **Changing what is hidden is the assertion, not inspecting the code.** Each position is put to the
 * bot again with one hidden zone changed, in a way the mover cannot tell from the original (asserted
 * below against `seatView`, the one definition of what a seat sees). A bot that reads nothing hidden
 * answers the same, by whatever route it searches, now or after the next change to it.
 *
 * These are the positions where the search that read everything is known to change its move, so the
 * file is quick enough to run on every push, and it asserts that the control still does: positions
 * that could not show a leak would pass whatever the bot read. `aiHiddenInformationCorpus.test.ts`
 * asks the same of a wider sample and of every registered bot.
 */

/**
 * Quiet action positions of the mirror probe games (`probeGames`), by index, with the zones the
 * reading search changes its move for on each. Found by running the probe over all 146, and kept to
 * two because each costs seconds: between them they move with every zone the reading search follows
 * on this deck.
 */
const READING_BEAM = { theirHand: [27, 52], theirDeckOrder: [27], ownDeckOrder: [52] }
const BEAM_POSITIONS = [27, 52]

/** The same for two-ply, which is the reply model with nothing else around it. */
const READING_TWO_PLY = { theirHand: [25, 27], theirDeckOrder: [27] }
const TWO_PLY_POSITIONS = [25, 27]

/** `reply:pessimistic` as it was: two-ply over the whole state. There is no registered name for it. */
const twoPlyReading = makeBeamGreedy(DEFAULT_WEIGHTS, { ...beamLimitsFor('reply:pessimistic')!, readHidden: true })

let quiet: GameState[]
const at = (indexes: number[]): GameState[] => indexes.map(i => quiet[i])

beforeAll(() => {
  quiet = quietActionPositions(probeGames('mirror'))
}, 120_000)

describe('the probe', () => {
  it('changes only what the mover cannot see', () => {
    let variants = 0
    for (const state of quiet) {
      const seen = seatView(state, state.activePlayer)
      for (const zone of HIDDEN_ZONES) {
        const variant = withHiddenChanged(state, zone)
        if (variant === null) continue
        variants++
        expect(variant, `${zone} should differ from the position`).not.toEqual(state)
        expect(seatView(variant, variant.activePlayer), `${zone} should be invisible to the mover`).toEqual(seen)
      }
    }
    // Most positions can test most zones: a probe that quietly skipped them would assert nothing.
    expect(variants).toBeGreaterThan(quiet.length * 3)
  })

  it('reads its positions from games that have not changed', () => {
    // The indexes above name boards. If the games behind them move, they name different ones.
    expect(quiet).toHaveLength(146)
  })
})

describe('the search that reads the whole state (the control)', () => {
  it('changes its move with the opponent’s hand, with either deck’s order', () => {
    const counts = probeHidden(resolveAi('beam-reply-omniscient'), at(BEAM_POSITIONS))
    expect(found(counts, 'changed', BEAM_POSITIONS)).toEqual(READING_BEAM)
  }, 120_000)

  it('does so in the reply model alone', () => {
    const counts = probeHidden(twoPlyReading, at(TWO_PLY_POSITIONS))
    expect(found(counts, 'changed', TWO_PLY_POSITIONS)).toEqual(READING_TWO_PLY)
  }, 120_000)

  it('is the shipped search with that one difference, under a name of its own', () => {
    expect(aiNames()).toContain('beam-reply-omniscient')
    expect(BEAM_REPLY_OMNISCIENT_LIMITS).toEqual({ ...BEAM_REPLY_LIMITS, readHidden: true })
    expect(namedLimitsFor('beam-reply-omniscient')).toBe(BEAM_REPLY_OMNISCIENT_LIMITS)
  })
})

describe('the shipped search', () => {
  it('is the bot the build plays, and does not read the whole state', () => {
    expect(OPPONENT_AI).toBe('beam-reply')
    expect(namedLimitsFor(OPPONENT_AI)?.readHidden).toBeUndefined()
  })

  it('plays the same move, and values every candidate the same, whatever is hidden', () => {
    const counts = probeHidden(resolveAi(OPPONENT_AI), at(BEAM_POSITIONS))
    expect(found(counts, 'changed', BEAM_POSITIONS)).toEqual({})
    expect(found(counts, 'revalued', BEAM_POSITIONS)).toEqual({})
    // Every zone was put to it at least once: an empty result from nothing asked would say nothing.
    for (const zone of HIDDEN_ZONES) expect(counts[zone].asked, zone).toBeGreaterThan(0)
  }, 120_000)

  it.each(['reply:pessimistic', 'reply:selfish'])('%s, the reply model alone, does the same', name => {
    const counts = probeHidden(resolveAi(name), at(TWO_PLY_POSITIONS))
    expect(found(counts, 'changed', TWO_PLY_POSITIONS)).toEqual({})
    expect(found(counts, 'revalued', TWO_PLY_POSITIONS)).toEqual({})
  }, 120_000)
})
