import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { TOKEN_BATTLE_DROID, TOKEN_CLONE_TROOPER } from '../engine/tokenUnits'
import { CARD_DATA_CORRECTIONS } from '../engine/cardDataCorrections'
import { unitHasKeyword } from '../engine/keywords'
import { effectivePower } from '../engine/stats'
import { getCardDefinition } from '../engine/abilities'
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, PendingChoice, PlayerId, UnitState } from '../engine/types'

/**
 * Cards whose heads already dispatch and whose effects are registrations over existing primitives:
 * each one is a trigger the engine already fires, read against the card's printed text.
 */
const F: Record<string, EngineCard> = {
  ...CARDS,
  TWI_101: card({ id: 'TWI_101', name: 'Mas Amedda', arena: 'ground', cost: 2, power: 0, hp: 4, aspects: ['Command', 'Command'], traits: ['Republic', 'Official'] }),
  TWI_018: card({ id: 'TWI_018', name: 'Quinlan Vos', type: 'leader', arena: 'ground', cost: 5, power: 3, hp: 7, traits: ['Force', 'Jedi', 'Republic'] }),
  SHD_008: card({ id: 'SHD_008', name: 'Boba Fett', type: 'leader', arena: 'ground', cost: 6, power: 4, hp: 7, traits: ['Underworld'] }),
  SOR_143: card({ id: 'SOR_143', name: 'Fighters For Freedom', arena: 'ground', cost: 3, power: 3, hp: 4, aspects: ['Aggression', 'Heroism'], traits: ['Rebel', 'Trooper'], keywords: [{ name: 'Saboteur' }] }),
  SHD_239: card({ id: 'SHD_239', name: 'Toro Calican', arena: 'ground', cost: 3, power: 3, hp: 5, aspects: ['Villainy'], traits: ['Bounty Hunter'], unique: true }),
  SOR_115: card({ id: 'SOR_115', name: 'Agent Kallus', arena: 'ground', cost: 5, power: 4, hp: 4, aspects: ['Command'], traits: ['Imperial', 'Trooper'], unique: true }),
  SHD_137: card({ id: 'SHD_137', name: 'Punishing One', arena: 'space', cost: 3, power: 3, hp: 4, traits: ['Underworld', 'Vehicle', 'Transport'], unique: true }),
  LAW_088: card({ id: 'LAW_088', name: 'Anakin Skywalker', arena: 'ground', cost: 2, power: 2, hp: 4, traits: ['Force'], unique: true }),
  LAW_033: card({ id: 'LAW_033', name: "Hound's Tooth", arena: 'ground', cost: 7, power: 4, hp: 8, traits: ['Underworld', 'Vehicle', 'Transport'], unique: true }),
  LAW_054: card({ id: 'LAW_054', name: 'Maul', arena: 'ground', cost: 7, power: 6, hp: 8, traits: ['Force', 'Underworld'], keywords: [{ name: 'Overwhelm' }], unique: true }),
  LAW_074: card({ id: 'LAW_074', name: 'Maz Kanata', arena: 'ground', cost: 5, power: 4, hp: 4, traits: ['Underworld'], unique: true }),
  LAW_119: card({ id: 'LAW_119', name: 'Rogue One', arena: 'space', cost: 3, power: 3, hp: 3, traits: ['Rebel', 'Vehicle', 'Transport'], unique: true }),
  TWI_102: card({ id: 'TWI_102', name: 'Manufactured Soldiers', type: 'event', cost: 3, aspects: ['Command', 'Command'], traits: ['Supply'] }),
  LOF_096: card({ id: 'LOF_096', name: 'Obi-Wan Kenobi', arena: 'ground', cost: 3, power: 3, hp: 5, traits: ['Force', 'Jedi', 'Republic'], unique: true }),
  SHD_014: card({ id: 'SHD_014', name: 'Cad Bane', type: 'leader', arena: 'ground', cost: 6, power: 2, hp: 8, traits: ['Underworld', 'Bounty Hunter'] }),
  SHD_205: card({ id: 'SHD_205', name: 'Let the Wookiee Win', type: 'event', cost: 2, aspects: ['Cunning', 'Heroism'], traits: ['Trick'] }),
  TWI_246: card({ id: 'TWI_246', name: 'Tranquility', arena: 'space', cost: 7, power: 7, hp: 6, aspects: ['Heroism'], traits: ['Republic', 'Vehicle', 'Capital Ship'], unique: true }),
  SOR_016: card({ id: 'SOR_016', name: 'Grand Admiral Thrawn', type: 'leader', arena: 'ground', cost: 6, power: 3, hp: 9, traits: ['Imperial', 'Official'] }),
  LOF_117: card({ id: 'LOF_117', name: 'Sifo-Dyas', arena: 'ground', cost: 5, power: 4, hp: 4, traits: ['Force', 'Jedi', 'Republic'], unique: true }),
  TS26_26: card({ id: 'TS26_26', name: 'Mother Talzin', arena: 'ground', cost: 5, power: 5, hp: 4, traits: ['Force', 'Night'], unique: true }),
  // Props
  UWC: card({ id: 'UWC', arena: 'ground', cost: 1, power: 1, hp: 3, traits: ['Underworld'] }),
  WOOK: card({ id: 'WOOK', arena: 'ground', cost: 2, power: 2, hp: 4, traits: ['Wookiee'] }),
  REP: card({ id: 'REP', arena: 'ground', cost: 2, power: 2, hp: 2, traits: ['Republic'] }),
  CL1: card({ id: 'CL1', arena: 'ground', cost: 1, power: 1, hp: 1, traits: ['Clone'] }),
  CL2: card({ id: 'CL2', arena: 'ground', cost: 2, power: 2, hp: 2, traits: ['Clone'] }),
  CL3: card({ id: 'CL3', arena: 'ground', cost: 3, power: 3, hp: 3, traits: ['Clone'] }),
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 1, power: 1, hp: 1 }),
  GRD: card({ id: 'GRD', arena: 'ground', cost: 2, power: 2, hp: 6 }),
  SMALL: card({ id: 'SMALL', arena: 'ground', cost: 1, power: 1, hp: 1 }),
  BIG: card({ id: 'BIG', arena: 'ground', cost: 4, power: 9, hp: 12 }),
  UNIQ: card({ id: 'UNIQ', arena: 'ground', cost: 2, power: 2, hp: 2, unique: true }),
  BH: card({ id: 'BH', arena: 'ground', cost: 2, power: 2, hp: 3, traits: ['Bounty Hunter'] }),
  KWU: card({ id: 'KWU', arena: 'ground', cost: 2, power: 2, hp: 3, keywords: [{ name: 'Sentinel' }] }),
  FORCE: card({ id: 'FORCE', arena: 'ground', cost: 2, power: 2, hp: 3, traits: ['Force'] }),
  UW: card({ id: 'UW', arena: 'ground', cost: 6, power: 5, hp: 5, traits: ['Underworld'] }),
  AGGEV: card({ id: 'AGGEV', type: 'event', cost: 0, aspects: ['Aggression'] }),
}

