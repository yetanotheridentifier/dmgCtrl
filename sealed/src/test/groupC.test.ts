import { describe, it, expect } from 'vitest'
import { state, player, unit, card, CARDS } from './helpers/engineFixtures'
import { unitHasKeyword } from '../engine/keywords'
import { effectivePower, effectiveHp } from '../engine/stats'
import { resolve } from '../engine/resolve'
import { ready } from './helpers/engineFixtures'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import type { GameState } from '../engine/types'

/**
 * Group C (#354): constant effects on OTHER units — auras. Reuses the `aura` hook (Bo-Katan/Sloane/
 * Grogu), extended with keyword *removal* (`removeKeywords`) for "enemy units lose X" / "all units
 * lose X". Gallius Rax counts a target's keywords via a non-recursive helper.
 */

const C = {
  ...CARDS,
  ASH_177: card({ id: 'ASH_177', type: 'unit', arena: 'space', power: 6, hp: 6, keywords: [{ name: 'Hidden' }] }), // Onyx Cinder
  ASH_100: card({ id: 'ASH_100', type: 'unit', arena: 'ground', power: 4, hp: 7 }), // Gallius Rax
  ASH_068: card({ id: 'ASH_068', type: 'unit', arena: 'ground', power: 1, hp: 3 }), // Domesticated Loth-Cat
  ASH_040: card({ id: 'ASH_040', type: 'unit', arena: 'ground', power: 3, hp: 3 }), // Poe Dameron
  GRUNT: card({ id: 'GRUNT', type: 'unit', arena: 'ground', power: 2, hp: 2 }),
  MULTI_KW: card({ id: 'MULTI_KW', type: 'unit', arena: 'ground', power: 2, hp: 2, keywords: [{ name: 'Sentinel' }, { name: 'Overwhelm' }] }),
  ONE_KW: card({ id: 'ONE_KW', type: 'unit', arena: 'ground', power: 2, hp: 2, keywords: [{ name: 'Sentinel' }] }),
  AMB_SUP: card({ id: 'AMB_SUP', type: 'unit', arena: 'ground', power: 2, hp: 2, keywords: [{ name: 'Ambush' }, { name: 'Support' }] }),
  SENT: card({ id: 'SENT', type: 'unit', arena: 'ground', power: 2, hp: 2, keywords: [{ name: 'Sentinel' }] }),
}
const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)!
const kw = (s: GameState, id: string, name: string) => unitHasKeyword(s, U(s, id), name)
const mk = (over: Parameters<typeof state>[0]) => state({ cards: C, ...over })

describe('Group C — auras on other units (#354)', () => {
  it('Onyx Cinder (177): other friendly units gain Hidden; enemies do not', () => {
    const s = mk({ players: { player: player({ units: [unit('o', 'ASH_177'), unit('f', 'GRUNT')] }), opponent: player({ units: [unit('e', 'GRUNT')] }) } })
    expect(kw(s, 'f', 'Hidden')).toBe(true) // other friendly gains it
    expect(kw(s, 'o', 'Hidden')).toBe(true) // its own base Hidden
    expect(kw(s, 'e', 'Hidden')).toBe(false) // enemy unaffected
  })

  it('Gallius Rax (100): +2/+2 to other friendly units with 2+ different keywords', () => {
    const s = mk({ players: { player: player({ units: [unit('g', 'ASH_100'), unit('m', 'MULTI_KW'), unit('o', 'ONE_KW')] }), opponent: player({ units: [unit('e', 'MULTI_KW')] }) } })
    expect(effectivePower(s, U(s, 'm'))).toBe(4) // 2 keywords → +2/+2
    expect(effectiveHp(s, U(s, 'm'))).toBe(4)
    expect(effectivePower(s, U(s, 'o'))).toBe(2) // only 1 keyword → no buff
    expect(effectivePower(s, U(s, 'g'))).toBe(4) // itself unbuffed ("other")
    expect(effectivePower(s, U(s, 'e'))).toBe(2) // enemy unbuffed
  })

  it('Domesticated Loth-Cat (068): enemy units lose Ambush and Support; friendlies keep them', () => {
    const s = mk({ players: { player: player({ units: [unit('lc', 'ASH_068'), unit('fa', 'AMB_SUP')] }), opponent: player({ units: [unit('ea', 'AMB_SUP')] }) } })
    expect(kw(s, 'ea', 'Ambush')).toBe(false)
    expect(kw(s, 'ea', 'Support')).toBe(false)
    expect(kw(s, 'fa', 'Ambush')).toBe(true) // friendly keeps them
    expect(kw(s, 'fa', 'Support')).toBe(true)
  })

  it('Poe Dameron (040): all units — both sides — lose Sentinel', () => {
    const s = mk({ players: { player: player({ units: [unit('p', 'ASH_040'), unit('fs', 'SENT')] }), opponent: player({ units: [unit('es', 'SENT')] }) } })
    expect(kw(s, 'fs', 'Sentinel')).toBe(false)
    expect(kw(s, 'es', 'Sentinel')).toBe(false)
  })

  it('Domesticated Loth-Cat (068): an enemy Ambush unit played into the aura cannot ambush', () => {
    const s = mk({
      activePlayer: 'opponent',
      players: {
        player: player({ units: [unit('lc', 'ASH_068')] }),
        opponent: player({ hand: ['AMB_SUP'], resources: ready(6) }),
      },
    })
    const played = resolve(s, { type: 'playCard', handIndex: 0 })
    expect(played.pendingChoices ?? []).toHaveLength(0) // Ambush stripped by the aura → no ambush attack
    expect(played.players.opponent.units.find(u => u.cardId === 'AMB_SUP')!.exhausted).toBe(true) // enters exhausted
  })
})
