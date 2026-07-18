import { describe, it, expect } from 'vitest'
import { state, player, unit, card, CARDS } from './helpers/engineFixtures'
import { unitHasKeyword, unitKeywordValue } from '../engine/keywords'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { normaliseCard } from '../engine/cardDb'
import { cardId } from '../data/cards'
import type { SwuCard } from '../data/cards'
import ashSet from './fixtures/ashSet.json'
import type { GameState } from '../engine/types'

/**
 * Group B1 (#353): conditional self keyword grants — "While <condition>, this unit gains <keyword>".
 * Reuses the existing `conditionalKeywords` hook. The one wrinkle: the source data lists each
 * card's conditional keyword in its base `Keywords`, which would make it permanent — so those are
 * stripped via `cardDataCorrections` and re-granted only when the condition holds.
 */

// Fixture cards carry the CORRECTED base keywords (conditional keyword removed); the ability re-grants it.
const B = {
  ...CARDS,
  ASH_243: card({ id: 'ASH_243', type: 'unit', arena: 'ground', power: 5, hp: 6, traits: ['Sith'], keywords: [{ name: 'Shielded' }] }), // Darth Vader
  ASH_122: card({ id: 'ASH_122', type: 'unit', arena: 'space', power: 3, hp: 3 }), // Consortium StarViper
  ASH_057: card({ id: 'ASH_057', type: 'unit', arena: 'space', power: 2, hp: 3 }), // Lothal E-Wing
  ASH_105: card({ id: 'ASH_105', type: 'unit', arena: 'ground', power: 3, hp: 4, traits: ['Mandalorian'] }), // Bo-Katan Kryze
  ASH_078: card({ id: 'ASH_078', type: 'unit', arena: 'space', power: 2, hp: 4 }), // B-Wing Rearguard
  ASH_098: card({ id: 'ASH_098', type: 'unit', arena: 'ground', power: 4, hp: 4, unique: true }), // AT-ST Raider
  ASH_120: card({ id: 'ASH_120', type: 'unit', arena: 'ground', power: 2, hp: 2, traits: ['Mandalorian'] }), // Warrior of Clan Kryze
  ASH_049: card({ id: 'ASH_049', type: 'unit', arena: 'ground', power: 4, hp: 5 }), // Shin Hati
  ASH_093: card({ id: 'ASH_093', type: 'unit', arena: 'space', power: 3, hp: 5 }), // Captain Pellaeon
  MANDO: card({ id: 'MANDO', type: 'unit', arena: 'ground', traits: ['Mandalorian'] }),
  GRUNT: card({ id: 'GRUNT', type: 'unit', arena: 'ground' }),
  UNIQUE_U: card({ id: 'UNIQUE_U', type: 'unit', arena: 'ground', unique: true }),
  UPG: card({ id: 'UPG', type: 'upgrade', power: 1, hp: 1 }),
  LEAD: card({ id: 'LEAD', type: 'leader', power: 4, hp: 7 }),
}

const kw = (s: GameState, id: string, name: string): boolean => {
  const u = [...s.players.player.units, ...s.players.opponent.units].find(x => x.instanceId === id)!
  return unitHasKeyword(s, u, name)
}
const mk = (over: Parameters<typeof state>[0]) => state({ cards: B, ...over })