const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
type Side = Parameters<typeof player>[0]
const board = (mine: Side = {}, theirs: Side = {}) => state({
  cards: F,
  players: {
    player: player({ resources: ready(10), deck: [], ...mine }),
    opponent: player({ resources: ready(10), deck: [], ...theirs }),
  },
})
const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)
const choice = (s: GameState): PendingChoice => {
  expect(s.pendingChoices?.length ?? 0, 'a choice is raised').toBeGreaterThan(0)
  return s.pendingChoices![0]
}
const noChoice = (s: GameState) => expect(s.pendingChoices ?? [], 'no choice is raised').toHaveLength(0)
type Extra = { targetInstanceId?: string; optionIndex?: number; deckIndex?: number; baseTarget?: PlayerId; handIndex?: number }
const accept = (s: GameState, extra: Extra = {}) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const targetsOf = (c: PendingChoice): string[] => ('targets' in c ? [...(c.targets as string[])] : 'unitTargets' in c ? [...(c.unitTargets as string[])] : []).sort()
const playUnit = (s: GameState, handIndex = 0) => resolve({ ...s, activePlayer: 'player' }, { type: 'playUnit', handIndex })
const playEvent = (s: GameState, handIndex = 0) => resolve({ ...s, activePlayer: 'player' }, { type: 'playEvent', handIndex })
const attackBase = (s: GameState, attackerId: string) =>
  resolve({ ...s, activePlayer: 'player' }, { type: 'attack', attackerId, target: { kind: 'base' } })
