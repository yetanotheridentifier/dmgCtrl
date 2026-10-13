import { describe, it, expect, beforeAll } from 'vitest'
import type { GameState } from '../engine/types'
import { resolveAi, aiNames } from '../ai/registry'
import { OPPONENT_AI } from '../config'
import {
  HIDDEN_ZONES, probeGames, quietActionPositions, choicePositions, probeHidden, found,
  type HiddenZone,
} from './helpers/hiddenInformation'

/**
 * The hidden-information probe over a wider sample, and over every bot the registry names.
 *
 * `aiHiddenInformation.test.ts` says what the probe is and runs it on a handful of positions on every
 * push. This is the same assertion at a size that takes minutes: a sample of ordinary decisions and of
 * choice answers from both sets of probe games, for the bot the build ships, and then every registered
 * bot on the positions where a search reading the whole state is known to change its move.
 *
 * The samples are fixed strides through fixed games. The offsets of the ordinary-decision samples
 * were chosen so that each holds positions the reading search changed its move on (bench deck 36, 84
 * and 96; coverage decks 25, 57, 105, 121 and 153, all for the opponent's hand): a sample that search
 * would have passed is not a guard. Sized by cost, at two to three seconds a position.
 */

const every = (positions: GameState[], stride: number, offset: number): GameState[] =>
  positions.filter((_, i) => i % stride === offset)

/**
 * The registered bots that read the whole state ON PURPOSE, each the control for one fix. They are
 * the only names allowed to change a move with a hidden card, and they are held to doing so: a
 * control that stopped reading would be compared with its arm and report a clean null.
 */
const READS_EVERYTHING = ['beam-reply-omniscient', 'beam-reply-unredacted']

/**
 * Bots whose move may still follow the order of THEIR OWN deck, which no player knows either.
 *
 * One ply resolves each candidate on the real state, so a move that draws is scored holding the card
 * actually on top. None of these searches a reply or is the bot a person plays, and `greedy` plays
 * the games every cost and budget corpus is read from, so changing what it sees is its own change.
 * The opponent's side they are held to like everything else.
 */
const READS_OWN_DECK = ['greedy', 'greedy-flat', 'greedy-baseline']

/**
 * Quiet positions of the mirror probe games where the reading search changes its move: with the
 * opponent's hand and their deck's order on 118 and 142, with its own deck's order on 145.
 */
const KNOWN = [118, 142, 145]
const THEIRS: HiddenZone[] = ['theirHand', 'theirDeckOrder', 'theirResources']

let mirror: GameState[]
let coverage: GameState[]

beforeAll(() => {
  mirror = probeGames('mirror')
  coverage = probeGames('coverage')
}, 300_000)

describe('the shipped bot, over a sample of real decisions', () => {
  const samples: Array<[string, () => GameState[], number]> = [
    ['ordinary decisions on the bench deck', () => every(quietActionPositions(mirror), 12, 0), 13],
    ['ordinary decisions on the coverage decks', () => every(quietActionPositions(coverage), 16, 9), 10],
    ['choice answers on the bench deck', () => every(choicePositions(mirror), 6, 0), 9],
    ['choice answers on the coverage decks', () => every(choicePositions(coverage), 6, 0), 9],
  ]

  it.each(samples)('%s: no move and no value follows a hidden card', (_, sample, size) => {
    const positions = sample()
    expect(positions).toHaveLength(size)
    const counts = probeHidden(resolveAi(OPPONENT_AI), positions)
    expect(found(counts, 'changed')).toEqual({})
    expect(found(counts, 'revalued')).toEqual({})
    for (const zone of HIDDEN_ZONES) expect(counts[zone].asked, zone).toBeGreaterThan(0)
  }, 900_000)
})

describe('every registered bot', () => {
  const fair = aiNames().filter(name => !READS_EVERYTHING.includes(name))

  it.each(fair)('%s plays the same move whatever the opponent holds, has resourced or will draw', name => {
    const counts = probeHidden(resolveAi(name), KNOWN.map(i => quietActionPositions(mirror)[i]), THEIRS)
    expect(found(counts, 'changed', KNOWN)).toEqual({})
    expect(found(counts, 'revalued', KNOWN)).toEqual({})
  }, 300_000)

  it.each(fair.filter(name => !READS_OWN_DECK.includes(name)))('%s plays the same move whatever order its own deck is in', name => {
    const counts = probeHidden(resolveAi(name), KNOWN.map(i => quietActionPositions(mirror)[i]), ['ownDeckOrder'])
    expect(found(counts, 'changed', KNOWN)).toEqual({})
    expect(found(counts, 'revalued', KNOWN)).toEqual({})
  }, 300_000)

  it.each(READS_EVERYTHING)('%s, a control, still reads what it is the control for', name => {
    const counts = probeHidden(resolveAi(name), KNOWN.map(i => quietActionPositions(mirror)[i]))
    const moved = found(counts, 'changed', KNOWN)
    // Each is a different search, so which positions move differs; that each zone moves one does not.
    expect(Object.keys(moved).sort()).toEqual(['ownDeckOrder', 'theirDeckOrder', 'theirHand'])
  }, 300_000)
})
