import { describe, it, expect } from 'vitest'
import { makePublicScore, initiativeValue, DEFAULT_WEIGHTS } from '../ai/evaluate'
import { makeBeamGreedy, BEAM_REPLY_LIMITS } from '../ai/greedyAi'
import { reachSteady, reachThisRound } from '../ai/race'
import { resolve } from '../engine/resolve'
import { state, player, card, unit, ready, CARDS } from './helpers/engineFixtures'
import type { GameState, PlayerId } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * `initiativeExposure`: holding the initiative counter is worth less while it can still be taken.
 *
 * Taking the initiative is once per round across both players (CR 1.15.5a), so until someone takes
 * it, the holder's grip is contingent. `initiativeValue`'s `holding` term reads only **who holds the
 * counter**, which claiming does not change when you already hold it, so a **denial claim** scores as
 * pure `claimCost` with no benefit and the bot can never make one. That is structural: raising
 * `initiative` cannot fix it, because the benefit side is identical before and after the claim.
 *
 * What acting first is worth is measured by what it protects and pre-empts, and both are the same
 * quantity: **reach locked up in exhausted units**, `reachSteady - reachThisRound`. Ours because
 * acting first lets it attack before it can be traded with; theirs because acting first lets us
 * pre-empt it. The shipped search cannot reach either, since it does not cross the round boundary.
 *
 * See `aiRoundBoundaryScenarios.test.ts` for the real positions this exists to resolve.
 */

const cards = {
  ...CARDS,
  BIG: card({ id: 'BIG', type: 'unit', arena: 'ground', cost: 6, power: 8, hp: 4 }),
  SMALL: card({ id: 'SMALL', type: 'unit', arena: 'ground', cost: 1, power: 2, hp: 3 }),
  BASE_30: card({ id: 'BASE_30', type: 'base', hp: 30 }),
}

/**
 * `mine` and `theirs` name each seat's units; a trailing `!` marks one exhausted, so its reach is
 * locked up until the regroup phase.
 */
const board = (mine: string[], theirs: string[], holder: PlayerId = 'player'): GameState => state({
  cards,
  round: 5,
  initiative: holder,
  initiativeTakenBy: null,
  players: {
    player: player({
      base: { cardId: 'BASE_30', damage: 0 },
      resources: ready(0),
      leader: { cardId: 'TST_L', deployed: false, epicActionUsed: true, exhausted: false },
      units: mine.map((c, i) => unit(`u${i}`, c.replace('!', ''), { arena: 'ground', exhausted: c.endsWith('!') })),
    }),
    opponent: player({
      base: { cardId: 'BASE_30', damage: 0 },
      resources: ready(0),
      leader: { cardId: 'TST_L', deployed: false, epicActionUsed: true, exhausted: false },
      units: theirs.map((c, i) => unit(`e${i}`, c.replace('!', ''), { arena: 'ground', exhausted: c.endsWith('!') })),
    }),
  },
})

const at = (initiativeExposure: number, s: GameState, me: PlayerId = 'player'): number =>
  initiativeValue(s, me, { ...DEFAULT_WEIGHTS, initiativeExposure })