const attackUnit = (s: GameState, attackerId: string, defenderId: string, who: PlayerId = 'player') =>
  resolve({ ...s, activePlayer: who }, { type: 'attack', attackerId, target: { kind: 'unit', instanceId: defenderId } })
const leader = (cardId: string, deployed = false) => ({ leader: { cardId, deployed, epicActionUsed: deployed, exhausted: false } })

// ── Triggers on "when you play" ──────────────────────────────────────────────────────────────────

describe('TWI_101 Mas Amedda', () => {
  it('may exhaust itself when another unit is played to search the top 4 for a unit and draw it', () => {
    const s = playUnit(board({ units: [unit('m', 'TWI_101')], hand: ['GRD'], deck: ['AGGEV', 'BH', 'UPG', 'SMALL', 'UW'] }))
    expect(choice(s).kind).toBe('mayPayThen')
    const searched = accept(s)
    expect(U(searched, 'm')!.exhausted).toBe(true)
    const c = choice(searched)
    expect(c.kind === 'searchDraw' ? c.eligibleIndices : [], 'units in the top 4 only').toEqual([1, 3])
    expect(accept(searched, { deckIndex: 1 }).players.player.hand).toEqual(['BH'])
  })

  it('offers nothing while it is exhausted', () => {
    noChoice(playUnit(board({ units: [unit('m', 'TWI_101', { exhausted: true })], hand: ['GRD'], deck: ['BH'] })))
  })
})

describe('TWI_018 Quinlan Vos', () => {
  const enemies = { units: [unit('e1', 'SMALL'), unit('e2', 'GRD'), unit('e4', 'BIG')] }

  it('front: may exhaust the leader to deal 1 damage to an enemy unit that costs the same as the played unit', () => {
    const s = playUnit(board({ ...leader('TWI_018'), hand: ['GRD'] }, enemies))
    expect(targetsOf(choice(s))).toEqual(['e2'])
    const dealt = accept(s, { targetInstanceId: 'e2' })
    expect(U(dealt, 'e2')!.damage).toBe(1)
    expect(dealt.players.player.leader.exhausted).toBe(true)
  })

  it('front: offers nothing while the leader is exhausted', () => {
    const s = board({ leader: { cardId: 'TWI_018', deployed: false, epicActionUsed: false, exhausted: true }, hand: ['GRD'] }, enemies)
    noChoice(playUnit(s))
  })

  it('back: may deal 1 damage to an enemy unit that costs the same as or less than the played unit', () => {
    const s = playUnit(board({ ...leader('TWI_018', true), units: [unit('L', 'TWI_018', { isLeader: true })], hand: ['GRD'] }, enemies))
    expect(targetsOf(choice(s))).toEqual(['e1', 'e2'])
    const dealt = accept(s, { targetInstanceId: 'e1' })
    expect(U(dealt, 'e1')).toBeUndefined()
    expect(U(dealt, 'L')!.exhausted).toBe(false)
  })
})

describe('SHD_008 Boba Fett', () => {
  it('front: playing a unit with a keyword may exhaust the leader to give a friendly unit +1/+0 for the phase', () => {
    const s = playUnit(board({ ...leader('SHD_008'), units: [unit('g', 'GRD')], hand: ['KWU'] }))
    expect(choice(s).kind).toBe('mayPayThen')
    const paid = accept(s)
    expect(paid.players.player.leader.exhausted).toBe(true)
    const buffed = accept(paid, { targetInstanceId: 'g' })
    expect(effectivePower(buffed, U(buffed, 'g')!)).toBe(3)
  })

  it('front: playing a unit with no keywords offers nothing', () => {
    noChoice(playUnit(board({ ...leader('SHD_008'), hand: ['GRD'] })))
  })

  it('back: each other friendly unit with a keyword gets +1/+0', () => {
    const s = board({ ...leader('SHD_008', true), units: [unit('L', 'SHD_008', { isLeader: true }), unit('k', 'KWU'), unit('g', 'GRD')] }, { units: [unit('ek', 'KWU')] })
    expect(effectivePower(s, U(s, 'k')!)).toBe(3)
    expect(effectivePower(s, U(s, 'g')!)).toBe(2)
    expect(effectivePower(s, U(s, 'ek')!), 'friendly units only').toBe(2)
  })
})

