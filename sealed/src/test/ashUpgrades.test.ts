import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { effectiveCost, legalMoves } from '../engine/legalMoves'
import { unitHasKeyword } from '../engine/keywords'
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import { TOKEN_SHIELD, TOKEN_ADVANTAGE } from '../engine/tokenUpgrades'

/** Real ASH card definitions are registered on import of the engine (#341). */
const cardIds = (u: { upgrades: { cardId: string }[] }) => u.upgrades.map(a => a.cardId)
const has = (u: { upgrades: { cardId: string }[] }, id: string) => u.upgrades.some(a => a.cardId === id)

describe('ASH upgrades — cost modifiers (#341)', () => {
  it('Faith in the Empire (ASH_262) costs 1 less on an Imperial unit', () => {
    const s = state({
      cards: {
        ...CARDS,
        ASH_262: card({ id: 'ASH_262', type: 'upgrade', cost: 2 }),
        UNIT_IMP: card({ id: 'UNIT_IMP', type: 'unit', arena: 'ground', traits: ['Imperial'] }),
        UNIT_REB: card({ id: 'UNIT_REB', type: 'unit', arena: 'ground', traits: ['Rebel'] }),
      },
      players: { player: player({ units: [unit('u1', 'UNIT_IMP'), unit('u2', 'UNIT_REB')] }), opponent: player() },
    })
    expect(effectiveCost(s, 'player', s.cards['ASH_262'], s.players.player.units[0])).toBe(1)
    expect(effectiveCost(s, 'player', s.cards['ASH_262'], s.players.player.units[1])).toBe(2)
  })
})

describe('ASH upgrades — attach restrictions & conditional keywords (#341)', () => {
  it('Mark My Words (ASH_181) only attaches to a damaged unit', () => {
    const s = state({
      cards: { ...CARDS, ASH_181: card({ id: 'ASH_181', type: 'upgrade', cost: 0, keywords: [{ name: 'Overwhelm' }] }) },
      players: {
        player: player({ hand: ['ASH_181'], resources: ready(2), units: [unit('u1', 'TST_U1', { damage: 1 }), unit('u2', 'TST_U1')] }),
        opponent: player(),
      },
    })
    expect(legalMoves(s).filter(a => a.type === 'playUpgrade').map(a => a.targetInstanceId)).toEqual(['u1'])
  })

  it("Luke's Jedi Lightsaber (ASH_066) grants Sentinel only to Luke Skywalker", () => {
    const s = state({
      cards: {
        ...CARDS,
        ASH_066: card({ id: 'ASH_066', type: 'upgrade' }),
        UNIT_LUKE: card({ id: 'UNIT_LUKE', name: 'Luke Skywalker', type: 'unit', arena: 'ground' }),
        UNIT_HAN: card({ id: 'UNIT_HAN', name: 'Han Solo', type: 'unit', arena: 'ground' }),
      },
    })
    const luke = unit('u1', 'UNIT_LUKE', { upgrades: [{ cardId: 'ASH_066', owner: 'player' }] })
    const han = unit('u2', 'UNIT_HAN', { upgrades: [{ cardId: 'ASH_066', owner: 'player' }] })
    expect(unitHasKeyword(s, luke, 'Sentinel')).toBe(true)
    expect(unitHasKeyword(s, han, 'Sentinel')).toBe(false)
  })
})

describe('ASH upgrades — whenPlayed effects (#341)', () => {
  function playUpgradeState(upgradeId: string, extra: Partial<Parameters<typeof card>[0]> = {}, unitUpgrades: { cardId: string; owner: 'player' }[] = []) {
    return state({
      cards: { ...CARDS, [upgradeId]: card({ id: upgradeId, type: 'upgrade', cost: 0, ...extra }), OTHER_UP: card({ id: 'OTHER_UP', type: 'upgrade' }) },
      players: {
        player: player({ hand: [upgradeId], deck: ['X', 'Y'], resources: ready(2), units: [unit('u1', 'TST_U1', { upgrades: unitUpgrades })] }),
        opponent: player(),
      },
    })
  }

  it('Durasteel Plating (ASH_086) gives the unit a Shield token', () => {
    const next = resolve(playUpgradeState('ASH_086'), { type: 'playUpgrade', handIndex: 0, targetInstanceId: 'u1' })
    expect(has(next.players.player.units[0], TOKEN_SHIELD)).toBe(true)
  })

  it('Cybernetic Enhancements (ASH_087) draws a card', () => {
    const next = resolve(playUpgradeState('ASH_087'), { type: 'playUpgrade', handIndex: 0, targetInstanceId: 'u1' })
    expect(next.players.player.hand).toContain('X')
  })

  it('Preparation (ASH_228) exhausts the attached unit', () => {
    const next = resolve(playUpgradeState('ASH_228'), { type: 'playUpgrade', handIndex: 0, targetInstanceId: 'u1' })
    expect(next.players.player.units[0].exhausted).toBe(true)
  })

  it('Unfettered Ambition (ASH_182) gives an Advantage per non-Advantage upgrade', () => {
    // Unit already has OTHER_UP; after ASH_182 attaches there are 2 non-Advantage upgrades → 2 Advantage tokens.
    const next = resolve(playUpgradeState('ASH_182', {}, [{ cardId: 'OTHER_UP', owner: 'player' }]), { type: 'playUpgrade', handIndex: 0, targetInstanceId: 'u1' })
    expect(next.players.player.units[0].upgrades.filter(u => u.cardId === TOKEN_ADVANTAGE)).toHaveLength(2)
  })

  it('There Is No Conflict (ASH_199) returns other upgrades to their owners hands', () => {
    const next = resolve(playUpgradeState('ASH_199', {}, [{ cardId: 'OTHER_UP', owner: 'player' }]), { type: 'playUpgrade', handIndex: 0, targetInstanceId: 'u1' })
    expect(next.players.player.hand).toContain('OTHER_UP')
    expect(cardIds(next.players.player.units[0])).toEqual(['ASH_199']) // itself stays
  })
})

describe('ASH upgrades — granted triggers (#341)', () => {
  it('Bokken Saber (ASH_180) gives an Advantage token when the attached unit attacks', () => {
    const s = state({
      cards: { ...CARDS, ASH_180: card({ id: 'ASH_180', type: 'upgrade', power: 1, hp: 1 }) },
      players: { player: player({ units: [unit('u1', 'TST_U1', { upgrades: [{ cardId: 'ASH_180', owner: 'player' }] })] }), opponent: player() },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'u1', target: { kind: 'base' } })
    expect(has(next.players.player.units.find(u => u.instanceId === 'u1')!, TOKEN_ADVANTAGE)).toBe(true)
  })

  it('Heightened Awareness (ASH_227) gives an Advantage token when the regroup phase starts', () => {
    const s = state({
      cards: { ...CARDS, ASH_227: card({ id: 'ASH_227', type: 'upgrade' }) },
      consecutivePasses: 1,
      players: { player: player({ units: [unit('u1', 'TST_U1', { upgrades: [{ cardId: 'ASH_227', owner: 'player' }] })] }), opponent: player() },
    })
    const next = resolve(s, { type: 'pass' }) // second consecutive pass → regroup
    expect(has(next.players.player.units[0], TOKEN_ADVANTAGE)).toBe(true)
  })
})
