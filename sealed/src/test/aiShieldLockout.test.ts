import { describe, it, expect } from 'vitest'
import { beamReplyAi } from '../ai/greedyAi'
import { makeBeamAi, lastSearchTrace, DEFAULT_BEAM_LIMITS } from '../ai/search'
import { evaluate } from '../ai/evaluate'
import { legalMoves } from '../engine/legalMoves'
import { resolve } from '../engine/resolve'
import { state, player, card, unit, CARDS } from './helpers/engineFixtures'
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * The shielded-Sentinel lockout, reported from live play (#493 follow-up).
 *
 * A Sentinel forces every attacker in its arena onto itself. Put a Shield on it and the bot cannot
 * remove it: stripping the Shield leaves a board scoring **identically**, because a Shield is printed
 * 0/0 and works through a damage-prevention hook rather than through stats. So the lane closes and
 * stays closed, and no base damage gets through it for the rest of the game.
 *
 * ## Why this is a scripted position rather than a rate
 *
 * The bench measures self-play over generated decks, and the lockout is a **human strategy**: a
 * player deliberately builds and plays the combination. Neither seat in self-play constructs it on
 * purpose, so it appears in 0.5% of decisions there and never lasts a round, while play-testers hit
 * it constantly. **A defect cannot be measured against an opponent who never exploits it.**
 *
 * That is the same reason #410's sacrifice line and #425's crack-back were pinned by scripted
 * positions first and only then A/B-ed: the aggregate would not have shown either.
 */

const cards = {
  ...CARDS,
  // 3 power kills the chump on the counter-attack and survives one hit from BIG, so clearing it
  // genuinely takes two actions and the order of them matters.
  WALL: card({ id: 'WALL', type: 'unit', arena: 'ground', cost: 3, power: 3, hp: 5, keywords: [{ name: 'Sentinel' }] }),
  CHUMP: card({ id: 'CHUMP', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 1 }),
  BIG: card({ id: 'BIG', type: 'unit', arena: 'ground', cost: 5, power: 5, hp: 6 }),
}

/**
 * The position, and the whole argument.
 *
 * Their ground Sentinel carries a Shield. Our only units are a 1/1 and a 5/6, both ready, and we hold
 * no cards and no resources, so the only decisions are which unit attacks and whether to pass. The
 * lane is our only route to their base.
 *
 * The correct line is **CHUMP first**:
 *
 *   CHUMP -> WALL   the Shield absorbs it, CHUMP dies to the counter, the Shield is gone
 *   BIG   -> WALL   5 damage kills it, BIG takes 3 and survives, the lane is open
 *
 * Leading with BIG instead spends the Shield on our best attacker: it takes 3 for nothing, then needs
 * a second attack to finish WALL and dies doing it. Same two actions, and we lose the 5/6 instead of
 * the 1/1. That is the "do not waste the big attack" case, and it is why the test asserts WHICH unit
 * strips rather than merely that something does.
 */
function lockout(): GameState {
  return state({
    cards,
    players: {
      player: player({ units: [unit('chump', 'CHUMP'), unit('big', 'BIG')] }),
      opponent: player({
        base: { cardId: 'TST_B', damage: 12 },
        units: [unit('wall', 'WALL', { upgrades: [{ cardId: TOKEN_SHIELD, owner: 'opponent' }] })],
      }),
    },
  })
}

const attackWith = (id: string) => ({ type: 'attack', attackerId: id, target: { kind: 'unit', instanceId: 'wall' } })

describe('the shielded-Sentinel lockout', () => {
  /** The fixture has to be a lockout, or the rest proves nothing. */
  it('offers no way past the Sentinel while the Shield is up', () => {
    const s = lockout()
    // Attacking with either unit deals no damage: the Shield absorbs the whole instance.
    for (const id of ['chump', 'big']) {
      const after = resolve(s, attackWith(id) as never)
      const wall = after.players.opponent.units.find(u => u.instanceId === 'wall')
      expect(wall?.damage, `${id} should deal nothing through the Shield`).toBe(0)
    }
    // And their base is untouched by anything we can do this action.
    expect(s.players.opponent.base.damage).toBe(12)
  })

  /** Stripping IS available, and it is what the bot has to find. */
  it('does let a strip through, so the block is escapable', () => {
    const after = resolve(lockout(), attackWith('chump') as never)
    const wall = after.players.opponent.units.find(u => u.instanceId === 'wall')
    expect(wall?.upgrades.some(u => u.cardId === TOKEN_SHIELD), 'the Shield should be spent').toBe(false)
  })

  /**
   * **The defect, recorded as a known failure (#499).**
   *
   * `it.fails` asserts this DOES fail today, so the suite stays green while the defect is pinned, and
   * turns red the moment it is fixed. Convert it to a plain `it` when #499 lands: a known-failure
   * marker left in place after the fix would hide a regression rather than catch one.
   *
   * The bot plays `pass`. Not a bad attack, nothing at all, so the lane stays shut for the rest of
   * the game.
   *
   * It is **not** a missing Shield term. Swept against depth and reply policy on this position, the
   * bot plays this line correctly at shield weight **zero** under `reply: 'null'` at depth 3, and no
   * shield weight up to 16 rescues it under `pessimistic` or `selfish` at depth 3 or 5. The search
   * finds the line; the reply policy refuses it.
   */
  it.fails('strips the Shield with the cheap unit, not the expensive one', () => {
    expect(beamReplyAi(lockout())).toMatchObject({ type: 'attack', attackerId: 'chump' })
  })

  /**
   * The reply is NOT being skipped on a pass, which was the first and most obvious explanation.
   * Ruling it out is what left the horizon as the cause.
   */
  it('hands them a turn with a real attack available when we pass', () => {
    const after = resolve(lockout(), { type: 'pass' })
    expect(after.phase, 'the phase must not end').toBe('action')
    expect(after.activePlayer, 'it must become their turn').toBe('opponent')

    const theirs = legalMoves(after)
    const attacks = theirs.filter(m => m.type === 'attack')
    expect(attacks.length, 'their ready Sentinel should be able to attack').toBeGreaterThan(0)

    // And at least one of those answers must actually cost us something, or a reply is correctly
    // free and the passivity lies elsewhere.
    const ours = evaluate(after, 'player')
    const worst = Math.min(...theirs.map(m => evaluate(resolve(after, m), 'player')))
    expect(worst, 'their best answer must hurt us').toBeLessThan(ours)
  })

  /**
   * **Why the bot passes, recorded because every obvious explanation is wrong.**
   *
   * The search values a move by the **max over every board it can reach**. Measured at depth 3 under
   * `pessimistic`: attack-chump **43.0**, pass **52.0**. Both lines can kill the Sentinel inside
   * three actions; the pass line simply does it one action later.
   *
   *   pass          52 -> they hit our base (-12) -> chump strips, BIG kills WALL (+12) -> 52
   *   attack chump  52 -> lose the chump (-9) -> punished each level -> peaks at 43
   *
   * Acting costs the chump now, and **opening the lane is worth nothing inside the horizon**: BIG
   * exhausts killing the Sentinel, so no base damage lands before the search ends. Within three
   * actions the bot is right that hurrying gains nothing. It cannot see that the lane stays shut for
   * the rest of the game.
   *
   * So it is neither a missing Shield term (#493, measured and rejected) nor a reply-policy bug (the
   * reply fires, asserted above). **The value of removing a lane-blocking Sentinel lies beyond any
   * horizon we can afford**, and only the evaluation can carry it.
   */
  it('values both lines by the same reachable peak, so hurrying looks pointless', () => {
    const s = lockout()
    const moves = legalMoves(s)
    const passAt = moves.findIndex(m => m.type === 'pass')
    const stripAt = moves.findIndex(m => m.type === 'attack' && m.attackerId === 'chump')

    makeBeamAi(evaluate, { ...DEFAULT_BEAM_LIMITS, depth: 3, reply: 'pessimistic', nodes: 200_000 })(s)
    const pessimistic = lastSearchTrace()!.candidates
    // The defect in one line: doing nothing outscores the only move that opens the lane.
    expect(pessimistic[passAt]).toBeGreaterThan(pessimistic[stripAt])

    // And it is the tempo cost rather than the horizon alone: remove the modelled punishment and the
    // same search at the same depth prefers the strip.
    makeBeamAi(evaluate, { ...DEFAULT_BEAM_LIMITS, depth: 3, reply: 'null', nodes: 200_000 })(s)
    const noReply = lastSearchTrace()!.candidates
    expect(noReply[stripAt]).toBeGreaterThan(noReply[passAt])
  })

  /**
   * **A time preference does not escape the lockout either**, measured at 0, 0.5, 1, 2, 4, 8 and 12.
   *
   * The reasoning that motivated it still holds: `valueAt` discounts only DECIDED boards, so an
   * undecided position reached at action 3 scores exactly what it scores at action 1 and delay is
   * free. That is a real gap. It is simply not what causes this.
   *
   * Recorded so the next person does not re-derive it. The knob is `timePreference` on `BeamLimits`,
   * defaulting to 0.
   */
  it('is not escaped by making the search prefer sooner outcomes', () => {
    const strong = makeBeamAi(evaluate, {
      ...DEFAULT_BEAM_LIMITS, depth: 3, reply: 'pessimistic', nodes: 200_000, timePreference: 12,
    })
    expect(strong(lockout())).toMatchObject({ type: 'pass' })
  })

  /** And having stripped it, it finishes the job rather than wandering off. */
  it('kills the Sentinel once the Shield is down', () => {
    const stripped = resolve(lockout(), attackWith('chump') as never)
    // Hand the turn back to us; the opponent passing is the null move the search already assumes.
    const ours = stripped.activePlayer === 'player' ? stripped : resolve(stripped, { type: 'pass' })
    expect(beamReplyAi(ours)).toMatchObject({ type: 'attack', attackerId: 'big' })
  })
})