describe('SOR_143 Fighters For Freedom', () => {
  it('may deal 1 damage to a base when another Aggression card is played', () => {
    const s = playEvent(board({ units: [unit('f', 'SOR_143')], hand: ['AGGEV'] }))
    const c = choice(s)
    expect(c.kind === 'selectDamageTarget' ? [...c.baseTargets].sort() : []).toEqual(['opponent', 'player'])
    expect(accept(s, { baseTarget: 'opponent' }).players.opponent.base.damage).toBe(1)
  })

  it('does not hear its own play, but a second copy hears the first', () => {
    noChoice(playUnit(board({ hand: ['SOR_143'] })))
    const s = playUnit(board({ units: [unit('f', 'SOR_143')], hand: ['SOR_143'] }))
    expect(s.pendingChoices?.filter(c => c.kind === 'selectDamageTarget')).toHaveLength(1)
  })

  it('ignores a card without Aggression', () => {
    noChoice(playUnit(board({ units: [unit('f', 'SOR_143')], hand: ['GRD'] })))
  })
})

describe('SHD_239 Toro Calican', () => {
  it('may deal 1 damage to another Bounty Hunter as it is played, readying itself, once each round', () => {
    const s = playUnit(board({ units: [unit('t', 'SHD_239', { exhausted: true })], hand: ['BH', 'BH'] }))
    expect(choice(s).kind).toBe('mayPayThen')
    const done = accept(s)
    const bh = done.players.player.units.find(u => u.cardId === 'BH')!
    expect(bh.damage).toBe(1)
    expect(U(done, 't')!.exhausted).toBe(false)
    noChoice(playUnit(done))
  })

  it('a declined offer leaves the round unspent, and a non-Bounty Hunter offers nothing', () => {
    const declined = skip(playUnit(board({ units: [unit('t', 'SHD_239')], hand: ['BH', 'GRD', 'BH'] })))
    noChoice(playUnit(declined))
    expect(choice(playUnit(declined, 1)).kind).toBe('mayPayThen')
  })
})

// ── Triggers on a defeat ─────────────────────────────────────────────────────────────────────────

describe('SOR_115 Agent Kallus', () => {
  it('may draw when another unique unit is defeated, friendly or enemy, once each round', () => {
    const s = board({ units: [unit('k', 'SOR_115'), unit('b1', 'BIG'), unit('b2', 'BIG')], deck: ['GRD', 'GRD'] }, { units: [unit('u1', 'UNIQ'), unit('u2', 'UNIQ')] })
    const hit = attackUnit(s, 'b1', 'u1')
    expect(choice(hit).kind).toBe('mayPayThen')
    const drew = accept(hit)
    expect(drew.players.player.hand).toEqual(['GRD'])
    noChoice(attackUnit(drew, 'b2', 'u2'))
  })

  it('hears a friendly unique unit, and not a non-unique one', () => {
    const s = board({ units: [unit('k', 'SOR_115'), unit('u', 'UNIQ'), unit('g', 'GRD')], deck: ['GRD'] }, { units: [unit('e', 'BIG')] })
    expect(choice(attackUnit(s, 'u', 'e')).kind).toBe('mayPayThen')
    noChoice(attackUnit(s, 'g', 'e'))
  })
})

