import { describe, it, expect } from 'vitest'
import { makeBeamGreedy, BEAM_REPLY_LIMITS } from '../ai/greedyAi'
import { DEFAULT_WEIGHTS } from '../ai/evaluate'
import { reachSteady, reachThisRound, remainingBase, canFinishNow } from '../ai/race'
import { initiativeValue } from '../ai/evaluate'
import { resolve } from '../engine/resolve'
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import { state, player, card, unit, ready, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * Three real positions whose correct play is decided **entirely across the round boundary**.
 *
 * The shipped beam does not cross that boundary (`maxCrossings` defaults to 0), and everything
 * readies during the regroup phase (CR 1.7.2c), so in each of these the reason to act sits past the
 * horizon. Individually such positions are rare; collectively they are most of what a real game of
 * this is made of, which is why they are worth scripting rather than waiting for self-play to find.
 *
 * The cards are the real ASH ones, stats taken from the set data:
 *
 * - **Tatooine Sand Beast** (ASH 225), cost 6, **8/4**, Hidden. It can't be attacked the phase it is
 *   played, and it enters play exhausted like any played unit, so its 8 power is a threat that only
 *   becomes real next round, and only if it survives to act.
 * - **Rebel Infiltrators** (ASH 256), cost 5, **4/6**, Saboteur and Restore 1. Four power is exactly
 *   the Beast's HP, so it trades with it; Saboteur means a Sentinel cannot be put in the way.
 *
 * **These are diagnostics, not assertions that the bot is wrong.** Each records what it does, with
 * the arithmetic that decides the position stated alongside, so that a later change to the initiative
 * model can be read against a position rather than against a win rate the bench cannot resolve.
 */

const cards = {
  ...CARDS,
  BEAST: card({
    id: 'BEAST', type: 'unit', arena: 'ground', cost: 6, power: 8, hp: 4,
    keywords: [{ name: 'Hidden' }],
  }),
  INFILTRATORS: card({
    id: 'INFILTRATORS', type: 'unit', arena: 'ground', cost: 5, power: 4, hp: 6,
    keywords: [{ name: 'Saboteur' }, { name: 'Restore', value: 1 }],
  }),
  SMALL: card({ id: 'SMALL', type: 'unit', arena: 'ground', cost: 1, power: 2, hp: 3 }),
  BASE_8: card({ id: 'BASE_8', type: 'base', hp: 8 }),
  BASE_6: card({ id: 'BASE_6', type: 'base', hp: 6 }),
  BASE_30: card({ id: 'BASE_30', type: 'base', hp: 30 }),
}

const shield = () => [{ cardId: TOKEN_SHIELD, owner: 'opponent' as const }]

const beam = makeBeamGreedy(DEFAULT_WEIGHTS, BEAM_REPLY_LIMITS)

/**
 * The Beast player's seat in scenarios (a) and (c): a ready 2/3, and the Beast just played, so it is
 * exhausted and hidden. Their base HP is what separates the two scenarios.
 *
 * `epicActionUsed` keeps the leader out of it. With a deploy available the position measures a
 * different decision, as `aiTempoPositions.test.ts` found the hard way.
 */
const beastSeat = (myBaseId: string, theirBaseId: string, theirShield: boolean): GameState => state({
  cards,
  round: 5,
  players: {
    player: player({
      base: { cardId: myBaseId, damage: 0 },
      resources: ready(0),
      leader: { cardId: 'TST_L', deployed: false, epicActionUsed: true, exhausted: false },
      units: [
        unit('small', 'SMALL', { arena: 'ground' }),
        unit('beast', 'BEAST', { arena: 'ground', exhausted: true, hidden: true }),
      ],
    }),
    opponent: player({
      base: { cardId: theirBaseId, damage: 0 },
      resources: ready(0),
      leader: { cardId: 'TST_L', deployed: false, epicActionUsed: true, exhausted: false },
      units: [unit('inf', 'INFILTRATORS', { arena: 'ground', upgrades: theirShield ? shield() : [] })],
    }),
  },
})

describe('the arithmetic these positions turn on', () => {
  /**
   * The quantity that decides every scenario below already exists. `reachSteady` is base damage a
   * seat lands "once everything has readied at regroup", so it is precisely "what my board does next
   * round", and the bot can compute it today.
   */
  it('can already see that the Beast is lethal next round but not this one', () => {
    const s = beastSeat('BASE_8', 'BASE_6', true)
    expect(remainingBase(s, 'player'), 'their base').toBe(6)
    expect(reachThisRound(s, 'player'), 'only the ready 2/3 can act now').toBe(2)
    expect(reachSteady(s, 'player'), 'next round the Beast readies: 8 + 2').toBe(10)
    expect(canFinishNow(s, 'player'), 'not winnable this round').toBe(false)
    // So: lethal next round if the board survives, and it is `reachSteady >= remainingBase`.
    expect(reachSteady(s, 'player')).toBeGreaterThanOrEqual(remainingBase(s, 'player'))
  })

  /** And the threat to it is equally computable: 4 power against the Beast's 4 HP is exactly lethal. */
  it('can already see that the Infiltrators trade with the Beast', () => {
    expect(cards.INFILTRATORS.power).toBe(cards.BEAST.hp)
  })
})

/**
 * **(a) The Beast player should claim.**
 *
 * Their base is on 6 and the Beast readies to 8 power next round, so acting first next round wins.
 * Attacking with the 2/3 instead hands the opponent the chance to claim, act first, and trade the
 * Infiltrators into the Beast before it ever attacks. Two damage now costs the game.
 *
 * Nothing in the model prices this. `initiativeHorizon` covers the mirror case, where the holder is
 * the side **facing** lethal, and is silent here where the holder is the side **delivering** it. It
 * also ships at 0.
 */
describe('(a) claiming to protect a threat that is lethal next round', () => {
  it('records the choice', () => {
    const s = beastSeat('BASE_8', 'BASE_6', true)
    const move = beam(s)!
    expect(move.type).toBe('attack')
  })
})

/**
 * **(b) The Infiltrators player should claim**, denying the lethal rather than adding a Shield.
 *
 * Acting first next round lets them trade into the Beast before it attacks, at the cost of the
 * Infiltrators. This is the case `initiativeHorizon` was built for, and it ships at 0.
 */
describe('(b) claiming to deny a threat that is lethal against you next round', () => {
  const infiltratorSeat = (): GameState => state({
    cards,
    round: 5,
    players: {
      player: player({
        base: { cardId: 'BASE_8', damage: 0 },
        resources: ready(0),
        leader: { cardId: 'TST_L', deployed: false, epicActionUsed: true, exhausted: false },
        units: [unit('inf', 'INFILTRATORS', { arena: 'ground' })],
      }),
      opponent: player({
        base: { cardId: 'BASE_6', damage: 0 },
        resources: ready(0),
        leader: { cardId: 'TST_L', deployed: false, epicActionUsed: true, exhausted: false },
        units: [
          unit('small', 'SMALL', { arena: 'ground' }),
          unit('beast', 'BEAST', { arena: 'ground', exhausted: true, hidden: true }),
        ],
      }),
    },
  })

  it('sees that they are lethal against us next round', () => {
    const s = infiltratorSeat()
    expect(reachSteady(s, 'opponent')).toBe(10)
    expect(remainingBase(s, 'opponent'), 'our base').toBe(8)
  })

  it('records the choice', () => {
    expect(beam(infiltratorSeat())!.type).toBe('attack')
  })
})

/**
 * **(c) The same board with both bases far from lethal.**
 *
 * No lethal predicate can fire here, and the Beast player still wants to claim: acting first next
 * round is how the Beast's 8 damage lands before the Infiltrators trade into it. The quantity that
 * decides it is not lethal at all, it is **reach locked up in exhausted units that the opponent gets
 * a turn to remove first**, which is `reachSteady - reachThisRound`.
 */
describe('(c) claiming to protect a threat when nothing is lethal', () => {
  it('has no lethal to price, but the same reach is at risk', () => {
    const s = beastSeat('BASE_30', 'BASE_30', true)
    expect(reachSteady(s, 'player') >= remainingBase(s, 'player'), 'no lethal next round').toBe(false)
    // The general quantity, which no term reads today.
    expect(reachSteady(s, 'player') - reachThisRound(s, 'player')).toBe(8)
  })

  it('records the choice', () => {
    expect(beam(beastSeat('BASE_30', 'BASE_30', true))!.type).toBe('attack')
  })
})

/**
 * **The diagnosis, and it is structural rather than a matter of tuning.**
 *
 * In all three scenarios the seat that should claim **already holds the initiative**, and claiming is
 * a *denial*: the counter has not been taken this round (CR 1.15.5a), so the opponent can still take
 * it, and claiming is what stops them.
 *
 * `initiativeValue` cannot express that. Its `holding` term reads `state.initiative === me`, which is
 * who holds the counter, and that is unchanged by claiming when you already hold it. `claimCost` is
 * charged in full for the ready units forfeited. So a denial claim scores as **pure cost with no
 * benefit**, always, in every position.
 *
 * That is why the bot claims only when it has literally nothing else to do, as
 * `aiTempoPositions.test.ts` shows: there the cost is zero and the pass charge makes a claim the
 * least-bad option. It is not a weight that is set too low. No value of `initiative` or `claimCost`
 * can make a denial claim attractive, because neither term moves when the claim is made.
 *
 * The missing distinction is **secure against insecure holding**: whether the counter can still be
 * taken away, which is exactly `initiativeTakenBy === null`.
 */
/**
 * Whether `initiativeExposure` actually resolves these, at a weight it might plausibly ship at.
 *
 * **If it cannot, these stay as they are: expected failures kept deliberately.** Each is a position
 * a competent player reads instantly and this model cannot represent, so they are a standing
 * benchmark for whatever replaces it. A learned model that crosses the round boundary should pass
 * them; the current hand-weighted evaluation is not obviously able to, and pretending otherwise by
 * tuning a weight until three scripted boards go green would be fitting to the test rather than
 * fixing the bot.
 */
describe('does the exposure term resolve them', () => {
  const withExposure = (n: number) =>
    makeBeamGreedy({ ...DEFAULT_WEIGHTS, initiativeExposure: n }, BEAM_REPLY_LIMITS)

  it('(a) the Beast player, lethal next round if the Beast survives', () => {
    const s = beastSeat('BASE_8', 'BASE_6', true)
    expect(withExposure(1)(s)!.type).toBe('takeInitiative')
  })

  it('(c) the Beast player, with nothing lethal', () => {
    const s = beastSeat('BASE_30', 'BASE_30', true)
    expect(withExposure(1)(s)!.type).toBe('takeInitiative')
  })

  /**
   * **(b) is NOT resolved, and it is kept as an expected failure.**
   *
   * The stake is read correctly: the Beast is 8 points of the opponent's exhausted reach, so the
   * term fires. It is simply outweighed. The alternative is attacking the ready 2/3 with a 4-power
   * unit, which defeats it outright, and a whole body is worth far more board points than eight
   * points of reach at risk. Raising `initiativeExposure` until this board flips would be fitting the
   * weight to the test.
   *
   * The deeper reason is that **(b)'s urgency is lethality, not reach.** The opponent's `reachSteady`
   * of 10 against a base on 8 means they simply win next round if they act first; that is a step
   * change, not a linear quantity, and a term that scales with reach cannot express it.
   *
   * That case is `initiativeHorizon`'s, and it fires here. It carries the same denial blind spot:
   * it gates on `state.initiative === seat`, which a denial claim does not change, so it too is
   * identical either side of the claim.
   *
   * **Do not "fix" that without reading the measurement first.** Denial claims have been followed to
   * the end of the game and do **not convert**: where the opponent finishes next round and we do
   * not, claiming buys time (42.4% survive the round it bought against 19.6% of declines) and wins
   * **12.1% against declining's 13.2%**, with the bias running the other way, since declined
   * decisions are hopeless 41.6% of the time against claimed's 15.2%. `experiments.md` records the
   * conclusion as "a low denial claim rate is defensible behaviour rather than a blind spot".
   * `initiativeHorizon` itself swept to no reliable gradient (+1.87 at weight 3, +1.0 at 6,
   * indistinguishable) at 65-70% more wall clock.
   *
   * So this position is a **known** loss that the model declines to chase for measured reasons, not
   * an oversight. It stays here as a benchmark for a model that can see across the boundary cheaply
   * enough to be worth it.
   */
  it.fails('(b) the Infiltrators player, pre-empting a threat aimed at them', () => {
    const s = state({
      cards,
      round: 5,
      players: {
        player: player({
          base: { cardId: 'BASE_8', damage: 0 },
          resources: ready(0),
          leader: { cardId: 'TST_L', deployed: false, epicActionUsed: true, exhausted: false },
          units: [unit('inf', 'INFILTRATORS', { arena: 'ground' })],
        }),
        opponent: player({
          base: { cardId: 'BASE_6', damage: 0 },
          resources: ready(0),
          leader: { cardId: 'TST_L', deployed: false, epicActionUsed: true, exhausted: false },
          units: [
            unit('small', 'SMALL', { arena: 'ground' }),
            unit('beast', 'BEAST', { arena: 'ground', exhausted: true, hidden: true }),
          ],
        }),
      },
    })
    expect(withExposure(1)(s)!.type).toBe('takeInitiative')
  })
})

describe('why the bot never claims to deny', () => {
  it('scores a denial claim as cost with no benefit', () => {
    const s = beastSeat('BASE_8', 'BASE_6', true)
    expect(s.initiative, 'we already hold it').toBe('player')
    expect(s.initiativeTakenBy, 'and it has not been taken, so they can still take it').toBeNull()

    const after = resolve(s, { type: 'takeInitiative' })
    expect(after.initiative, 'claiming does not change who holds it').toBe('player')
    expect(after.initiativeTakenBy, 'it changes only whether it is still takeable').toBe('player')

    // So the only movement is the charge, in the wrong direction.
    expect(initiativeValue(after, 'player', DEFAULT_WEIGHTS))
      .toBeLessThan(initiativeValue(s, 'player', DEFAULT_WEIGHTS))
  })

  /** And no weight rescues it: the benefit side is identical before and after, at any value. */
  it('is not fixable by raising the initiative weight', () => {
    const s = beastSeat('BASE_8', 'BASE_6', true)
    const after = resolve(s, { type: 'takeInitiative' })
    for (const initiative of [1, 4, 20]) {
      const w = { ...DEFAULT_WEIGHTS, initiative, claimCost: 0 }
      expect(initiativeValue(after, 'player', w), `initiative ${initiative}`)
        .toBe(initiativeValue(s, 'player', w))
    }
  })
})
