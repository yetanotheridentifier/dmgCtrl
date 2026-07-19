import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { registerCard } from '../engine/abilities'
import { pushChoice } from '../engine/types'
import { state, player, unit, card, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'

/**
 * Group E spike (#356): a `whenDefeated` ability that raises a *choice* must work when the unit is
 * defeated *in combat* — both when it's the attacker's unit (the choice stays with the active player)
 * and when it's the defender's (control must be handed to the defender, then the turn resumes). This
 * is the linchpin the whole group depends on.
 */
const WD = 'WD_TEST'
registerCard(WD, {
  abilities: [{
    trigger: 'whenDefeated',
    description: 'You may deal 2 damage to a unit.',
    effect: (s, ctx) => {
      const targets = [...s.players.player.units, ...s.players.opponent.units].map(u => u.instanceId)
      return targets.length
        ? pushChoice(s, { kind: 'mayDamage', id: ctx.defeatedUnit!.instanceId, controller: ctx.owner, unitId: ctx.defeatedUnit!.instanceId, targets, amount: 2, optional: true })
        : s
    },
  }],
})

const CARDSET = {
  ...CARDS,
  WD_TEST: card({ id: WD, type: 'unit', arena: 'ground', power: 2, hp: 1 }), // fragile → dies in combat
  BRUISER: card({ id: 'BRUISER', type: 'unit', arena: 'ground', power: 5, hp: 6 }),
}
const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)

describe('whenDefeated raising a choice, mid-combat (#356 spike)', () => {
  it("the attacker's own unit: the choice stays with the active player", () => {
    // Player's WD (2/1) attacks a BRUISER (5/6); the counter (5) defeats WD.
    const s = state({
      cards: CARDSET,
      players: {
        player: player({ units: [unit('wd', WD)] }),
        opponent: player({ units: [unit('bruiser', 'BRUISER')] }),
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'wd', target: { kind: 'unit', instanceId: 'bruiser' } })
    expect(U(next, 'wd')).toBeUndefined() // WD defeated by the counter
    expect(next.pendingChoices?.[0]).toMatchObject({ kind: 'mayDamage', controller: 'player' })
    expect(next.activePlayer).toBe('player') // attacker resolves their own trigger
    const done = resolve(next, { type: 'acceptChoice', choiceId: next.pendingChoices![0].id, targetInstanceId: 'bruiser' })
    expect(U(done, 'bruiser')!.damage).toBe(2 + 2) // 2 combat + 2 from the trigger
    expect(done.activePlayer).toBe('opponent') // turn passes after resolving
  })

  it("the defender's unit: control is handed to the defender, then the turn resumes", () => {
    // Player's BRUISER (5/6) attacks the opponent's WD (2/1); the attack defeats WD.
    const s = state({
      cards: CARDSET,
      players: {
        player: player({ units: [unit('bruiser', 'BRUISER')] }),
        opponent: player({ units: [unit('wd', WD)] }),
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'bruiser', target: { kind: 'unit', instanceId: 'wd' } })
    expect(U(next, 'wd')).toBeUndefined() // WD defeated by combat
    expect(next.pendingChoices?.[0]).toMatchObject({ kind: 'mayDamage', controller: 'opponent' })
    expect(next.activePlayer).toBe('opponent') // ← the defender must get to resolve their trigger
    const done = resolve(next, { type: 'acceptChoice', choiceId: next.pendingChoices![0].id, targetInstanceId: 'bruiser' })
    expect(U(done, 'bruiser')!.damage).toBe(2 + 2) // 2 combat counter + 2 from the trigger
    expect(done.activePlayer).toBe('opponent') // control returns to the attacker, whose attack turn then ends
  })
})
