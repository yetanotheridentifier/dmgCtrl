import { describe, it, expect, afterEach } from 'vitest'
import { resolve } from '../engine/resolve'
import { registerCard, unregisterAbility } from '../engine/abilities'
import { pushChoice } from '../engine/types'
import { state, player, unit, card, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * Nested abilities resolve before the layer that spawned them (#525).
 *
 * **CR 7.6.11** After resolving a triggered ability "A", if any new abilities were triggered while
 * resolving it, the new abilities are considered "nested abilities" and must be resolved **before any
 * other abilities triggered at the same time as ability "A"**.
 *
 * The comprehensive rules give the scenario, so it is built here rather than invented:
 *
 * > Grayson attacks Mimi's Vanguard Infantry with his Greedo. Both units are defeated, simultaneously
 * > triggering the When Defeated abilities on each. Since Grayson is the active player, he decides which
 * > player resolves first. He chooses himself, and uses Greedo's ability to defeat another of Mimi's
 * > units, Admiral Motti, which has its own When Defeated. Admiral Motti's ability is a nested ability,
 * > so it must be resolved next. **Only after** that may Mimi resolve Vanguard Infantry's ability.
 *
 * `pushChoice` appends, so the suspicion recorded on the ticket was that a nested ability lands at the
 * BACK of the queue, behind the opponent's simultaneous trigger, which is the opposite of the rule.
 * This test exists to settle that either way: passing retires the suspicion, failing scopes the fix.
 */

/** Ids are distinctive so the queue can be read by which card raised each entry. */
const GREEDO = 'TEST_GREEDO'
const VANGUARD = 'TEST_VANGUARD'
const MOTTI = 'TEST_MOTTI'

const cards = {
  ...CARDS,
  [GREEDO]: card({ id: GREEDO, type: 'unit', arena: 'ground', cost: 1, power: 3, hp: 3 }),
  [VANGUARD]: card({ id: VANGUARD, type: 'unit', arena: 'ground', cost: 1, power: 3, hp: 3 }),
  [MOTTI]: card({ id: MOTTI, type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 1 }),
}

/** Both fighters raise a `mayDamage` choice on defeat; Greedo's can reach Motti, whose own defeat
 *  raises a third. That chain is what makes the ordering observable. */
function registerAll(): void {
  const damageChoice = (s: GameState, ctx: { owner: 'player' | 'opponent'; defeatedUnit?: { instanceId: string } }): GameState => {
    const targets = [...s.players.player.units, ...s.players.opponent.units].map(u => u.instanceId)
    return targets.length === 0 ? s : pushChoice(s, {
      kind: 'mayDamage', id: ctx.defeatedUnit!.instanceId, controller: ctx.owner,
      unitId: ctx.defeatedUnit!.instanceId, targets, amount: 3, optional: true,
    })
  }
  for (const id of [GREEDO, VANGUARD, MOTTI]) {
    registerCard(id, { abilities: [{ trigger: 'whenDefeated', description: 'damage', effect: damageChoice }] })
  }
}

/** Our Greedo attacks their Vanguard; both are 3/3 so both die. Motti sits behind, defeatable by the
 *  3 damage Greedo's trigger offers. */
const board = (): GameState => state({
  cards,
  phase: 'action',
  activePlayer: 'player',
  players: {
    // `bystander` is a 1/9 that nothing here can kill. Without a survivor, every unit is dead by the
    // time Motti's trigger fires, so a "damage a unit" ability has no legal target and raises no
    // choice at all: the queue would look correct for the wrong reason.
    player: player({ units: [unit('greedo', GREEDO), unit('bystander', 'TST_U4')] }),
    opponent: player({ units: [unit('vanguard', VANGUARD), unit('motti', MOTTI)] }),
  },
})

describe('nested triggered abilities (CR 7.6.11)', () => {
  afterEach(() => {
    for (const id of [GREEDO, VANGUARD, MOTTI]) unregisterAbility(id)
  })

  it('sets up the CR scenario: both fighters die and both triggers are owed', () => {
    registerAll()
    const traded = resolve(board(), { type: 'attack', attackerId: 'greedo', target: { kind: 'unit', instanceId: 'vanguard' } })
    expect(traded.players.player.units.find(u => u.instanceId === 'greedo'), 'Greedo dies').toBeUndefined()
    expect(traded.players.opponent.units.find(u => u.instanceId === 'vanguard'), 'Vanguard dies').toBeUndefined()
    const owed = (traded.pendingChoices ?? []).map(c => c.controller)
    expect(owed, 'both sides owe a trigger').toContain('player')
    expect(owed).toContain('opponent')
  })

  /**
   * The rule itself. Resolving OUR trigger onto Motti raises Motti's own, which must come before the
   * opponent's Vanguard trigger that was waiting all along.
   */
  it('resolves a nested trigger before the opponent trigger it interrupted', () => {
    registerAll()
    const traded = resolve(board(), { type: 'attack', attackerId: 'greedo', target: { kind: 'unit', instanceId: 'vanguard' } })
    const ours = (traded.pendingChoices ?? []).find(c => c.controller === 'player')
    expect(ours, 'we should have a trigger to resolve').toBeDefined()

    const killedMotti = resolve(traded, { type: 'acceptChoice', choiceId: ours!.id, targetInstanceId: 'motti' })
    expect(killedMotti.players.opponent.units.find(u => u.instanceId === 'motti'), 'Motti dies to it').toBeUndefined()

    // Keyed on `id`, which these fixtures set to the defeated unit's instance id. `unitId` is not on
    // every choice variant, so it cannot be read off the queue generically.
    const queue = (killedMotti.pendingChoices ?? []).map(c => c.id)
    expect(queue, 'both the nested trigger and the waiting one are owed').toEqual(
      expect.arrayContaining(['motti', 'vanguard']),
    )
    expect(queue.indexOf('motti'), 'the nested ability resolves FIRST (CR 7.6.11)')
      .toBeLessThan(queue.indexOf('vanguard'))
  })
})
