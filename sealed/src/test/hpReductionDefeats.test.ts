import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { dealDamageToUnit } from '../engine/combat'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit, card, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'

/**
 * HP-reduction defeats (#357). Lowering a unit's HP can defeat it with no damage dealt — handled two
 * ways, because the two cards reduce HP through different mechanisms:
 *  - Morgan Elsbeth's −2/−2 is a *lasting* effect, so a resting-state sweep (`sweepStateBasedDefeats`,
 *    run after every action) catches it.
 *  - Scion Shuttle's −1/−1 is a *combat-only* aura that exists only during the damage calculation, so
 *    the combat defeat check has to see it via the stat context.
 */
const F = {
  ...CARDS,
  ASH_050: card({ id: 'ASH_050', type: 'unit', arena: 'ground', power: 5, hp: 6, keywords: [{ name: 'Support' }] }), // Morgan Elsbeth
  ASH_046: card({ id: 'ASH_046', type: 'unit', arena: 'space', power: 1, hp: 3, keywords: [{ name: 'Support' }] }), // Scion Shuttle
  TOUGH: card({ id: 'TOUGH', type: 'unit', arena: 'ground', power: 2, hp: 5 }),
  ONE_HP_SPACE: card({ id: 'ONE_HP_SPACE', type: 'unit', arena: 'space', power: 2, hp: 1 }),
  TWO_HP_SPACE: card({ id: 'TWO_HP_SPACE', type: 'unit', arena: 'space', power: 0, hp: 2 }),
}
const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)

describe('Morgan Elsbeth (050) — −2/−2 can defeat via the state-based sweep (#357)', () => {
  /** Morgan dies, raising her "may give a unit −2/−2" choice. */
  const morganDies = (targetDamage: number) => {
    const s = state({
      cards: F,
      players: {
        player: player({ units: [unit('m', 'ASH_050', { arena: 'ground', damage: 5 })] }),
        opponent: player({ units: [unit('t', 'TOUGH', { arena: 'ground', damage: targetDamage })] }),
      },
    })
    return dealDamageToUnit(s, 'm', 1) // Morgan (6 hp, 5 damage) dies → whenDefeated
  }

  it('defeats a unit whose damage already meets its reduced HP', () => {
    const raised = morganDies(3) // TOUGH: 5 hp, 3 damage → survives normally
    expect(raised.pendingChoices?.[0]).toMatchObject({ kind: 'mayLastingBuff', power: -2, hp: -2 })
    const done = resolve(raised, { type: 'acceptChoice', choiceId: raised.pendingChoices![0].id, targetInstanceId: 't' })
    expect(U(done, 't')).toBeUndefined() // HP 5→3, damage 3 ⇒ defeated by the sweep
    expect(done.players.opponent.discard).toContain('TOUGH')
  })

  it('leaves a unit alive when the reduced HP still exceeds its damage', () => {
    const raised = morganDies(1) // TOUGH: 5 hp, 1 damage
    const done = resolve(raised, { type: 'acceptChoice', choiceId: raised.pendingChoices![0].id, targetInstanceId: 't' })
    expect(U(done, 't')).toBeDefined() // HP 5→3, damage 1 ⇒ survives
    expect(U(done, 't')!.damage).toBe(1)
  })

  it('declining the debuff leaves the unit untouched', () => {
    const raised = morganDies(3)
    const done = resolve(raised, { type: 'skipTrigger', choiceId: raised.pendingChoices![0].id })
    expect(U(done, 't')).toBeDefined()
  })
})

describe('Scion Shuttle (046) — −1/−1 on the defender applies during combat (#357)', () => {
  const attackWith = (defenderCard: string) => {
    const s = state({
      cards: F,
      players: {
        player: player({ units: [unit('sc', 'ASH_046', { arena: 'space' })] }),
        opponent: player({ units: [unit('d', defenderCard, { arena: 'space' })] }),
      },
    })
    return resolve(s, { type: 'attack', attackerId: 'sc', target: { kind: 'unit', instanceId: 'd' } })
  }

  it("reduces the defender's counter-attack power", () => {
    // ONE_HP_SPACE has power 2; while defending Scion it counters for 1.
    const done = attackWith('ONE_HP_SPACE')
    expect(U(done, 'sc')!.damage).toBe(1) // 2 - 1 from the aura
  })

  it("the defender's −1 HP counts in the combat defeat check", () => {
    // TWO_HP_SPACE: 2 hp, 0 power. Scion deals 1 damage — lethal only because the aura drops it to 1 hp.
    const done = attackWith('TWO_HP_SPACE')
    expect(U(done, 'd')).toBeUndefined()
  })
})
