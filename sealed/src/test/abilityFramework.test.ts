import { describe, it, expect, afterEach } from 'vitest'
import { registerCard, unregisterAbility, runUnitTrigger } from '../engine/abilities'
import { giveToken, drawCards, exhaustUnit } from '../engine/effects'
import { effectiveCost, legalMoves } from '../engine/legalMoves'
import { unitHasKeyword } from '../engine/keywords'
import { resolve } from '../engine/resolve'
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import { TOKEN_ADVANTAGE } from '../engine/tokenUpgrades'

afterEach(() => {
  for (const id of ['TST_GRANT', 'TST_UNIT_TRIG', 'TST_COSTMOD', 'TST_DMGONLY', 'TST_CONDKW', 'TST_REGROUP']) {
    unregisterAbility(id)
  }
})

const hasToken = (u: { upgrades: { cardId: string }[] }, id: string) => u.upgrades.some(a => a.cardId === id)

describe('effect primitives (#340)', () => {
  it('giveToken attaches a token upgrade to a unit', () => {
    const s = state({ players: { player: player({ units: [unit('u1', 'TST_U1')] }), opponent: player() } })
    const next = giveToken(s, 'u1', TOKEN_ADVANTAGE)
    expect(hasToken(next.players.player.units[0], TOKEN_ADVANTAGE)).toBe(true)
  })

  it('exhaustUnit exhausts a ready unit', () => {
    const s = state({ players: { player: player({ units: [unit('u1', 'TST_U1')] }), opponent: player() } })
    expect(exhaustUnit(s, 'u1').players.player.units[0].exhausted).toBe(true)
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
    registerCard('TST_GRANT', { abilities: [{ trigger: 'onAttackEnd', description: 'upgrade', effect: (s, ctx) => giveToken(s, ctx.sourceInstanceId!, TOKEN_ADVANTAGE) }] })
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
      abilities: [{ trigger: 'onAttackEnd', description: 'Give an Advantage token', effect: (s, ctx) => giveToken(s, ctx.sourceInstanceId!, TOKEN_ADVANTAGE) }],
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

describe('static hooks (#340)', () => {
  it('costModifier adjusts an upgrade cost for matching targets', () => {
    registerCard('TST_COSTMOD', { costModifier: (s, _pid, target) => (target && s.cards[target.cardId]?.traits.includes('IMPERIAL') ? -1 : 0) })
    const s = state({
      cards: {
        ...CARDS,
        TST_COSTMOD: card({ id: 'TST_COSTMOD', type: 'upgrade', cost: 2 }),
        TST_IMP: card({ id: 'TST_IMP', type: 'unit', arena: 'ground', traits: ['IMPERIAL'] }),
      },
      players: { player: player({ units: [unit('u1', 'TST_IMP')] }), opponent: player() },
    })
    const imp = s.players.player.units[0]
    expect(effectiveCost(s, 'player', s.cards['TST_COSTMOD'], imp)).toBe(1) // 2 − 1 on Imperial
    expect(effectiveCost(s, 'player', s.cards['TST_COSTMOD'], undefined)).toBe(2) // no target
  })

  it('attachRestriction limits which units an upgrade may attach to', () => {
    registerCard('TST_DMGONLY', { attachRestriction: (_s, target) => target.damage > 0 })
    const s = state({
      cards: { ...CARDS, TST_DMGONLY: card({ id: 'TST_DMGONLY', type: 'upgrade', cost: 0 }) },
      players: {
        player: player({ hand: ['TST_DMGONLY'], resources: ready(2), units: [unit('u1', 'TST_U1', { damage: 1 }), unit('u2', 'TST_U1')] }),
        opponent: player(),
      },
    })
    const targets = legalMoves(s).filter(a => a.type === 'playUpgrade').map(a => a.targetInstanceId)
    expect(targets).toEqual(['u1']) // only the damaged unit
  })

  it('conditionalKeywords grants a keyword to the unit under a condition', () => {
    registerCard('TST_CONDKW', { conditionalKeywords: (s, u) => (s.cards[u.cardId]?.name === 'Luke' ? [{ name: 'Sentinel' }] : []) })
    const s = state({
      cards: {
        ...CARDS,
        TST_CONDKW: card({ id: 'TST_CONDKW', type: 'upgrade' }),
        TST_LUKE: card({ id: 'TST_LUKE', name: 'Luke', type: 'unit' }),
        TST_OTHER: card({ id: 'TST_OTHER', name: 'Other', type: 'unit' }),
      },
    })
    expect(unitHasKeyword(s, unit('u1', 'TST_LUKE', { upgrades: [{ cardId: 'TST_CONDKW', owner: 'player' }] }), 'Sentinel')).toBe(true)
    expect(unitHasKeyword(s, unit('u2', 'TST_OTHER', { upgrades: [{ cardId: 'TST_CONDKW', owner: 'player' }] }), 'Sentinel')).toBe(false)
  })

  it('whenRegroupStarts fires for units at the start of the regroup phase', () => {
    registerCard('TST_REGROUP', { abilities: [{ trigger: 'whenRegroupStarts', description: 'advantage', effect: (s, ctx) => giveToken(s, ctx.sourceInstanceId!, TOKEN_ADVANTAGE) }] })
    const s = state({
      cards: { ...CARDS, TST_REGROUP: card({ id: 'TST_REGROUP', type: 'unit' }) },
      consecutivePasses: 1,
      players: { player: player({ units: [unit('u1', 'TST_REGROUP')] }), opponent: player() },
    })
    const next = resolve(s, { type: 'pass' }) // second consecutive pass → regroup
    expect(next.phase).toBe('regroup')
    expect(hasToken(next.players.player.units[0], TOKEN_ADVANTAGE)).toBe(true)
  })
})