describe('SHD_137 Punishing One', () => {
  it('may ready itself when an upgraded enemy unit is defeated, once each round', () => {
    const upgraded = (id: string) => unit(id, 'GRD', { upgrades: [{ cardId: 'UPG', owner: 'opponent' }] })
    const s = board({ units: [unit('p', 'SHD_137', { exhausted: true }), unit('b1', 'BIG'), unit('b2', 'BIG')] }, { units: [upgraded('e1'), upgraded('e2')] })
    const hit = attackUnit(s, 'b1', 'e1')
    const readied = accept(hit)
    expect(U(readied, 'p')!.exhausted).toBe(false)
    noChoice(attackUnit({ ...readied, players: { ...readied.players, player: { ...readied.players.player, units: readied.players.player.units.map(u => (u.instanceId === 'p' ? { ...u, exhausted: true } : u)) } } }, 'b2', 'e2'))
  })

  it('ignores an enemy unit with no upgrades', () => {
    noChoice(attackUnit(board({ units: [unit('p', 'SHD_137', { exhausted: true }), unit('b', 'BIG')] }, { units: [unit('e', 'GRD')] }), 'b', 'e'))
  })
})

describe('LAW_119 Rogue One', () => {
  const dying = (deck: string[]) => attackUnit(board({ units: [unit('r', 'LAW_119'), unit('g', 'SMALL')], deck }, { units: [unit('e', 'BIG')] }), 'g', 'e')

  it('looks at the top 2 when a friendly unit is defeated and may put any of them on the bottom', () => {
    const s = dying(['GRD', 'BH', 'UW'])
    const c = choice(s)
    expect(c.kind === 'selectCardThen' ? c.candidates : []).toEqual(['GRD', 'BH'])
    const once = accept(s, { optionIndex: 0 })
    expect(once.players.player.deck).toEqual(['BH', 'UW', 'GRD'])
    const twice = accept(once, { optionIndex: 0 })
    expect(twice.players.player.deck).toEqual(['UW', 'GRD', 'BH'])
    noChoice(twice)
  })

  it('keeping both on top lets the player choose which comes first', () => {
    const kept = skip(dying(['GRD', 'BH', 'UW']))
    const c = choice(kept)
    expect(c.kind === 'selectCardThen' ? c.candidates : []).toEqual(['GRD', 'BH'])
    expect(accept(kept, { optionIndex: 1 }).players.player.deck).toEqual(['BH', 'GRD', 'UW'])
  })
})

// ── Triggers at the end of an attack ─────────────────────────────────────────────────────────────

describe('LAW_088 Anakin Skywalker', () => {
  it("may return a friendly unit to hand when its attack ends if no other unit attacked this phase, healing 2 from the base", () => {
    const s = board({ units: [unit('a', 'LAW_088'), unit('g', 'GRD')], base: { cardId: 'TST_B', damage: 5 } })
    const swung = attackBase(s, 'g')
    expect(choice(swung).kind).toBe('mayPayThen')
    const back = accept(swung)
    expect(U(back, 'g')).toBeUndefined()
    expect(back.players.player.hand).toEqual(['GRD'])
    expect(back.players.player.base.damage).toBe(3)
  })

  it('offers nothing once another unit has attacked this phase', () => {
    const s = board({ units: [unit('a', 'LAW_088'), unit('g', 'GRD'), unit('h', 'GRD')] })
    const first = skip(attackBase(s, 'h'))
    noChoice(attackBase(first, 'g'))
  })
})

describe("LAW_033 Hound's Tooth", () => {
  it('may defeat a unit with less power than itself when it survives its attack', () => {
    const s = board({ units: [unit('h', 'LAW_033'), unit('m', 'SMALL')] }, { units: [unit('g', 'GRD'), unit('b', 'BIG')] })
    const swung = attackBase(s, 'h')
    expect(targetsOf(choice(swung))).toEqual(['g', 'm'])
    expect(U(accept(swung, { targetInstanceId: 'g' }), 'g')).toBeUndefined()
  })

  it('offers nothing when it did not survive', () => {
    const s = board({ units: [unit('h', 'LAW_033', { damage: 7 })] }, { units: [unit('g', 'GRD'), unit('b', 'BIG')] })
    noChoice(attackUnit(s, 'h', 'b'))
  })
})

