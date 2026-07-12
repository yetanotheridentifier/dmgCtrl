import { describe, it, expect, afterEach } from 'vitest'
import { registerCard, unregisterAbility, runUnitTrigger } from '../engine/abilities'
import { giveToken, drawCards, exhaustUnit } from '../engine/effects'
import { resolve } from '../engine/resolve'
import { state, player, unit, card, CARDS } from './helpers/engineFixtures'
import { TOKEN_ADVANTAGE } from '../engine/tokenUpgrades'

afterEach(() => {
  unregisterAbility('TST_GRANT')
  unregisterAbility('TST_UNIT_TRIG')
})

const hasToken = (u: { upgrades: { cardId: string }[] }, id: string) => u.upgrades.some(a => a.cardId === id)

describe('effect primitives (#340)', () => {
  it('giveToken attaches a token upgrade to a unit', () => {
    const s = state({ players: { player: player({ units: [unit('u1', 'TST_U1')] }), opponent: player() } })
    const next = giveToken(s, 'player', 'u1', TOKEN_ADVANTAGE)
    expect(hasToken(next.players.player.units[0], TOKEN_ADVANTAGE)).toBe(true)
  })

  it('exhaustUnit exhausts a ready unit', () => {
    const s = state({ players: { player: player({ units: [unit('u1', 'TST_U1')] }), opponent: player() } })
    expect(exhaustUnit(s, 'player', 'u1').players.player.units[0].exhausted).toBe(true)
  })

  it('drawCards moves cards from deck to hand', () => {
    const s = state({ players: { player: player({ deck: ['A', 'B', 'C'], hand: [] }), opponent: player() } })
    const next = drawCards(s, 'player', 2)
    expect(next.players.player.hand).toEqual(['A', 'B'])
    expect(next.players.player.deck).toEqual(['C'])
  })
})

describe('granted-ability dispatch (#340)', () => {
  it('runUnitTrigger fires the unit card AND its upgrades for the trigger point', () => {
    registerCard('TST_UNIT_TRIG', { abilities: [{ trigger: 'onAttackEnd', description: 'unit', effect: s => s }] })
    registerCard('TST_GRANT', { abilities: [{ trigger: 'onAttackEnd', description: 'upgrade', effect: (s, ctx) => giveToken(s, ctx.owner, ctx.sourceInstanceId!, TOKEN_ADVANTAGE) }] })
    const s = state({
      cards: { ...CARDS, TST_UNIT_TRIG: card({ id: 'TST_UNIT_TRIG', type: 'unit' }), TST_GRANT: card({ id: 'TST_GRANT', type: 'upgrade' }) },
      players: { player: player({ units: [unit('u1', 'TST_UNIT_TRIG', { upgrades: [{ cardId: 'TST_GRANT', owner: 'player' }] })] }), opponent: player() },
    })
    const next = runUnitTrigger(s, 'onAttackEnd', s.players.player.units[0], 'player')
    expect(hasToken(next.players.player.units[0], TOKEN_ADVANTAGE)).toBe(true) // the upgrade's ability fired on the unit
  })
})

describe('onAttackEnd wiring in the resolver (#340)', () => {
  it("an upgrade's onAttackEnd ability fires when the attached unit attacks", () => {
    // A "Bokken-like" upgrade: When Attack Ends, give this unit an Advantage token.
    registerCard('TST_GRANT', {
      abilities: [{ trigger: 'onAttackEnd', description: 'Give an Advantage token', effect: (s, ctx) => giveToken(s, ctx.owner, ctx.sourceInstanceId!, TOKEN_ADVANTAGE) }],
    })
    const s = state({
      cards: { ...CARDS, TST_GRANT: card({ id: 'TST_GRANT', type: 'upgrade', power: 0, hp: 0 }) },
      players: {
        player: player({ units: [unit('u1', 'TST_U1', { upgrades: [{ cardId: 'TST_GRANT', owner: 'player' }] })] }),
        opponent: player(),
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'u1', target: { kind: 'base' } })
    expect(hasToken(next.players.player.units.find(u => u.instanceId === 'u1')!, TOKEN_ADVANTAGE)).toBe(true)
  })
})
