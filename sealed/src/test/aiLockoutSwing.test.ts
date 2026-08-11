import { describe, it, expect } from 'vitest'
import { lockoutSwing, blockedReach } from '../ai/race'
import { state, player, card, unit, CARDS } from './helpers/engineFixtures'
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * Pricing the lockout as a stream rather than a snapshot (#499).
 *
 * The flat term measured 49.6% and its shape is why. Read off the filed report, denied reach **rises**
 * as locked units accumulate while the benefit of clearing **falls** as the game runs out:
 *
 * | round | denied | rounds left |
 * | 3 | 2 | 4 |
 * | 4 | 6 | 3 |
 * | 5 | 5 | 2 |
 * | 6 | 9 | 1 |
 *
 * So the term was quietest when clearing mattered most and loudest when the bot was already dead. That
 * is a defect in shape, not in tuning, and no weight fixes it.
 *
 * The swing is what clearing a blocker is actually worth: the damage it **denies** us plus the damage
 * it **deals** us, for as long as the game has left to run. On the reported game that is 22 denied and
 * 8 dealt over four rounds, against a bot that lost by 3.
 *
 * The blocker's own output is the second half and it is not decoration: #503 has a **0/3** Sentinel
 * denying reach while threatening nothing, where delaying was the right call. A term reading only
 * denial rates that wall as urgently as a 4/3 one.
 */

const cards = {
  ...CARDS,
  WALL: card({ id: 'WALL', type: 'unit', arena: 'ground', cost: 3, power: 4, hp: 3, keywords: [{ name: 'Sentinel' }] }),
  QUIET: card({ id: 'QUIET', type: 'unit', arena: 'ground', cost: 3, power: 0, hp: 3, keywords: [{ name: 'Sentinel' }] }),
  GRUNT: card({ id: 'GRUNT', type: 'unit', arena: 'ground', cost: 2, power: 4, hp: 4 }),
}

const shieldedWall = (id: string, cardId: string) =>
  unit(id, cardId, { upgrades: [{ cardId: TOKEN_SHIELD, owner: 'opponent' }] })

/** Our ground attacker is shut out by a shielded enemy Sentinel; `ourDamage` sets how close we are
 *  to losing, which is what decides how many rounds the lockout still has to run. */
function locked(blocker: string, ourDamage: number): GameState {
  return state({
    cards,
    players: {
      player: player({ base: { cardId: 'TST_B', damage: ourDamage }, units: [unit('u1', 'GRUNT')] }),
      opponent: player({ units: [shieldedWall('w', blocker)] }),
    },
  })
}

describe('the lockout swing', () => {
  /** The gate survives: an answerable blocker is still priced at nothing. */
  it('is zero when the blocker can simply be killed', () => {
    const open = state({
      cards,
      players: {
        player: player({ units: [unit('u1', 'GRUNT')] }),
        opponent: player({ units: [unit('w', 'WALL')] }),
      },
    })
    expect(lockoutSwing(open, 'player')).toBe(0)
  })

  it('is zero when no lane is shut at all', () => {
    const clear = state({
      cards,
      players: {
        player: player({ units: [unit('u1', 'GRUNT')] }),
        opponent: player({ units: [] }),
      },
    })
    expect(lockoutSwing(clear, 'player')).toBe(0)
  })

  /**
   * **No clock multiplier, and that was measured rather than assumed.** Scaling by the rounds the game
   * has left is the obvious refinement and it was built: it never discriminates, because every live
   * reading lands above the cap on the filed report and across a 1,160-decision corpus alike. All it
   * did was rescale by about 4x, which the weight already does.
   *
   * Pinned so the idea is not rediscovered and rebuilt. If the cap ever drops far enough for the
   * ceiling to stop binding, this is the assumption to revisit.
   */
  it('does not vary with how long the game has left to run', () => {
    expect(lockoutSwing(locked('WALL', 0), 'player')).toBe(lockoutSwing(locked('WALL', 26), 'player'))
  })

  /**
   * **A wall that threatens nothing is less urgent than one that hits for 4**, even though both deny
   * the same reach. This is #503's 0/3 Sentinel, where the bot delayed and was right to.
   */
  it('counts what the blocker deals, not only what it denies', () => {
    const dangerous = lockoutSwing(locked('WALL', 10), 'player')
    const harmless = lockoutSwing(locked('QUIET', 10), 'player')
    expect(dangerous).toBeGreaterThan(harmless)
    // Denial alone cannot tell them apart, which is exactly the gap being closed.
    expect(blockedReach(locked('WALL', 10), 'player')).toBe(blockedReach(locked('QUIET', 10), 'player'))
  })

  /**
   * **Strictly larger than denial alone**, which is the only structural claim this quantity makes over
   * the version that was rejected.
   *
   * Whether it is large *enough* is a question about the weight and about real boards, not about a
   * synthetic one: refusing the strip is materially correct and costs a steady 11 to 12 points in the
   * filed game, so the magnitude is gated there, in `aiShieldedSentinelReport.test.ts`.
   */
  it('exceeds denial alone whenever the blocker threatens anything', () => {
    const s = locked('WALL', 4)
    expect(lockoutSwing(s, 'player')).toBeGreaterThan(blockedReach(s, 'player'))
    // A blocker that threatens nothing adds nothing, so the two agree.
    const q = locked('QUIET', 4)
    expect(lockoutSwing(q, 'player')).toBe(blockedReach(q, 'player'))
  })
})
