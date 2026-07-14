import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { dealDamageToUnit } from '../engine/combat'
import { effectiveCost, legalMoves } from '../engine/legalMoves'
import { effectivePower } from '../engine/stats'
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

describe('ASH upgrades — keyword grants (#342)', () => {
  it('Nowhere to Hide (ASH_198) grants the attached unit Sentinel', () => {
    const s = state({ cards: { ...CARDS, ASH_198: card({ id: 'ASH_198', type: 'upgrade' }) } })
    const u = unit('u1', 'TST_U1', { upgrades: [{ cardId: 'ASH_198', owner: 'player' }] })
    expect(unitHasKeyword(s, u, 'Sentinel')).toBe(true)
  })

  it('Durasteel Plating (ASH_086) has no attach restriction (can go on a Vehicle)', () => {
    const s = state({
      cards: { ...CARDS, ASH_086: card({ id: 'ASH_086', type: 'upgrade', cost: 0 }), UNIT_VEH: card({ id: 'UNIT_VEH', type: 'unit', arena: 'ground', traits: ['Vehicle'] }) },
      players: { player: player({ hand: ['ASH_086'], resources: ready(2), units: [unit('u1', 'UNIT_VEH')] }), opponent: player() },
    })
    expect(legalMoves(s).filter(a => a.type === 'playUpgrade').map(a => a.targetInstanceId)).toContain('u1')
  })
})

