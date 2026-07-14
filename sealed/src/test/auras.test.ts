import { describe, it, expect, afterEach } from 'vitest'
import { registerCard, unregisterAbility } from '../engine/abilities'
import { effectivePower } from '../engine/stats'
import { unitHasKeyword } from '../engine/keywords'
import '../engine/cardDefinitions' // registers ASH_010 / ASH_007 auras
import { state, player, unit, card, CARDS } from './helpers/engineFixtures'
import type { LeaderState, UnitState } from '../engine/types'

afterEach(() => unregisterAbility('TST_AURA'))
const deployed = (cardId: string): LeaderState => ({ cardId, deployed: true, epicActionUsed: true, exhausted: false })
const find = (units: UnitState[], id: string): UnitState => units.find(u => u.instanceId === id)!

/** Constant/aura abilities — a unit modifies OTHER units' stats/keywords (#346). */
describe('aura mechanism (#346)', () => {
  it('a stat aura buffs other friendly units, but not itself or enemies', () => {
    registerCard('TST_AURA', { aura: (_s, src, tgt, friendly) => (friendly && tgt.instanceId !== src.instanceId ? { power: 2 } : undefined) })
    const s = state({
      cards: { ...CARDS, TST_AURA: card({ id: 'TST_AURA', type: 'unit', arena: 'ground', power: 3, hp: 5 }) },
      players: {
        player: player({ units: [unit('src', 'TST_AURA'), unit('u2', 'TST_U1')] }), // TST_U1 power 3
        opponent: player({ units: [unit('e1', 'TST_U1')] }),
      },
    })
    expect(effectivePower(s, find(s.players.player.units, 'u2'))).toBe(5) // 3 + 2 aura
    expect(effectivePower(s, find(s.players.player.units, 'src'))).toBe(3) // not itself
    expect(effectivePower(s, s.players.opponent.units[0])).toBe(3) // enemy unaffected
  })

  it('a keyword aura grants keywords to other friendly units', () => {
    registerCard('TST_AURA', { aura: (_s, src, tgt, friendly) => (friendly && tgt.instanceId !== src.instanceId ? { keywords: [{ name: 'Sentinel' }] } : undefined) })
    const s = state({
      cards: { ...CARDS, TST_AURA: card({ id: 'TST_AURA', type: 'unit', arena: 'ground' }) },
      players: { player: player({ units: [unit('src', 'TST_AURA'), unit('u2', 'TST_U1')] }), opponent: player({ units: [unit('e1', 'TST_U1')] }) },
    })
    expect(unitHasKeyword(s, find(s.players.player.units, 'u2'), 'Sentinel')).toBe(true)
    expect(unitHasKeyword(s, s.players.opponent.units[0], 'Sentinel')).toBe(false)
  })
})

describe('Bo-Katan (ASH_010) deployed aura — +1/0 to other Mandalorians (#346)', () => {
  it('buffs other friendly Mandalorian units only', () => {
    const s = state({
      cards: { ...CARDS, ASH_010: card({ id: 'ASH_010', type: 'leader', power: 4, hp: 7 }), MANDO: card({ id: 'MANDO', type: 'unit', arena: 'ground', power: 2, hp: 2, traits: ['Mandalorian'] }) },
      players: {
        player: player({ leader: deployed('ASH_010'), units: [unit('L', 'ASH_010', { isLeader: true }), unit('m1', 'MANDO'), unit('n1', 'TST_U1')] }),
        opponent: player({ units: [unit('em', 'MANDO')] }),
      },
    })
    expect(effectivePower(s, find(s.players.player.units, 'm1'))).toBe(3) // 2 + 1
    expect(effectivePower(s, find(s.players.player.units, 'n1'))).toBe(3) // non-Mandalorian unaffected
    expect(effectivePower(s, s.players.opponent.units[0])).toBe(2) // enemy Mandalorian unaffected
  })
})

describe('Grand Admiral Sloane (ASH_007) deployed aura — Overwhelm+Sentinel to others (#346)', () => {
  it('grants Overwhelm and Sentinel to other friendly units', () => {
    const s = state({
      cards: { ...CARDS, ASH_007: card({ id: 'ASH_007', type: 'leader', power: 3, hp: 6 }) },
      players: {
        player: player({ leader: deployed('ASH_007'), units: [unit('L', 'ASH_007', { isLeader: true }), unit('u2', 'TST_U1')] }),
        opponent: player({ units: [unit('e1', 'TST_U1')] }),
      },
    })
    const u2 = find(s.players.player.units, 'u2')
    expect(unitHasKeyword(s, u2, 'Overwhelm')).toBe(true)
    expect(unitHasKeyword(s, u2, 'Sentinel')).toBe(true)
    expect(unitHasKeyword(s, s.players.opponent.units[0], 'Sentinel')).toBe(false)
  })
})
