import { describe, it, expect } from 'vitest'
import { blockedReach } from '../ai/race'
import { state, player, card, unit, CARDS } from './helpers/engineFixtures'
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import '../engine/cardDefinitions'

/**
 * Gating denied reach to blockers the evaluation **cannot otherwise see** (#499).
 *
 * The ungated term priced reach denied by *any* Sentinel, and measured **25.0%** against the shipped
 * bot at weight 12 (50.0% self-play control). The diagnostic said why: it was live on **24.2%** of
 * decisions while the lockout it was written for is **2.1%**, so 92% of its firings were a board-wide
 * bias against Sentinels rather than the narrow case it was designed for. At a mean quantity of 6.6
 * and weight 12 that is ~79 points on a board where a whole unit is worth 4.
 *
 * The gate follows from *why* the term was needed. A plain Sentinel can simply be killed, and damaging
 * it lowers its HP, which the material terms already price: the bot needs no help there. A **shielded**
 * Sentinel is the blind spot, because a Shield absorbs a whole instance of damage through a prevention
 * hook, so a strip leaves a board scoring identically and the lane stays shut for the rest of the game.
 *
 * So the quantity counts reach denied only by blockers that are all shielded.
 */

const cards = {
  ...CARDS,
  WALL: card({ id: 'WALL', type: 'unit', arena: 'ground', cost: 3, power: 3, hp: 5, keywords: [{ name: 'Sentinel' }] }),
  ATTACKER: card({ id: 'ATTACKER', type: 'unit', arena: 'ground', cost: 5, power: 5, hp: 6 }),
}

/** One attacker held off by a Sentinel, which may or may not carry a Shield. */
const board = (shielded: boolean) => state({
  cards,
  players: {
    player: player({ units: [unit('atk', 'ATTACKER')] }),
    opponent: player({
      units: [unit('wall', 'WALL', shielded ? { upgrades: [{ cardId: TOKEN_SHIELD, owner: 'opponent' }] } : {})],
    }),
  },
})

describe('denied reach counts only blockers the evaluation cannot see', () => {
  /**
   * The case the term exists for. A Shield works through a prevention hook, so stripping it leaves the
   * same units at the same HP and the board scores identically: nothing else in the model can price it.
   */
  it('prices reach denied by a shielded Sentinel', () => {
    expect(blockedReach(board(true), 'player')).toBeGreaterThan(0)
  })

  /**
   * **The gate, and the whole fix.** An unshielded Sentinel is answerable: attacking it lowers its HP
   * and the material terms see that, so the bot needs no extra encouragement. Pricing it anyway is
   * what put the term on a quarter of all decisions.
   */
  it('prices nothing for a Sentinel that can simply be killed', () => {
    expect(blockedReach(board(false), 'player')).toBe(0)
  })

  /** No Sentinel at all is not a blocked lane, gated or otherwise. */
  it('prices nothing when the lane is open', () => {
    const open = state({
      cards,
      players: {
        player: player({ units: [unit('atk', 'ATTACKER')] }),
        opponent: player({ units: [] }),
      },
    })
    expect(blockedReach(open, 'player')).toBe(0)
  })

  /**
   * A shielded NON-Sentinel does not shut anything: our attackers can go around it to the base, so
   * there is no denied reach to price. Without this the gate would read "a shield is present", which
   * is a different and much commoner condition than "a lane is shut".
   */
  it('prices nothing for a shielded unit that is not blocking', () => {
    const bystander = {
      ...cards,
      BODY: card({ id: 'BODY', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 3 }),
    }
    const s = state({
      cards: bystander,
      players: {
        player: player({ units: [unit('atk', 'ATTACKER')] }),
        opponent: player({
          units: [unit('body', 'BODY', { upgrades: [{ cardId: TOKEN_SHIELD, owner: 'opponent' }] })],
        }),
      },
    })
    expect(blockedReach(s, 'player')).toBe(0)
  })
})