describe('ASH upgrades — stat modifiers (#342)', () => {
  it('Pointless to Resist (ASH_054) gives -3 power only while attacking a base', () => {
    const s = state({ cards: { ...CARDS, ASH_054: card({ id: 'ASH_054', type: 'upgrade', power: 0, hp: 0 }) } })
    const u = unit('u1', 'TST_U1', { upgrades: [{ cardId: 'ASH_054', owner: 'player' }] }) // base power 3
    expect(effectivePower(s, u, { attacking: true, attackingBase: true })).toBe(0) // 3 − 3
    expect(effectivePower(s, u, { attacking: true, attackingBase: false })).toBe(3) // vs a unit
    expect(effectivePower(s, u, {})).toBe(3) // not attacking
  })

  it('Pointless to Resist reduces damage dealt to a base', () => {
    const s = state({
      cards: { ...CARDS, ASH_054: card({ id: 'ASH_054', type: 'upgrade', power: 0, hp: 0 }) },
      players: { player: player({ units: [unit('u1', 'TST_U3', { upgrades: [{ cardId: 'ASH_054', owner: 'player' }] })] }), opponent: player() }, // TST_U3 power 5
    })
    const next = resolve(s, { type: 'attack', attackerId: 'u1', target: { kind: 'base' } })
    expect(next.players.opponent.base.damage).toBe(2) // 5 − 3
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

describe('ASH upgrades — onAttackEnd combat effects (#342)', () => {
  it('Grav Charge (ASH_085) deals 4 to the attached unit and defeats itself when the unit survives', () => {
    const s = state({
      cards: { ...CARDS, ASH_085: card({ id: 'ASH_085', type: 'upgrade', power: 0, hp: 0 }) },
      players: { player: player({ units: [unit('u1', 'TST_U4', { upgrades: [{ cardId: 'ASH_085', owner: 'player' }] })] }), opponent: player() }, // TST_U4 hp 9
    })
    const next = resolve(s, { type: 'attack', attackerId: 'u1', target: { kind: 'base' } })
    const u = next.players.player.units.find(u => u.instanceId === 'u1')!
    expect(u.damage).toBe(4)
    expect(has(u, 'ASH_085')).toBe(false) // upgrade defeated
    expect(next.players.player.discard).toContain('ASH_085') // to its owner's discard
  })

  it('Grav Charge defeats the attached unit if the 4 damage is lethal', () => {
    const s = state({
      cards: { ...CARDS, ASH_085: card({ id: 'ASH_085', type: 'upgrade', power: 0, hp: 0 }) },
      players: { player: player({ units: [unit('u1', 'TST_U1', { upgrades: [{ cardId: 'ASH_085', owner: 'player' }] })] }), opponent: player() }, // TST_U1 hp 4
    })
    const next = resolve(s, { type: 'attack', attackerId: 'u1', target: { kind: 'base' } })
    expect(next.players.player.units.find(u => u.instanceId === 'u1')).toBeUndefined() // defeated by its own charge
    expect(next.players.player.discard).toEqual(expect.arrayContaining(['TST_U1', 'ASH_085']))
  })

  it('Whistling Birds (ASH_183) deals 2 to each enemy unit in arena when it hits a base', () => {
    const s = state({
      cards: { ...CARDS, ASH_183: card({ id: 'ASH_183', type: 'upgrade', power: 0, hp: 0 }) },
      players: {
        player: player({ units: [unit('u1', 'TST_U3', { upgrades: [{ cardId: 'ASH_183', owner: 'player' }] })] }), // ground, power 5
        opponent: player({ units: [unit('e1', 'TST_U4'), unit('e2', 'TST_U4'), unit('e3', 'TST_U2')] }), // e1/e2 ground hp 9, e3 space
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'u1', target: { kind: 'base' } })
    expect(next.players.opponent.units.find(u => u.instanceId === 'e1')!.damage).toBe(2)
    expect(next.players.opponent.units.find(u => u.instanceId === 'e2')!.damage).toBe(2)
    expect(next.players.opponent.units.find(u => u.instanceId === 'e3')!.damage).toBe(0) // different arena
  })

  it('Whistling Birds does nothing when the attack targets a unit (no base damage)', () => {
    const s = state({
      cards: { ...CARDS, ASH_183: card({ id: 'ASH_183', type: 'upgrade', power: 0, hp: 0 }) },
      players: {
        player: player({ units: [unit('u1', 'TST_U4', { upgrades: [{ cardId: 'ASH_183', owner: 'player' }] })] }), // hp 9, power 1
        opponent: player({ units: [unit('e1', 'TST_U4'), unit('e2', 'TST_U4')] }), // ground
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'u1', target: { kind: 'unit', instanceId: 'e1' } })
    expect(next.players.opponent.units.find(u => u.instanceId === 'e2')!.damage).toBe(0) // no AoE
  })
})

describe('ASH upgrades — Deadly Vulnerability (ASH_150) (#342)', () => {
  it('doubles combat damage the attached unit takes', () => {
    const s = state({
      cards: { ...CARDS, ASH_150: card({ id: 'ASH_150', type: 'upgrade', power: 0, hp: 0 }) },
      players: {
        player: player({ units: [unit('u1', 'TST_U1')] }), // power 3
        opponent: player({ units: [unit('e1', 'TST_U4', { upgrades: [{ cardId: 'ASH_150', owner: 'opponent' }] })] }), // hp 9
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'u1', target: { kind: 'unit', instanceId: 'e1' } })
    expect(next.players.opponent.units.find(u => u.instanceId === 'e1')!.damage).toBe(6) // 3 × 2
  })

  it('doubles ability damage too', () => {
    const s = state({
      cards: { ...CARDS, ASH_150: card({ id: 'ASH_150', type: 'upgrade', power: 0, hp: 0 }) },
      players: { player: player({ units: [unit('u1', 'TST_U4', { upgrades: [{ cardId: 'ASH_150', owner: 'player' }] })] }), opponent: player() },
    })
    expect(dealDamageToUnit(s, 'u1', 2).players.player.units[0].damage).toBe(4)
  })

  it('makes the attacker lose Overwhelm while the attached unit defends', () => {
    const s = state({
      cards: {
        ...CARDS,
        ASH_150: card({ id: 'ASH_150', type: 'upgrade', power: 0, hp: 0 }),
        OW_U: card({ id: 'OW_U', type: 'unit', arena: 'ground', power: 5, hp: 5, keywords: [{ name: 'Overwhelm' }] }),
        DEF1: card({ id: 'DEF1', type: 'unit', arena: 'ground', power: 0, hp: 1 }),
      },
      players: {
        player: player({ units: [unit('u1', 'OW_U')] }),
        opponent: player({ units: [unit('e1', 'DEF1', { upgrades: [{ cardId: 'ASH_150', owner: 'opponent' }] })] }),
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'u1', target: { kind: 'unit', instanceId: 'e1' } })
    expect(next.players.opponent.units.find(u => u.instanceId === 'e1')).toBeUndefined() // defeated
    expect(next.players.opponent.base.damage).toBe(0) // no Overwhelm trample
  })
})

describe('ASH upgrades — Blade of Talzin (ASH_055) (#342)', () => {
  const CARDS55 = {
    ...CARDS,
    ASH_055: card({ id: 'ASH_055', type: 'upgrade', power: 0, hp: 0 }),
    NIGHT_U: card({ id: 'NIGHT_U', type: 'unit', arena: 'ground', power: 1, hp: 1, traits: ['Night'] }),
    BIG: card({ id: 'BIG', type: 'unit', arena: 'ground', power: 5, hp: 9 }),
  }

  it('returns itself from discard to hand when a friendly Night unit it was on is defeated', () => {
    const s = state({
      cards: CARDS55,
      players: {
        player: player({ units: [unit('u1', 'NIGHT_U', { upgrades: [{ cardId: 'ASH_055', owner: 'player' }] })] }),
        opponent: player({ units: [unit('e1', 'BIG')] }), // power 5 → kills the Night unit
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'u1', target: { kind: 'unit', instanceId: 'e1' } })
    expect(next.players.player.hand).toContain('ASH_055')
    expect(next.players.player.discard).not.toContain('ASH_055') // returned, not discarded
  })

  it('stays in discard when the defeated unit is not a Night unit', () => {
    const s = state({
      cards: CARDS55,
      players: {
        player: player({ units: [unit('u1', 'TST_U3', { upgrades: [{ cardId: 'ASH_055', owner: 'player' }] })] }), // not Night, hp 1
        opponent: player({ units: [unit('e1', 'BIG')] }),
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'u1', target: { kind: 'unit', instanceId: 'e1' } })
    expect(next.players.player.discard).toContain('ASH_055')
    expect(next.players.player.hand).not.toContain('ASH_055')
  })
})

describe('ASH upgrades — token-unit creation (#342)', () => {
  it("Warrior's Legacy (ASH_134) creates a Mandalorian token when the attached unit is defeated", () => {
    const s = state({
      cards: { ...CARDS, ASH_134: card({ id: 'ASH_134', type: 'upgrade', power: 0, hp: 0 }) },
      players: {
        player: player({ units: [unit('u1', 'TST_U3', { upgrades: [{ cardId: 'ASH_134', owner: 'player' }] })] }), // hp 1
        opponent: player({ units: [unit('e1', 'TST_U3')] }), // power 5 → kills u1
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'u1', target: { kind: 'unit', instanceId: 'e1' } })
    const token = next.players.player.units.find(u => u.cardId === 'TOKEN_MANDALORIAN')
    expect(token).toBeDefined()
    expect(next.cards['TOKEN_MANDALORIAN'].power).toBe(2)
    expect(has(token!, TOKEN_SHIELD)).toBe(true) // Shielded: created with a shield token
    expect(token!.exhausted).toBe(true) // created units enter exhausted
    expect(next.players.player.units.find(u => u.instanceId === 'u1')).toBeUndefined() // original defeated
  })

  it('a defeated token unit ceases to exist (never goes to discard)', () => {
    const s = state({
      players: {
        player: player({ discard: [], units: [unit('t1', 'TOKEN_MANDALORIAN')] }), // 2/2, no shield here
        opponent: player({ units: [unit('e1', 'TST_U3')] }), // power 5 → kills token (2 hp)
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 't1', target: { kind: 'unit', instanceId: 'e1' } })
    expect(next.players.player.units.find(u => u.instanceId === 't1')).toBeUndefined()
    expect(next.players.player.discard).not.toContain('TOKEN_MANDALORIAN') // tokens vanish
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
