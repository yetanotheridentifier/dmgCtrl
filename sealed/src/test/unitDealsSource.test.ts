import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { dealDamageToUnit } from '../engine/combat'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, PendingChoice, UnitState } from '../engine/types'

/**
 * "A friendly unit deals damage": when an effect has a unit deal the damage, the damage is that unit's.
 * The damage event names it as the dealer, so "when a friendly unit deals damage to an enemy unit"
 * (Jango Fett) hears it, and a rule that reads who dealt the damage ("damage dealt by friendly
 * Underworld cards is unpreventable", Gorian Shard's Corsair) reads the unit, not the event.
 *
 * Jango's unit side (`jf`) is on the board as the listener throughout: it offers to exhaust the enemy
 * unit only when a friendly unit dealt the damage.
 */
const ev = (id: string, cost = 1) => card({ id, type: 'event', cost })
const F: Record<string, EngineCard> = {
  ...CARDS,
  TWI_016: card({ id: 'TWI_016', name: 'Jango Fett', type: 'leader', arena: 'ground', cost: 5, power: 3, hp: 7, traits: ['Underworld', 'Bounty Hunter'] }),
  SEC_002: card({ id: 'SEC_002', name: 'Jabba the Hutt', type: 'leader', arena: 'ground', cost: 6, power: 5, hp: 8, traits: ['Underworld', 'Hutt'] }),
  ASH_196: card({ id: 'ASH_196', name: "Gorian Shard's Corsair", type: 'unit', arena: 'space', cost: 6, power: 6, hp: 5, traits: ['Underworld'] }),
  ASH_102: card({ id: 'ASH_102', name: 'Ravager', type: 'unit', arena: 'space', cost: 7, power: 4, hp: 6 }),
  SHD_087: card({ id: 'SHD_087', name: 'Crosshair', type: 'unit', arena: 'ground', cost: 4, power: 3, hp: 4 }),
  SHD_250: card({ id: 'SHD_250', name: 'Tarfful', type: 'unit', arena: 'ground', cost: 5, power: 3, hp: 6, traits: ['Wookiee'] }),
  TWI_256: card({ id: 'TWI_256', name: 'Hold-Out Blaster', type: 'upgrade', cost: 1, power: 1, hp: 0 }),
  ASH_070: card({ id: 'ASH_070', name: 'At Attin Safety Droid', type: 'unit', arena: 'ground', cost: 3, power: 2, hp: 5 }),
  UWOVER: card({ id: 'UWOVER', arena: 'ground', cost: 5, power: 10, hp: 10, traits: ['UNDERWORLD'], keywords: [{ name: 'Overwhelm' }] }),
  UWWOOK: card({ id: 'UWWOOK', arena: 'ground', cost: 2, power: 1, hp: 10, traits: ['WOOKIEE', 'UNDERWORLD'] }),
  SOR_127: ev('SOR_127', 3), SOR_151: ev('SOR_151', 2), LOF_128: ev('LOF_128', 4), HMW_192: ev('HMW_192'),
  SOR_234: ev('SOR_234', 4), JTL_129: ev('JTL_129', 4), JTL_131: ev('JTL_131', 7), SOR_092: ev('SOR_092', 5),
  ASH_139: ev('ASH_139', 4), HMW_114: ev('HMW_114', 3), HMW_151: ev('HMW_151', 2), LAW_168: ev('LAW_168', 3),
  SOR_107: ev('SOR_107', 5),
  KASH_B: card({ id: 'KASH_B', type: 'base', hp: 30, aspects: ['Vigilance'], traits: ['KASHYYYK'] }),
  P3: card({ id: 'P3', arena: 'ground', cost: 2, power: 3, hp: 5 }),
  UW3: card({ id: 'UW3', arena: 'ground', cost: 2, power: 3, hp: 5, traits: ['UNDERWORLD'] }),
  UWSP: card({ id: 'UWSP', arena: 'space', cost: 2, power: 3, hp: 5, traits: ['UNDERWORLD'] }),
  IMP2: card({ id: 'IMP2', arena: 'ground', cost: 2, power: 2, hp: 5, traits: ['IMPERIAL'] }),
  IMP3: card({ id: 'IMP3', arena: 'ground', cost: 3, power: 3, hp: 5, traits: ['IMPERIAL'] }),
  VEHG: card({ id: 'VEHG', arena: 'ground', cost: 3, power: 2, hp: 5, traits: ['VEHICLE'] }),
  SP4: card({ id: 'SP4', arena: 'space', cost: 3, power: 4, hp: 20 }),
  RAID2: card({ id: 'RAID2', arena: 'ground', cost: 2, power: 1, hp: 5, keywords: [{ name: 'Raid', value: 2 }] }),
  BIG: card({ id: 'BIG', arena: 'ground', cost: 5, power: 1, hp: 20 }),
  BIGSP: card({ id: 'BIGSP', arena: 'space', cost: 5, power: 1, hp: 20 }),
}

