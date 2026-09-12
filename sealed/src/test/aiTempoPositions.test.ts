import { describe, it, expect } from 'vitest'
import { makeBeamGreedy } from '../ai/greedyAi'
import { DEFAULT_WEIGHTS } from '../ai/evaluate'
import { BEAM_REPLY_LIMITS } from '../ai/greedyAi'
import { state, player, card, unit, ready, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * Two positions the search **structurally cannot reason about**, kept as scripted boards because
 * self-play cannot price either of them.
 *
 * The shipped beam does not cross the round boundary (`maxCrossings` defaults to 0), and everything
 * readies during the regroup phase (CR 1.7.2c). So every consequence of a card being exhausted, and
 * every reason to take the initiative, lands beyond the horizon the search can see. Both are carried
 * entirely by evaluation terms, and a term carried by nothing else is worth pinning against a board
 * rather than against a win rate the bench cannot resolve.
 *
 * **These prove the positions are handled, not that any change is worth shipping.** They justify a
 * non-inferiority gate, which is the same treatment the shielded-Sentinel lockout gets.
 */

const cards = {
  ...CARDS,
  BIG: card({ id: 'BIG', type: 'unit', arena: 'ground', cost: 6, power: 6, hp: 6 }),
  SMALL: card({ id: 'SMALL', type: 'unit', arena: 'ground', cost: 1, power: 2, hp: 3 }),
  TINY_BASE: card({ id: 'TINY_BASE', type: 'base', hp: 30 }),
}

const beam = makeBeamGreedy(DEFAULT_WEIGHTS, BEAM_REPLY_LIMITS)

/** The shipped bot with one weight overridden, so a knob can be turned without a registry entry. */
const beamWith = (overrides: Partial<typeof DEFAULT_WEIGHTS>) =>
  makeBeamGreedy({ ...DEFAULT_WEIGHTS, ...overrides }, BEAM_REPLY_LIMITS)

/**
 * A unit **enters play exhausted** (CR 1.7.2b), so playing a body is always paying now for power
 * that cannot act until the regroup phase. If readiness were priced steeply enough, playing units
 * would start to look worse than doing nothing, which would be a far larger regression than any
 * tempo term is worth.
 *
 * `aiBombDeployment.test.ts` already pins that the shipped bot plays a big body rather than passing.
 * What is untested is whether that survives a **strong preference for ready cards**, which is what a
 * power-scaled readiness premium would introduce. `readyUnit` is the existing flat version of that
 * premium, so turning it up is the closest available proxy for the risk.
 */
describe('a readiness premium must not stop the bot playing units', () => {
  /**
   * Nothing on board, six ready resources, one big body in hand.
   *
   * `epicActionUsed` is set so the leader cannot deploy. Without it the bot deploys instead, which
   * is a perfectly good move and makes the position measure the wrong decision: the question here is
   * play against pass, not play against deploy.
   */
  const holdingABody = (): GameState => state({
    cards,
    round: 3,
    players: {
      player: player({
        resources: ready(6),
        hand: ['BIG'],
        units: [],
        leader: { cardId: 'TST_L', deployed: false, epicActionUsed: true, exhausted: false },
      }),
      opponent: player({ base: { cardId: 'TINY_BASE', damage: 0 }, units: [] }),
    },
  })

  it('plays the body at the shipped weights', () => {
    expect(beam(holdingABody())).toMatchObject({ type: 'playUnit' })
  })

  /**
   * The guard. A unit arrives exhausted, so every point of readiness premium argues against playing
   * it. At ten times the shipped rate the bot must still put the body down: if this ever fails, a
   * power-scaled premium is unshippable at any comparable size.
   */
  it('still plays the body when readiness is priced ten times higher', () => {
    expect(beamWith({ readyUnit: DEFAULT_WEIGHTS.readyUnit * 10 })(holdingABody()))
      .toMatchObject({ type: 'playUnit' })
  })

  /**
   * **Not** the reason `initiativeExposure` measured harmful, recorded because it was the obvious
   * suspect and it is wrong.
   *
   * A unit enters play exhausted, so playing one converts its whole power into "reach at risk" under
   * that term and charges for it immediately: 12 points at weight 2 for a 6-power body. That looked
   * like enough to suppress playing units altogether. It is not. The body is worth far more than the
   * charge and the bot still puts it down.
   */
  it('is NOT suppressed by initiativeExposure at the weight that measured harmful', () => {
    expect(beamWith({ initiativeExposure: 2 })(holdingABody())).toMatchObject({ type: 'playUnit' })
  })
})

/**
 * **A readiness premium is not neutral between the two ways of putting a body down.**
 *
 * A played unit arrives exhausted (CR 1.7.2b); a deployed leader arrives **ready** (CR 3.3.4). So
 * anything that pays for readiness pays for deploying and charges for playing, and the two decisions
 * move in opposite directions. That is easy to miss when both are loosely called "deploying", and it
 * is the interaction a power-scaled premium would sharpen.
 *
 * Pinned with the existing flat `readyUnit` rate, which is the closest knob that ships.
 */
describe('readiness pulls deploying and playing apart', () => {
  /** Both options open: a 6-cost body in hand, and a leader that can still use its epic action. */
  const bothOptions = (): GameState => state({
    cards,
    round: 3,
    players: {
      player: player({ resources: ready(6), hand: ['BIG'], units: [] }),
      opponent: player({ base: { cardId: 'TINY_BASE', damage: 0 }, units: [] }),
    },
  })

  it('prefers the leader, which arrives ready, over the body, which does not', () => {
    expect(beam(bothOptions())).toMatchObject({ type: 'deployLeader' })
    expect(beamWith({ readyUnit: DEFAULT_WEIGHTS.readyUnit * 10 })(bothOptions()))
      .toMatchObject({ type: 'deployLeader' })
  })
})

/**
 * Taking the initiative costs the **rest of your actions this round** and buys acting first in the
 * next one. Both halves of that trade sit across the regroup phase, which the search never reaches,
 * so the decision rests entirely on the `initiative` and `claimCost` weights.
 *
 * `claimCost` charges per **ready unit** forfeited and nothing for the cards a claim stops you
 * playing. The first test below is the floor that under-charge cannot excuse: with nothing to give
 * up, a claim is free.
 */
describe('taking the initiative', () => {
  /** Late in a round with an empty board and an empty hand: a claim forfeits literally nothing. */
  const nothingToDo = (): GameState => state({
    cards,
    round: 4,
    players: {
      player: player({ resources: ready(0), hand: [], units: [] }),
      opponent: player({ base: { cardId: 'TINY_BASE', damage: 0 }, units: [] }),
    },
  })

  it('claims when the claim is free', () => {
    expect(beam(nothingToDo())).toMatchObject({ type: 'takeInitiative' })
  })

  /**
   * The case the model cannot see. Our big body was played this round so it is **exhausted** and can
   * do nothing now, but it readies at the regroup phase. Acting first next round with it is worth
   * more than the one small attack we could take instead.
   *
   * The bot **attacks** with the small ready unit rather than claiming, and that is simply correct.
   *
   * **The position is degenerate, which is the point worth recording.** Against an empty enemy board
   * with a ready unit there is no reason not to attack: the damage is free, nothing can trade with
   * it, and the action is not needed elsewhere. Any board built this way will say "attack" whatever
   * the initiative weights are, so it cannot be evidence about claiming either way.
   *
   * A position that discriminates needs acting first to *matter*, which means one side lethal next
   * round. That case already has coverage in `aiInitiativeHorizon.test.ts`, under a term
   * (`initiativeHorizon`) measured at +1.87 and shipping at 0 because it did not pay.
   *
   * Kept only as a cheap pin on the obvious case.
   */
  it('attacks rather than claiming when nothing is racing', () => {
    const s = state({
      cards,
      round: 4,
      players: {
        player: player({
          resources: ready(0),
          units: [unit('big', 'BIG', { arena: 'ground', exhausted: true }), unit('sm', 'SMALL', { arena: 'ground' })],
        }),
        opponent: player({ base: { cardId: 'TINY_BASE', damage: 0 }, units: [] }),
      },
    })
    expect(beam(s)).toMatchObject({ type: 'attack' })
  })
})