describe('Group B1 — conditional self keyword grants (#353)', () => {
  it('Darth Vader (243): Sentinel only while ready; Shielded always', () => {
    const ready = mk({ players: { player: player({ units: [unit('v', 'ASH_243')] }), opponent: player() } })
    const spent = mk({ players: { player: player({ units: [unit('v', 'ASH_243', { exhausted: true })] }), opponent: player() } })
    expect(kw(ready, 'v', 'Sentinel')).toBe(true)
    expect(kw(spent, 'v', 'Sentinel')).toBe(false)
    expect(kw(spent, 'v', 'Shielded')).toBe(true)
  })

  it('Consortium StarViper (122): Restore 2 only while you have the initiative', () => {
    const yes = mk({ initiative: 'player', players: { player: player({ units: [unit('c', 'ASH_122')] }), opponent: player() } })
    const no = mk({ initiative: 'opponent', players: { player: player({ units: [unit('c', 'ASH_122')] }), opponent: player() } })
    expect(kw(yes, 'c', 'Restore')).toBe(true)
    expect(unitKeywordValue(yes, yes.players.player.units[0], 'Restore')).toBe(2)
    expect(kw(no, 'c', 'Restore')).toBe(false)
  })

  it('Lothal E-Wing (057): Restore 2 only while an enemy unit is upgraded', () => {
    const yes = mk({ players: { player: player({ units: [unit('l', 'ASH_057')] }), opponent: player({ units: [unit('e', 'GRUNT', { upgrades: [{ cardId: 'UPG', owner: 'opponent' }] })] }) } })
    const no = mk({ players: { player: player({ units: [unit('l', 'ASH_057')] }), opponent: player({ units: [unit('e', 'GRUNT')] }) } })
    expect(kw(yes, 'l', 'Restore')).toBe(true)
    expect(kw(no, 'l', 'Restore')).toBe(false)
  })

  it('Bo-Katan Kryze (105): Raid 2 only while you control another Mandalorian', () => {
    const yes = mk({ players: { player: player({ units: [unit('b', 'ASH_105'), unit('m', 'MANDO')] }), opponent: player() } })
    const no = mk({ players: { player: player({ units: [unit('b', 'ASH_105'), unit('g', 'GRUNT')] }), opponent: player() } })
    expect(unitKeywordValue(yes, yes.players.player.units[0], 'Raid')).toBe(2)
    expect(kw(no, 'b', 'Raid')).toBe(false)
  })

  it('B-Wing Rearguard (078): Sentinel only while you control a ground unit', () => {
    // B-Wing is a Space unit, so it doesn't satisfy its own "control a ground unit" condition.
    const yes = mk({ players: { player: player({ units: [unit('bw', 'ASH_078', { arena: 'space' }), unit('g', 'GRUNT', { arena: 'ground' })] }), opponent: player() } })
    const no = mk({ players: { player: player({ units: [unit('bw', 'ASH_078', { arena: 'space' })] }), opponent: player() } })
    expect(kw(yes, 'bw', 'Sentinel')).toBe(true)
    expect(kw(no, 'bw', 'Sentinel')).toBe(false)
  })

  it('AT-ST Raider (098): Ambush only while you control another non-unique unit', () => {
    const yes = mk({ players: { player: player({ units: [unit('at', 'ASH_098'), unit('g', 'GRUNT')] }), opponent: player() } })
    const no = mk({ players: { player: player({ units: [unit('at', 'ASH_098'), unit('u', 'UNIQUE_U')] }), opponent: player() } })
    expect(kw(yes, 'at', 'Ambush')).toBe(true)
    expect(kw(no, 'at', 'Ambush')).toBe(false) // only a unique other unit → condition unmet
  })

  it('Warrior of Clan Kryze (120): Sentinel only while you control another exhausted unit', () => {
    const yes = mk({ players: { player: player({ units: [unit('w', 'ASH_120'), unit('g', 'GRUNT', { exhausted: true })] }), opponent: player() } })
    const no = mk({ players: { player: player({ units: [unit('w', 'ASH_120'), unit('g', 'GRUNT')] }), opponent: player() } })
    expect(kw(yes, 'w', 'Sentinel')).toBe(true)
    expect(kw(no, 'w', 'Sentinel')).toBe(false)
  })

  it('Shin Hati (049): Sentinel only while she is the sole friendly non-leader ground unit', () => {
    const yes = mk({ players: { player: player({ units: [unit('s', 'ASH_049')] }), opponent: player() } })
    const no = mk({ players: { player: player({ units: [unit('s', 'ASH_049'), unit('g', 'GRUNT')] }), opponent: player() } })
    expect(kw(yes, 's', 'Sentinel')).toBe(true)
    expect(kw(no, 's', 'Sentinel')).toBe(false)
  })

  it('Captain Pellaeon (093): Raid 3 only while a leader unit was defeated this phase', () => {
    const base = mk({ players: { player: player({ units: [unit('p', 'ASH_093')] }), opponent: player() } })
    const withLeaderDefeat: GameState = { ...base, phaseEvents: { enteredPlay: { player: [], opponent: [] }, defeated: { player: [], opponent: ['LEAD'] } } }
    expect(unitKeywordValue(withLeaderDefeat, withLeaderDefeat.players.player.units[0], 'Raid')).toBe(3)
    expect(kw(base, 'p', 'Raid')).toBe(false)
  })
})

describe('Group B1 — conditional keywords are stripped from the base data (#353)', () => {
  const byId = new Map((ashSet as unknown as SwuCard[]).map(c => [cardId(c.Set, c.Number), c]))
  // The base keyword set after correction: the conditional keyword is gone; genuine keywords remain.
  const cases: [string, string[]][] = [
    ['ASH_098', []], ['ASH_078', []], ['ASH_105', []], ['ASH_093', []], ['ASH_122', []],
    ['ASH_057', []], ['ASH_049', []], ['ASH_120', []], ['ASH_243', ['Shielded']],
  ]
  it.each(cases)('%s base keywords are corrected', (id, expected) => {
    const names = normaliseCard(byId.get(id)!).keywords.map(k => k.name)
    expect(names).toEqual(expected)
  })
})