const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)
const jango = () => unit('jf', 'TWI_016')

type Side = Parameters<typeof player>[0]
const board = (mine: Side = {}, theirs: Side = {}) =>
  state({
    cards: F,
    players: {
      player: player({ resources: ready(20), deck: [], ...mine }),
      opponent: player({ deck: [], ...theirs }),
    },
  })
/** Play `eventId` from an otherwise empty hand, Jango on the board beside `units`. */
const play = (eventId: string, units: UnitState[], theirs: UnitState[] = [unit('e', 'BIG')], mine: Side = {}) =>
  resolve(board({ ...mine, hand: [eventId], units: [jango(), ...units] }, { units: theirs }), { type: 'playEvent', handIndex: 0 })
const choice = (s: GameState): PendingChoice => {
  expect(s.pendingChoices?.length ?? 0, 'a choice is raised').toBeGreaterThan(0)
  return s.pendingChoices![0]
}
type Extra = { targetInstanceId?: string; optionIndex?: number }
const accept = (s: GameState, extra: Extra = {}) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const pick = (s: GameState, ...ids: string[]) => ids.reduce((acc, id) => accept(acc, { targetInstanceId: id }), s)
/** Jango Fett's unit side is offering to exhaust the enemy unit, i.e. he heard a friendly unit deal damage. */
const jangoHeard = (s: GameState) => (s.pendingChoices ?? []).some(c => c.kind === 'mayPayThen' && c.text === 'exhaust that enemy unit')
/** Take Jango's offer: the damaged enemy unit ends up exhausted. */
const takeJango = (s: GameState) => resolve(s, { type: 'acceptChoice', choiceId: s.pendingChoices!.find(c => c.kind === 'mayPayThen')!.id })