describe('LAW_054 Maul', () => {
  it("may take control of a non-leader unit of the player whose base it damaged, until he leaves play", () => {
    const s = board({ units: [unit('m', 'LAW_054')] }, { units: [unit('g', 'GRD'), unit('L', 'TST_L', { isLeader: true })] })
    const swung = attackBase(s, 'm')
    expect(targetsOf(choice(swung))).toEqual(['g'])
    const taken = accept(swung, { targetInstanceId: 'g' })
    const g = taken.players.player.units.find(u => u.instanceId === 'g')
    expect(g?.controlUntil).toBe('m')
  })

  it('offers nothing when no combat damage reached a base', () => {
    noChoice(attackUnit(board({ units: [unit('m', 'LAW_054')] }, { units: [unit('b', 'BIG')] }), 'm', 'b'))
  })
})

describe('LAW_074 Maz Kanata', () => {
  it('searches the top 5 for an Underworld unit when she survives her attack and plays it for 4 less, ready, until the regroup phase', () => {
    const s = attackBase(board({ units: [unit('z', 'LAW_074')], resources: ready(2), deck: ['GRD', 'UW', 'BH'] }), 'z')
    const c = choice(s)
    expect(c).toMatchObject({ kind: 'searchPlayFree', costDelta: -4, entersReady: true })
    expect(c.kind === 'searchPlayFree' ? c.eligibleIndices : []).toEqual([1])
    const played = accept(s, { deckIndex: 1 })
    const uw = played.players.player.units.find(u => u.cardId === 'UW')!
    expect(uw.exhausted).toBe(false)
    const regroup = resolve(resolve({ ...played, activePlayer: 'player' }, { type: 'pass' }), { type: 'pass' })
    expect(U(regroup, uw.instanceId)).toBeUndefined()
    expect(regroup.players.player.deck.at(-1)).toBe('UW')
  })
})

// ── When Played ──────────────────────────────────────────────────────────────────────────────────

describe('TWI_102 Manufactured Soldiers', () => {
  it('creates 2 Clone Troopers or 3 Battle Droids', () => {
    const s = playEvent(board({ hand: ['TWI_102'] }))
    expect(choice(s).kind).toBe('chooseMode')
    const clones = accept(s, { optionIndex: 0 }).players.player.units.map(u => u.cardId)
    expect(clones).toEqual([TOKEN_CLONE_TROOPER, TOKEN_CLONE_TROOPER])
    const droids = accept(s, { optionIndex: 1 }).players.player.units.map(u => u.cardId)
    expect(droids).toEqual([TOKEN_BATTLE_DROID, TOKEN_BATTLE_DROID, TOKEN_BATTLE_DROID])
  })
})

describe('LOF_096 Obi-Wan Kenobi', () => {
  it('does not print Sentinel: the source parses it out of his ability', () => {
    expect(CARD_DATA_CORRECTIONS.LOF_096?.keywords).toEqual([])
  })

  it('gains Sentinel for the phase when he is played, and when another Force unit is played', () => {
    const own = playUnit(board({ hand: ['LOF_096'] }))
    expect(unitHasKeyword(own, own.players.player.units[0], 'Sentinel')).toBe(true)
    const s = board({ units: [unit('o', 'LOF_096')], hand: ['GRD', 'FORCE'] })
    expect(unitHasKeyword(playUnit(s), U(playUnit(s), 'o')!, 'Sentinel')).toBe(false)
    const forced = playUnit(s, 1)
    expect(unitHasKeyword(forced, U(forced, 'o')!, 'Sentinel')).toBe(true)
  })
})

// ── An opponent chooses ──────────────────────────────────────────────────────────────────────────