describe('the initiativeExposure weight', () => {
  it('is off by default, per the rule that a new weight ships at zero', () => {
    expect(DEFAULT_WEIGHTS.initiativeExposure).toBe(0)
  })

  it('changes nothing at zero, whatever the position', () => {
    const plain = makePublicScore({ ...DEFAULT_WEIGHTS, roleShift: 0 })
    for (const s of [board(['BIG!'], []), board([], ['BIG!']), board(['SMALL'], ['SMALL'])]) {
      expect(makePublicScore({ ...DEFAULT_WEIGHTS, roleShift: 0, initiativeExposure: 0 })(s, 'player', 'neutral'))
        .toBe(plain(s, 'player', 'neutral'))
    }
  })

  /** The charge itself: the holder has something to lose and has not secured it. */
  it('charges the holder while the counter can still be taken', () => {
    const s = board(['BIG!'], [])
    expect(reachSteady(s, 'player') - reachThisRound(s, 'player'), 'exhausted reach at risk').toBe(8)
    expect(at(1, s)).toBeLessThan(at(0, s))
  })

  /** Both sides count: ours is protected by acting first, theirs is pre-empted by it. */
  it('scales with exhausted reach on either side', () => {
    const mineOnly = at(1, board(['BIG!'], [])) - at(0, board(['BIG!'], []))
    const theirsOnly = at(1, board([], ['BIG!'])) - at(0, board([], ['BIG!']))
    const both = at(1, board(['BIG!'], ['BIG!'])) - at(0, board(['BIG!'], ['BIG!']))
    expect(mineOnly).toBe(-8)
    expect(theirsOnly).toBe(-8)
    expect(both, 'the stake is the sum').toBe(-16)
  })

  /** Ready reach is not at risk: it attacks this round whoever acts first next round. */
  it('ignores reach that is already ready', () => {
    const s = board(['BIG'], [])
    expect(at(1, s)).toBe(at(0, s))
  })

  /**
   * **The charge rises when you attack, and that is a side effect worth knowing about.**
   *
   * `UnitState` records only `exhausted`, with nothing saying why, so the stake cannot tell a unit
   * played this round (its reach pending and genuinely at risk) from one that has already attacked
   * (its reach delivered). Attacking exhausts the attacker, so it moves that unit's reach into the
   * at-risk pile and increases the charge.
   *
   * It is defensible rather than wrong: a unit that attacked still readies at the regroup phase and
   * can still be traded off before it acts again, so its reach really is pending for next round. But
   * it means the term touches **every decision the holder makes**, not only the claim, and a null
   * sweep result could be this rather than the idea being wrong.
   */
  it('rises when a unit attacks, because exhaustion is all it can see', () => {
    const ready = board(['BIG'], [])
    const afterAttacking = board(['BIG!'], [])
    expect(at(1, ready), 'ready: nothing at risk').toBe(at(0, ready))
    expect(at(1, afterAttacking) - at(0, afterAttacking), 'exhausted: the full reach is charged').toBe(-8)
  })

  /** Once taken, the holding is secure and there is nothing left to price. */
  it('is silent once the counter has been taken', () => {
    const s = { ...board(['BIG!'], []), initiativeTakenBy: 'player' as PlayerId }
    expect(at(1, s)).toBe(at(0, s))
  })

  /**
   * **Charged to the holder only, and deliberately not zero-sum.**
   *
   * Crediting the non-holder for the same stake would be the symmetric reading, and it is wrong: the
   * credit would vanish the moment they took the counter, so taking it would score as a loss. The
   * non-holder's opportunity is already expressed by the `holding` swing when they take it, and
   * pricing it twice inverts the decision it exists to fix.
   */
  it('does not credit the non-holder, which would make taking the counter look like a loss', () => {
    const s = board(['BIG!'], [], 'opponent')
    expect(at(1, s), 'we do not hold it, so nothing is charged to us').toBe(at(0, s))
  })

  /** The behaviour the whole term is for: claiming removes the charge. */
  it('is removed by claiming, which is what makes a denial claim worth anything', () => {
    const s = board(['BIG!'], [])
    const claimed = resolve(s, { type: 'takeInitiative' })
    expect(claimed.initiativeTakenBy).toBe('player')
    expect(at(1, claimed)).toBeGreaterThan(at(1, s))
  })

  /**
   * **Why it measured harmful: it buys the always-claim failure mode.**
   *
   * The charge is removed entirely by claiming, so once a real amount of reach is exhausted, a claim
   * is worth `weight x stake` in one action and nothing else on the board competes. Mid-round, after
   * the board has attacked, that is most of it.
   *
   * Giving up the rest of every round is a failure mode this project has already priced: the note on
   * `claimCost` records `claimCost: 0`, the always-claim configuration, measuring **41.1%**.
   *
   * Suppressing plays and attacks was the obvious suspect and is NOT the cause; see
   * `aiTempoPositions.test.ts`, where a 6-power body is still played at weight 2.
   */
  it('makes a claim beat an attack once the board has exhausted itself', () => {
    // Three spent attackers and one ready body left: 24 points of reach at risk, and an attack
    // available with the unit still standing.
    const s = board(['BIG!', 'BIG!', 'BIG!', 'SMALL'], [])
    const ai = (initiativeExposure: number) =>
      makeBeamGreedy({ ...DEFAULT_WEIGHTS, initiativeExposure }, BEAM_REPLY_LIMITS)(s)!.type
    expect(ai(0), 'unweighted, it uses the action').toBe('attack')
    expect(ai(2), 'weighted, it buys the counter instead').toBe('takeInitiative')
  })

  /** And unlike the `initiative` weight, this one actually moves when the claim is made. */
  it('moves on a denial claim where the initiative weight cannot', () => {
    const s = board(['BIG!'], [])
    const claimed = resolve(s, { type: 'takeInitiative' })
    expect(s.initiative, 'already ours before claiming').toBe('player')
    expect(claimed.initiative, 'and still ours after').toBe('player')
    // The `initiative` weight reads only that, so it is identical either side of the claim.
    const holdingOnly = { ...DEFAULT_WEIGHTS, claimCost: 0, initiativeExposure: 0 }
    expect(initiativeValue(claimed, 'player', holdingOnly)).toBe(initiativeValue(s, 'player', holdingOnly))
  })
})