describe('an effect that has a friendly unit deal damage names that unit as the dealer', () => {
  it('Command (SOR_107): the shape the others follow', () => {
    let s = play('SOR_107', [unit('a', 'P3')])
    const mode = choice(s).kind === 'chooseMode' ? (choice(s) as Extract<PendingChoice, { kind: 'chooseMode' }>).labels!.findIndex(l => l.startsWith('A friendly unit deals')) : -1
    s = accept(s, { optionIndex: mode })
    s = pick(s, 'a', 'e')
    expect(U(s, 'e')!.damage).toBe(3)
    expect(jangoHeard(s)).toBe(true)
  })

  it.each([
    ['SOR_127', 'Strike True', unit('a', 'P3'), 3],
    ['SOR_151', 'Karabast', unit('a', 'P3', { damage: 2 }), 3],
    ['LOF_128', 'Protect the Pod', unit('a', 'P3', { damage: 1 }), 4],
    ['HMW_192', 'Volley Fire', unit('a', 'RAID2'), 2],
  ] as const)('%s %s: the chosen friendly unit deals it', (id, _name, dealer, amount) => {
    const s = pick(play(id, [dealer]), 'a', 'e')
    expect(U(s, 'e')!.damage).toBe(amount)
    expect(jangoHeard(s)).toBe(true)
    expect(U(takeJango(s), 'e')!.exhausted).toBe(true)
  })

  it('Maximum Firepower (SOR_234): the first Imperial unit deals the first hit', () => {
    const s = pick(play('SOR_234', [unit('i2', 'IMP2'), unit('i3', 'IMP3')]), 'i3', 'e')
    expect(U(s, 'e')!.damage).toBe(3)
    expect(jangoHeard(s)).toBe(true)
  })

  it('Maximum Firepower (SOR_234): the second Imperial unit deals the second hit', () => {
    // No Jango for the first hit, so the only offer is for the second.
    const s0 = resolve(board({ hand: ['SOR_234'], units: [unit('i2', 'IMP2'), unit('i3', 'IMP3')] }, { units: [unit('e', 'BIG')] }), { type: 'playEvent', handIndex: 0 })
    const first = pick(s0, 'i3', 'e')
    const withJango = { ...first, players: { ...first.players, player: { ...first.players.player, units: [...first.players.player.units, jango()] } } }
    const s = pick(withJango, 'i2')
    expect(U(s, 'e')!.damage).toBe(5)
    expect(jangoHeard(s)).toBe(true)
  })

  it('Focus Fire (JTL_129): each friendly Vehicle deals its own hit', () => {
    const s = pick(play('JTL_129', [unit('v', 'VEHG')]), 'e')
    expect(U(s, 'e')!.damage).toBe(2)
    expect(jangoHeard(s)).toBe(true)
  })

  it('Turbolaser Salvo (JTL_131): the friendly space unit deals it', () => {
    let s = play('JTL_131', [unit('sp', 'SP4')])
    s = accept(s, { optionIndex: 0 }) // ground
    s = pick(s, 'sp')
    expect(U(s, 'e')!.damage).toBe(4)
    expect(jangoHeard(s)).toBe(true)
  })

  it('Overwhelming Barrage (SOR_092): the buffed unit deals the divided damage', () => {
    const s = pick(play('SOR_092', [unit('a', 'P3')]), 'a', 'e')
    expect(U(s, 'e')!.damage).toBe(1)
    expect(jangoHeard(s)).toBe(true)
  })

  it('Hold Them Off (ASH_139): the chosen unit deals the divided damage', () => {
    const s = pick(play('ASH_139', [unit('a', 'P3')]), 'a', 'e')
    expect(U(s, 'e')!.damage).toBe(1)
    expect(jangoHeard(s)).toBe(true)
  })

  it('Breach (HMW_114): the friendly unit deals it', () => {
    const s = pick(play('HMW_114', [unit('a', 'P3')]), 'a', 'e')
    expect(U(s, 'e')!.damage).toBe(3)
    expect(jangoHeard(s)).toBe(true)
  })

  it('Overgrowth (HMW_151): the friendly unit deals it', () => {
    const s = pick(play('HMW_151', [unit('a', 'P3')], [unit('e', 'BIG')], { base: { cardId: 'KASH_B', damage: 0 } }), 'a', 'e')
    expect(U(s, 'e')!.damage).toBe(3)
    expect(jangoHeard(s)).toBe(true)
  })

  it('Haymaker (LAW_168): the unit given the Experience token deals it', () => {
    const s = pick(play('LAW_168', [unit('a', 'P3')]), 'a', 'e')
    expect(U(s, 'e')!.damage).toBe(4)
    expect(jangoHeard(s)).toBe(true)
  })

  it('Jabba the Hutt (SEC_002) front: the damaged friendly unit deals it', () => {
    const s0 = board({ leader: { cardId: 'SEC_002', deployed: false, epicActionUsed: false, exhausted: false }, units: [jango(), unit('d', 'P3', { damage: 3 })] }, { units: [unit('e', 'BIG')] })
    const s = pick(resolve(s0, { type: 'useLeaderAbility', index: 0 }), 'd', 'e')
    expect(U(s, 'e')!.damage).toBe(2)
    expect(jangoHeard(s)).toBe(true)
  })

  it('Jabba the Hutt (SEC_002) unit side: the friendly unit that was dealt damage deals that much', () => {
    const s0 = board({ leader: { cardId: 'SEC_002', deployed: true, epicActionUsed: true, exhausted: false }, units: [unit('L', 'SEC_002', { isLeader: true }), jango(), unit('g', 'P3')] }, { units: [unit('e', 'BIG')] })
    const s = pick(dealDamageToUnit(s0, 'g', 2, { cardId: 'SOR_127', controller: 'opponent' }), 'e')
    expect(U(s, 'e')!.damage).toBe(2)
    expect(jangoHeard(s)).toBe(true)
  })

  it('Hold-Out Blaster (TWI_256): the attached unit deals it', () => {
    const s0 = board({ hand: ['TWI_256'], units: [jango(), unit('a', 'P3')] }, { units: [unit('e', 'BIG')] })
    const s = pick(resolve(s0, { type: 'playUpgrade', handIndex: 0, targetInstanceId: 'a' }), 'e')
    expect(U(s, 'e')!.damage).toBe(1)
    expect(jangoHeard(s)).toBe(true)
  })

  it('Crosshair (SHD_087): "this unit deals" is the unit\'s own ability, so it is already named', () => {
    const s0 = board({ units: [jango(), unit('c', 'SHD_087')] }, { units: [unit('e', 'BIG')] })
    const s = pick(resolve(s0, { type: 'useAbility', instanceId: 'c', cardId: 'SHD_087', index: 1 }), 'e')
    expect(U(s, 'e')!.damage).toBe(3)
    expect(jangoHeard(s)).toBe(true)
  })

  it('an event that deals damage itself still names no unit', () => {
    // Control: the listener is not simply hearing every damage event.
    const s = dealDamageToUnit(board({ units: [jango()] }, { units: [unit('e', 'BIG')] }), 'e', 1, { cardId: 'SOR_127', controller: 'player' })
    expect(jangoHeard(s)).toBe(false)
  })
})

