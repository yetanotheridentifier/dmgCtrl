import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { effectivePower, effectiveHp } from '../engine/stats'
import { unitHasKeyword } from '../engine/keywords'
import {
  addLastingEffect,
  clearLastingEffects,
  enteredPlayThisPhase,
  defeatedThisPhase,
} from '../engine/types'
import { state, player, unit, ready } from './helpers/engineFixtures'
import '../engine/cardDefinitions'

/**
 * "This phase" lasting effects and phase/attack event tracking (#306/#347).
 * A lasting effect is a transient +X/+Y and/or keyword grant that expires at the
 * start of the regroup phase (so a unit defeated during regroup uses base stats).
 */
describe('lasting effects mechanism (#347)', () => {
  const find = (s: ReturnType<typeof state>, id: string) => s.players.player.units.find(u => u.instanceId === id)!

  it('adds +power/+hp to the targeted unit only', () => {
    const s = addLastingEffect(
      state({ players: { player: player({ units: [unit('u1', 'TST_U1'), unit('u2', 'TST_U1')] }), opponent: player() } }),
      { targetInstanceId: 'u1', power: 2, hp: 2 },
    )
    expect(effectivePower(s, find(s, 'u1'))).toBe(5) // 3 + 2
    expect(effectiveHp(s, find(s, 'u1'))).toBe(6) // 4 + 2
    expect(effectivePower(s, find(s, 'u2'))).toBe(3) // untouched
  })

  it('grants a keyword to the targeted unit', () => {
    const s = addLastingEffect(
      state({ players: { player: player({ units: [unit('u1', 'TST_U1')] }), opponent: player() } }),
      { targetInstanceId: 'u1', keywords: [{ name: 'Sentinel' }] },
    )
    expect(unitHasKeyword(s, find(s, 'u1'), 'Sentinel')).toBe(true)
  })

  it('stacks multiple effects on the same unit', () => {
    let s = state({ players: { player: player({ units: [unit('u1', 'TST_U1')] }), opponent: player() } })
    s = addLastingEffect(s, { targetInstanceId: 'u1', power: 2 })
    s = addLastingEffect(s, { targetInstanceId: 'u1', power: 2, keywords: [{ name: 'Sentinel' }] })
    expect(effectivePower(s, find(s, 'u1'))).toBe(7) // 3 + 2 + 2
    expect(unitHasKeyword(s, find(s, 'u1'), 'Sentinel')).toBe(true)
  })

  it('clearLastingEffects removes every effect', () => {
    let s = addLastingEffect(
      state({ players: { player: player({ units: [unit('u1', 'TST_U1')] }), opponent: player() } }),
      { targetInstanceId: 'u1', power: 2 },
    )
    s = clearLastingEffects(s)
    expect(effectivePower(s, find(s, 'u1'))).toBe(3)
  })

  it('defeats a unit kept alive only by a this-phase HP buff when the buff expires at regroup', () => {
    let s = state({
      players: {
        player: player({ units: [unit('u1', 'TST_U1', { damage: 4 })] }), // TST_U1 base HP 4
        opponent: player(),
      },
    })
    s = addLastingEffect(s, { targetInstanceId: 'u1', hp: 2 }) // effective HP 6 → survives at 4 damage
    expect(effectiveHp(s, s.players.player.units[0])).toBe(6)
    s = resolve(s, { type: 'pass' })
    s = resolve(s, { type: 'pass' }) // → regroup: the buff expires, u1 now has 4 damage vs 4 HP
    expect(s.players.player.units.find(u => u.instanceId === 'u1')).toBeUndefined() // defeated
    expect(s.players.player.discard).toContain('TST_U1')
  })

  it('expires at the start of the regroup phase (both players pass)', () => {
    let s = addLastingEffect(
      state({ players: { player: player({ units: [unit('u1', 'TST_U1')] }), opponent: player() } }),
      { targetInstanceId: 'u1', power: 2, hp: 2 },
    )
    expect(effectivePower(s, find(s, 'u1'))).toBe(5)
    s = resolve(s, { type: 'pass' })
    s = resolve(s, { type: 'pass' }) // both passed → regroup
    expect(s.phase).toBe('regroup')
    expect(effectivePower(s, s.players.player.units.find(u => u.instanceId === 'u1')!)).toBe(3) // buff gone
  })
})

describe('phase/attack event tracking (#347)', () => {
  it('records units that entered play this phase, per controller', () => {
    const s = state({ players: { player: player({ hand: ['TST_U1'], resources: ready(2) }), opponent: player() } })
    const played = resolve(s, { type: 'playCard', handIndex: 0 })
    const entered = enteredPlayThisPhase(played, 'player')
    expect(entered).toHaveLength(1)
    expect(played.players.player.units[0].instanceId).toBe(entered[0])
    expect(enteredPlayThisPhase(played, 'opponent')).toEqual([])
  })

  it('records the card ids of units defeated this phase, per controller', () => {
    // A 1-HP enemy unit is defeated when the attacker hits it.
    const s = state({
      players: {
        player: player({ units: [unit('a1', 'TST_U4')] }), // hp 9 → survives the counter
        opponent: player({ units: [unit('e1', 'TST_U3')] }), // hp 1 → defeated
      },
    })
    const after = resolve(s, { type: 'attack', attackerId: 'a1', target: { kind: 'unit', instanceId: 'e1' } })
    expect(defeatedThisPhase(after, 'opponent')).toContain('TST_U3')
    expect(defeatedThisPhase(after, 'player')).toEqual([])
  })

  it('resets tracked events when the phase changes', () => {
    const s = state({ players: { player: player({ hand: ['TST_U1'], resources: ready(2) }), opponent: player() } })
    let after = resolve(s, { type: 'playCard', handIndex: 0 })
    expect(enteredPlayThisPhase(after, 'player')).toHaveLength(1)
    after = resolve(after, { type: 'pass' })
    after = resolve(after, { type: 'pass' }) // → regroup
    expect(enteredPlayThisPhase(after, 'player')).toEqual([])
  })
})