describe('SHD_014 Cad Bane', () => {
  const theirs = { units: [unit('e', 'GRD'), unit('f', 'GRD')] }

  it('front: playing an Underworld card may exhaust the leader; an opponent chooses one of their units to take 1 damage', () => {
    const s = playUnit(board({ ...leader('SHD_014'), hand: ['UWC'] }, theirs))
    expect(choice(s)).toMatchObject({ kind: 'mayPayThen', controller: 'player' })
    const paid = accept(s)
    expect(paid.players.player.leader.exhausted).toBe(true)
    expect(choice(paid).controller).toBe('opponent')
    expect(targetsOf(choice(paid))).toEqual(['e', 'f'])
    expect(U(accept(paid, { targetInstanceId: 'f' }), 'f')!.damage).toBe(1)
  })

  it('front: a card without Underworld offers nothing', () => {
    noChoice(playUnit(board({ ...leader('SHD_014'), hand: ['GRD'] }, theirs)))
  })

  it('back: deals 2 to the unit the opponent chooses, once each round', () => {
    const s = playUnit(board({ ...leader('SHD_014', true), units: [unit('L', 'SHD_014', { isLeader: true })], hand: ['UWC', 'UWC'] }, theirs))
    const dealt = accept(accept(s), { targetInstanceId: 'e' })
    expect(U(dealt, 'e')!.damage).toBe(2)
    expect(U(dealt, 'L')!.exhausted).toBe(false)
    noChoice(playUnit(dealt))
  })
})

describe('SHD_205 Let the Wookiee Win', () => {
  // 4 ready pay for the event (2, and 2 for the Cunning penalty); none are left ready.
  const tired = [...ready(4), ...ready(6).map(r => ({ ...r, exhausted: true }))]

  it('an opponent chooses: the player readies up to 6 resources', () => {
    const s = playEvent(board({ hand: ['SHD_205'], resources: tired }))
    expect(choice(s)).toMatchObject({ kind: 'chooseMode', controller: 'opponent' })
    const readied = accept(s, { optionIndex: 0 })
    expect(readied.players.player.resources.filter(r => !r.exhausted)).toHaveLength(6)
  })

  it('or the player readies a friendly unit, and a Wookiee attacks at +2/+0', () => {
    const s = playEvent(board({ hand: ['SHD_205'], units: [unit('w', 'WOOK', { exhausted: true }), unit('g', 'GRD', { exhausted: true })] }))
    const pick = accept(s, { optionIndex: 1 })
    expect(choice(pick).controller).toBe('player')
    expect(targetsOf(choice(pick))).toEqual(['g', 'w'])
    const wook = accept(pick, { targetInstanceId: 'w' })
    expect(U(wook, 'w')!.exhausted).toBe(false)
    const offer = choice(wook)
    expect(offer.kind).toBe('mayAttackAnyUnit')
    const grant = offer.kind === 'mayAttackAnyUnit' ? offer.grantCardId : undefined
    expect(getCardDefinition(grant!)!.statModifier!(wook, U(wook, 'w')!, { attacking: true })).toEqual({ power: 2 })
    const plain = accept(pick, { targetInstanceId: 'g' })
    expect(U(plain, 'g')!.exhausted).toBe(false)
    noChoice(plain)
  })
})

// ── The rest ─────────────────────────────────────────────────────────────────────────────────────

describe('TWI_246 Tranquility', () => {
  it('may return a Republic unit from the discard pile when played', () => {
    const s = playUnit(board({ hand: ['TWI_246'], discard: ['GRD', 'REP'] }))
    const c = choice(s)
    expect(c.kind === 'selectFromDiscard' ? c.candidates : []).toEqual(['REP'])
    expect(accept(s, { optionIndex: 0 }).players.player.hand).toEqual(['REP'])
  })

  it('on attack, each of the next 3 Republic cards played this phase costs 1 less', () => {
    let s = attackBase(board({ units: [unit('t', 'TWI_246')], hand: ['REP', 'GRD', 'REP', 'REP', 'REP'] }), 't')
    const spent = (before: GameState, after: GameState) =>
      before.players.player.resources.filter(r => !r.exhausted).length - after.players.player.resources.filter(r => !r.exhausted).length
    const costs: number[] = []
    for (let i = 0; i < 5; i++) {
      const next = playUnit(s, 0)
      costs.push(spent(s, next))
      s = next
    }
    expect(costs, 'Republic, non-Republic, then Republic until the three are spent').toEqual([1, 2, 1, 1, 2])
  })
})