describe('a named dealer is what source-reading prevention sees', () => {
  // Gorian Shard's Corsair: "Damage dealt by friendly Underworld cards is unpreventable." The event is
  // not an Underworld card, but the unit that deals the damage is, so a Shield no longer stops it.
  const shielded = (id: string, cardId = 'BIG') => unit(id, cardId, { upgrades: [{ cardId: TOKEN_SHIELD, owner: 'opponent' }] })
  const shields = (s: GameState, id: string) => U(s, id)!.upgrades.filter(u => u.cardId === TOKEN_SHIELD).length

  it('Strike True with a friendly Underworld unit ignores the Shield', () => {
    const s = pick(resolve(board({ hand: ['SOR_127'], units: [unit('gs', 'ASH_196'), unit('a', 'UW3')] }, { units: [shielded('e')] }), { type: 'playEvent', handIndex: 0 }), 'a', 'e')
    expect(U(s, 'e')!.damage).toBe(3)
    expect(shields(s, 'e')).toBe(1)
  })

  it('Strike True with a non-Underworld unit is still stopped by the Shield', () => {
    const s = pick(resolve(board({ hand: ['SOR_127'], units: [unit('gs', 'ASH_196'), unit('a', 'P3')] }, { units: [shielded('e')] }), { type: 'playEvent', handIndex: 0 }), 'a', 'e')
    expect(U(s, 'e')!.damage).toBe(0)
    expect(shields(s, 'e')).toBe(0)
  })

  it('Hold Them Off with a friendly Underworld unit ignores the Shield', () => {
    const s = pick(resolve(board({ hand: ['ASH_139'], units: [unit('gs', 'ASH_196'), unit('a', 'UW3')] }, { units: [shielded('e')] }), { type: 'playEvent', handIndex: 0 }), 'a', 'e')
    expect(U(s, 'e')!.damage).toBe(1)
    expect(shields(s, 'e')).toBe(1)
  })

  it('Jabba the Hutt (SEC_002) unit side: the damaged Underworld unit deals it, so the Shield is ignored', () => {
    const s0 = board({ leader: { cardId: 'SEC_002', deployed: true, epicActionUsed: true, exhausted: false }, units: [unit('L', 'SEC_002', { isLeader: true }), unit('gs', 'ASH_196'), unit('g', 'UW3')] }, { units: [shielded('e')] })
    const s = pick(dealDamageToUnit(s0, 'g', 2, { cardId: 'SOR_127', controller: 'opponent' }), 'e')
    expect(U(s, 'e')!.damage).toBe(2)
    expect(shields(s, 'e')).toBe(1)
  })

  it("Breach (HMW_114): the Overwhelm unit deals the excess to the base too, past At Attin Safety Droid's cap", () => {
    const s0 = board({ hand: ['HMW_114'], units: [unit('gs', 'ASH_196'), unit('o', 'UWOVER')] }, { units: [unit('e', 'P3', { damage: 4 }), unit('sd', 'ASH_070')] })
    const s = pick(resolve(s0, { type: 'playEvent', handIndex: 0 }), 'o', 'e')
    expect(s.players.opponent.base.damage).toBe(9)
  })

  it('Tarfful (SHD_250): the Wookiee that survived deals it, not Tarfful', () => {
    const s0 = board({ units: [unit('gs', 'ASH_196'), unit('t', 'SHD_250'), unit('w', 'UWWOOK')] }, { units: [unit('x', 'BIG'), shielded('e')] })
    const swung = resolve(s0, { type: 'attack', attackerId: 'w', target: { kind: 'unit', instanceId: 'x' } })
    const s = pick(swung, 'e')
    expect(U(s, 'e')!.damage).toBe(1)
    expect(shields(s, 'e')).toBe(1)
  })

  it('Ravager (ASH_102): the entering Underworld unit deals it, not Ravager', () => {
    const s0 = board({ hand: ['UWSP'], units: [unit('gs', 'ASH_196'), unit('r', 'ASH_102')] }, { units: [shielded('e', 'BIGSP')] })
    const s = pick(resolve(s0, { type: 'playUnit', handIndex: 0 }), 'e')
    expect(U(s, 'e')!.damage).toBe(3)
    expect(shields(s, 'e')).toBe(1)
  })
})
