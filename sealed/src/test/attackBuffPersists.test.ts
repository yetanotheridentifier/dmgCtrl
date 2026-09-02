import { describe, it, expect } from 'vitest'
import { loadReport, replayUpTo } from './helpers/replayReport'
import { resolve } from '../engine/resolve'
import { effectivePower } from '../engine/stats'

/**
 * The report filed as #540, which turned out to hold two separate things.
 *
 * The reporter attacked base with a Mandalorian Scout (3 power, one Advantage token) and took Mando's
 * N-1 Starfighter's On Attack, lent to the Scout by Support: exhaust your leader for +2/+0. They
 * expected 6 damage and read 5 on the board a moment later.
 *
 * The 6 was dealt correctly. The point came back because the opponent's next attack healed it, and
 * the +2 the N-1 grants "for this attack" outlived the attack. Both are pinned here.
 */
describe('#540: the Mandalorian Scout attack', () => {
  const report = loadReport('attackBuffPersists')
  const scout = (s: ReturnType<typeof replayUpTo>) => s.players.player.units.find(u => u.instanceId === 'u2')!

  // Move 19 is the last of the attack: the Scout's attack resolves as the trailing trigger is declined.
  const AFTER_ATTACK = 19

  it('deals the full 6, and the Advantage token is spent on completing the attack', () => {
    const after = replayUpTo(report, AFTER_ATTACK)
    expect(after.players.opponent.base.damage).toBe(6) // 3 printed + 1 Advantage + 2 from the N-1
    expect(scout(after).upgrades).toEqual([])
  })

  it('does not leave the N-1\'s "for this attack" +2 on the Scout', () => {
    const after = replayUpTo(report, AFTER_ATTACK)
    expect(after.lastingEffects ?? []).toEqual([])
    expect(effectivePower(after, scout(after))).toBe(3)
  })

  it('still holds two moves later, while the phase runs on', () => {
    const later = replayUpTo(report, report.moves.length)
    expect(effectivePower(later, scout(later))).toBe(3)
  })

  /**
   * Why the board read 5. Womp Rat attacked having answered Remnant Interceptor's Support choice,
   * which lends it Restore 1 — heal 1 damage from your own base. Correct behaviour, and invisible to
   * the player, which is what #548 is for. Read against the matched control: the same attack with the
   * Support declined leaves the base on 6, so the single point is Restore and nothing else.
   */
  it('the opponent heals one back via Support-lent Restore, not a damage error', () => {
    const before = replayUpTo(report, 20)
    const asPlayed = resolve(before, { type: 'attack', attackerId: 'u1', target: { kind: 'base' }, choiceId: 'u5' })
    const supportDeclined = resolve(
      resolve(before, { type: 'skipTrigger', choiceId: 'u5' }),
      { type: 'attack', attackerId: 'u1', target: { kind: 'base' } },
    )
    expect(asPlayed.players.opponent.base.damage).toBe(5)
    expect(supportDeclined.players.opponent.base.damage).toBe(6)
  })
})