describe('SOR_016 Grand Admiral Thrawn', () => {
  it('front action: reveal the top card of a deck and exhaust a unit that costs the same or less', () => {
    const s = board({ ...leader('SOR_016'), units: [unit('g', 'GRD')] }, { deck: ['GRD'], units: [unit('m', 'SMALL'), unit('b', 'BIG')] })
    const used = resolve(s, { type: 'useLeaderAbility', index: 0 })
    expect(choice(used).kind).toBe('choosePlayerThen')
    const revealed = accept(used, { optionIndex: 0 })
    expect(targetsOf(choice(revealed)), 'costs 2 or less').toEqual(['g', 'm'])
    const done = accept(revealed, { targetInstanceId: 'm' })
    expect(U(done, 'm')!.exhausted).toBe(true)
    expect(done.players.player.leader.exhausted).toBe(true)
    expect(done.players.player.resources.filter(r => r.exhausted)).toHaveLength(1)
  })

  it('back: on attack may reveal the top card of a deck and exhaust a unit that costs the same or less', () => {
    const s = board({ ...leader('SOR_016', true), units: [unit('L', 'SOR_016', { isLeader: true })], deck: ['SMALL'] }, { units: [unit('m', 'SMALL'), unit('g', 'GRD')] })
    const swung = attackBase(s, 'L')
    expect(choice(swung)).toMatchObject({ kind: 'choosePlayerThen', optional: true })
    const revealed = accept(swung, { optionIndex: 1 })
    expect(targetsOf(choice(revealed))).toEqual(['m'])
  })
})

describe('LOF_117 Sifo-Dyas', () => {
  it('when defeated, discards Clone units of combined cost 4 or less from the top 8, free to play from the discard this phase', () => {
    const s = attackUnit(board({ units: [unit('s', 'LOF_117')], deck: ['CL1', 'GRD', 'CL3', 'CL2'], resources: ready(0) }, { units: [unit('b', 'BIG')] }), 's', 'b')
    const first = choice(s)
    expect(first.kind === 'selectCardThen' ? first.candidates : []).toEqual(['CL1', 'CL3', 'CL2'])
    const picked = accept(s, { optionIndex: 1 })
    const second = choice(picked)
    expect(second.kind === 'selectCardThen' ? second.candidates : [], 'only what still fits under 4').toEqual(['CL1'])
    const done = accept(picked, { optionIndex: 0 })
    noChoice(done)
    expect(done.players.player.discard).toEqual(expect.arrayContaining(['CL3', 'CL1']))
    expect([...done.players.player.deck].sort()).toEqual(['CL2', 'GRD'])
    expect(done.discardPlayGrants?.map(g => [g.cardId, g.free])).toEqual([['CL3', true], ['CL1', true]])
    const played = resolve({ ...done, activePlayer: 'player' }, { type: 'playFromDiscard', grantIndex: 0 })
    expect(played.players.player.units.map(u => u.cardId)).toContain('CL3')
  })
})

describe('TS26_26 Mother Talzin', () => {
  it("when defeated, discards a card from an opponent's hand; they draw; a unit may be played from their discard this phase", () => {
    const s = attackUnit(board({ units: [unit('t', 'TS26_26')] }, { units: [unit('b', 'BIG')], hand: ['AGGEV', 'GRD'], deck: ['SMALL'] }), 't', 'b')
    expect(choice(s)).toMatchObject({ kind: 'lookAtHand', target: 'opponent' })
    const done = accept(s, { handIndex: 1 })
    expect(done.players.opponent.discard).toContain('GRD')
    expect(done.players.opponent.hand).toEqual(['AGGEV', 'SMALL'])
    expect(done.discardPlayGrants).toEqual([expect.objectContaining({ player: 'player', owner: 'opponent', cardId: 'GRD', waive: { all: true } })])
  })

  it('an event discarded this way grants nothing', () => {
    const s = attackUnit(board({ units: [unit('t', 'TS26_26')] }, { units: [unit('b', 'BIG')], hand: ['AGGEV'], deck: ['SMALL'] }), 't', 'b')
    expect(accept(s, { handIndex: 0 }).discardPlayGrants ?? []).toEqual([])
  })
})
