import { describe, it, expect } from 'vitest'
import { beamReplyAi } from '../ai/greedyAi'
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

  /** And having stripped it, it finishes the job rather than wandering off. */
  it('kills the Sentinel once the Shield is down', () => {
    const stripped = resolve(lockout(), attackWith('chump') as never)
    // Hand the turn back to us; the opponent passing is the null move the search already assumes.
    const ours = stripped.activePlayer === 'player' ? stripped : resolve(stripped, { type: 'pass' })
    expect(beamReplyAi(ours)).toMatchObject({ type: 'attack', attackerId: 'big' })
  })
})
