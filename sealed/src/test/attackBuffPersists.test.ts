import { describe, it, expect } from 'vitest'
import { loadReport, replayUpTo } from './helpers/replayReport'
import { resolve } from '../engine/resolve'
import { effectivePower } from '../engine/stats'
import type { GameState } from '../engine/types'

/**
 * The report filed as #540, which turned out to hold two separate things.
 *
 * The reporter attacked base with a Mandalorian Scout (3 power, one Advantage token) and took Mando's
 * N-1 Starfighter's On Attack, lent to the Scout by Support: exhaust your leader for +2/+0. They
 * expected 6 damage and read 5 on the board a moment later.
 *
 * The 6 was dealt correctly. The point came back because the opponent's next attack healed it, and
 * the +2 the N-1 grants "for this attack" outlived the attack. Both are pinned here.
 *
 * The reported move list stops replaying at the N-1 entering play, because playing it now triggers two
 * of the player's abilities (its own Support and Greef Karga's leader trigger) and the batch is ordered
 * before either resolves, a question the reporter was never asked. The tail is driven by hand from
 * there; the line taken is the one they took.
 */
const N1_PLAYED = 16

const report = loadReport('attackBuffPersists')
const choice = (s: GameState, kind: string) => (s.pendingChoices ?? []).find(c => c.kind === kind)
const scout = (s: GameState) => s.players.player.units.find(u => u.instanceId === 'u2')!

/** Play out the reported attack: Support first, the Scout swings at base, take the N-1's +2. */
function attacked(): GameState {
  const order = replayUpTo(report, N1_PLAYED)
  const ask = choice(order, 'chooseNextTrigger')!
  const candidates = (ask as { candidates: { cardId: string }[] }).candidates
  const supportFirst = resolve(order, { type: 'acceptChoice', choiceId: ask.id, optionIndex: candidates.findIndex(c => c.cardId === 'KEYWORD_SUPPORT') })
  const swung = resolve(supportFirst, { type: 'attack', attackerId: 'u2', target: { kind: 'base' }, choiceId: 'u4' })
  return resolve(swung, { type: 'acceptChoice', choiceId: choice(swung, 'mayExhaustLeaderBuffSelf')!.id })
}

describe('#540: the Mandalorian Scout attack', () => {
  it('deals the full 6, and the Advantage token is spent on completing the attack', () => {
    const after = attacked()
    expect(after.players.opponent.base.damage).toBe(6) // 3 printed + 1 Advantage + 2 from the N-1
    expect(scout(after).upgrades).toEqual([])
  })

  it('does not leave the N-1\'s "for this attack" +2 on the Scout', () => {
    const after = attacked()
    expect(after.lastingEffects ?? []).toEqual([])
    expect(effectivePower(after, scout(after))).toBe(3)
  })

  /**
   * Why the board read 5. Womp Rat attacked having answered Remnant Interceptor's Support choice,
   * which lends it Restore 1 — heal 1 damage from your own base. Correct behaviour, and invisible to
   * the player, which is what #548 is for. Read against the matched control: the same attack with the
   * Support declined leaves the base on 6, so the single point is Restore and nothing else.
   */
  it('the opponent heals one back via Support-lent Restore, not a damage error', () => {
    // The opponent plays Remnant Interceptor, whose Support is their only trigger on that play.
    const interceptor = resolve(attacked(), { type: 'playUnit', handIndex: 0 })
    const swing = { type: 'attack' as const, attackerId: 'u1', target: { kind: 'base' as const } }
    const asPlayed = resolve(interceptor, { ...swing, choiceId: choice(interceptor, 'support')!.id })
    const declined = resolve(interceptor, { type: 'skipTrigger', choiceId: choice(interceptor, 'support')!.id })
    expect(asPlayed.players.opponent.base.damage).toBe(5)
    expect(resolve(declined, swing).players.opponent.base.damage).toBe(6)
  })

  /** And the Scout is still at printed power once the phase has run on past its attack. */
  it('still holds two moves later, while the phase runs on', () => {
    const interceptor = resolve(attacked(), { type: 'playUnit', handIndex: 0 })
    const later = resolve(interceptor, { type: 'attack', attackerId: 'u1', target: { kind: 'base' }, choiceId: choice(interceptor, 'support')!.id })
    expect(effectivePower(later, scout(later))).toBe(3)
  })
})
