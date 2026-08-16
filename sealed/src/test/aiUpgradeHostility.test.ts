import { describe, it, expect } from 'vitest'
import { upgradeHostility } from '../ai/upgradeValue'
import { BEAM_REPLY_LIMITS, BEAM_REPLY_UPGRADE_BLIND_LIMITS } from '../ai/greedyAi'
import { aiNames } from '../ai/registry'
import { buildCardDb } from '../engine/cardDb'
import ashSet from './fixtures/ashSet.json'
import { state, player, unit } from './helpers/engineFixtures'
import type { SwuCard } from '../data/cards'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * Which upgrades belong on the OPPONENT's units (#509).
 *
 * The whole class does nothing to the board when played, so the evaluation cannot tell a friendly
 * target from an enemy one. Asserted per card against the real ASH data rather than a fixture, because
 * the point is that the rule reads the pool correctly, and a hand-built card would only prove it reads
 * my own hand-built card correctly.
 *
 * Every CONDITION upgrade in ASH is covered, in both directions, so a change to either signal has to
 * face all five at once.
 */

const cards = buildCardDb(ashSet as SwuCard[])

/** A plain ground unit with real card data, so stats and keywords resolve as they do in a game. */
const board = (): GameState => state({
  cards,
  players: {
    player: player({ units: [unit('a', 'ASH_117')] }),
    opponent: player({ units: [unit('e', 'ASH_117')] }),
  },
})

const hostility = (cardId: string): number => {
  const s = board()
  return upgradeHostility(s, s.players.player.units[0], cardId)
}

describe('upgrade hostility', () => {
  /** Without this the table below could be passing on a card database that failed to load. */
  it('is reading the real card pool', () => {
    expect(cards.ASH_054?.name).toBe('Pointless to Resist')
    expect(cards.ASH_198?.name).toBe('Nowhere to Hide')
  })

  /** Read through the mechanism: -3 power while attacking a base, invisible in the empty context the
   *  board term uses, visible in the attacking-base context this scores. */
  it('reads a conditional stat penalty as hostile', () => {
    expect(hostility('ASH_054')).toBeGreaterThan(0)
  })

  /** Doubled incoming damage, via `damageMultiplier` rather than any stat change. */
  it('reads doubled incoming damage as hostile', () => {
    expect(hostility('ASH_150')).toBeGreaterThan(0)
  })

  /**
   * **The two that only the fallback catches.** Both work through a granted triggered ability, which
   * cannot be priced without simulating it, and both are CONDITIONs.
   */
  it('reads a hostile granted trigger as hostile', () => {
    expect(hostility('ASH_085'), 'Grav Charge burns its host when its attack ends').toBeGreaterThan(0)
    expect(hostility('ASH_088'), 'The Conflict Within taxes its host on every ready').toBeGreaterThan(0)
  })

  /**
   * **The counterexample that stops the trait being used on its own.** Nowhere to Hide is a CONDITION,
   * so a rule keyed to the trait would hand it to the opponent; it grants Sentinel, which is a benefit,
   * and the computed delta catches it before the fallback is consulted.
   */
  /**
   * **Nowhere to Hide is a debuff, and a keyword grant must not disguise it.**
   *
   * It grants Sentinel and takes 2 power, and it is a card you give the opponent. An earlier version
   * counted each gained keyword against the stat loss and read it as a BUFF, which is the opposite of
   * how it plays. Keywords now rule out the CONDITION fallback but never offset a loss.
   */
  it('reads a keyword-granting CONDITION with a stat penalty as hostile', () => {
    expect(hostility('ASH_198')).toBeGreaterThan(0)
  })

  /**
   * And it is worth MORE against a unit that already has Sentinel, where the grant buys nothing and the
   * -2 is all that is left. Measured against the specific host, which is what makes that fall out
   * rather than needing a special case.
   */
  it('is more hostile against a host that gains nothing from it', () => {
    const s = board()
    const plain = s.players.player.units[0]
    const sentinel = { ...plain, grantedKeywords: [{ name: 'Sentinel' }] }
    expect(upgradeHostility(s, sentinel, 'ASH_198')).toBeGreaterThanOrEqual(upgradeHostility(s, plain, 'ASH_198'))
  })

  /** The floor at zero power is real and belongs in the number: a -2 modifier on a 1-power unit costs
   *  1, because a unit cannot deal negative damage. */
  it('prices a debuff against the host it would land on', () => {
    const s = board()
    const small = s.players.player.units[0]
    const big = { ...small, cardId: 'ASH_110' }
    expect(upgradeHostility(s, big, 'ASH_198')).toBeGreaterThanOrEqual(upgradeHostility(s, small, 'ASH_198'))
  })

  /**
   * The control arm must be a different bot from the shipped one.
   *
   * Asserted because the first screen of this change compared `beam-reply` with `beam-reply/pass=8`,
   * which now resolve to the same bot since the charge ships at 8. Every shard read an identical
   * result and `sd 0.00`, which looks like a clean null and is really a bot measured against itself.
   */
  it('has a control arm that is genuinely a different bot', () => {
    expect(aiNames()).toContain('beam-reply-upgrade-blind')
    expect(BEAM_REPLY_LIMITS.upgradeTie).toBe(true)
    expect(BEAM_REPLY_UPGRADE_BLIND_LIMITS.upgradeTie).toBe(false)
  })

  /** And ordinary upgrades are not hostile, or the rule would start giving away good cards. */
  it('leaves ordinary upgrades alone', () => {
    for (const id of ['ASH_086', 'ASH_181', 'ASH_134', 'ASH_229']) {
      expect(hostility(id), `${cards[id]?.name ?? id} must not read as hostile`).toBeLessThanOrEqual(0)
    }
  })
})
