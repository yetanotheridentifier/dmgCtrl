import { describe, it, expect } from 'vitest'
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import { resolve } from '../engine/resolve'
import { legalMoves, effectiveCost } from '../engine/legalMoves'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { TOKEN_ADVANTAGE, TOKEN_SHIELD } from '../engine/tokenUpgrades'
import { TOKEN_MANDALORIAN } from '../engine/tokenUnits'
import type { GameState, PlayerState } from '../engine/types'

/**
 * Group D (#355): "When Played" effects. Most reuse existing effect primitives. Tests play the unit
 * through the real `playCard` path and assert the resulting board.
 */

const D = {
  ...CARDS,
  ASH_218: card({ id: 'ASH_218', type: 'unit', arena: 'ground', power: 1, hp: 5 }), // Ferry Droid
  ASH_251: card({ id: 'ASH_251', type: 'unit', arena: 'ground', power: 2, hp: 3 }), // Zealous Soldier
  ASH_178: card({ id: 'ASH_178', type: 'unit', arena: 'ground', power: 5, hp: 7, keywords: [{ name: 'Hidden' }] }), // Knobby White Ice Spider
  ASH_221: card({ id: 'ASH_221', type: 'unit', arena: 'space', power: 3, hp: 3 }), // Helix Starfighter
  ASH_111: card({ id: 'ASH_111', type: 'unit', arena: 'ground', power: 3, hp: 3 }), // Children of the Watch
  ASH_124: card({ id: 'ASH_124', type: 'unit', arena: 'space', power: 2, hp: 1 }), // Protectorate Fighter
  ASH_065: card({ id: 'ASH_065', type: 'unit', arena: 'space', power: 7, hp: 10, keywords: [{ name: 'Sentinel' }] }), // Home One
  ASH_064: card({ id: 'ASH_064', type: 'unit', arena: 'ground', power: 5, hp: 5, keywords: [{ name: 'Shielded' }] }), // The Armorer
  GRUNT: card({ id: 'GRUNT', type: 'unit', arena: 'ground', power: 2, hp: 2 }),
  SPACER: card({ id: 'SPACER', type: 'unit', arena: 'space', power: 2, hp: 2 }),
  UNIQUE_U: card({ id: 'UNIQUE_U', type: 'unit', arena: 'ground', power: 2, hp: 2, unique: true }),
  SHIELDED_U: card({ id: 'SHIELDED_U', type: 'unit', arena: 'ground', power: 2, hp: 2, keywords: [{ name: 'Shielded' }] }),
  // D2
  ASH_259: card({ id: 'ASH_259', type: 'unit', arena: 'ground', power: 1, hp: 1 }), // LEP Ratcatcher
  ASH_170: card({ id: 'ASH_170', type: 'unit', arena: 'ground', power: 3, hp: 3 }), // Desert Sharpshooter
  ASH_174: card({ id: 'ASH_174', type: 'unit', arena: 'space', power: 3, hp: 3 }), // StarFortress Heavy Bomber
  ASH_081: card({ id: 'ASH_081', type: 'unit', arena: 'space', power: 3, hp: 6 }), // Nebulon-C Frigate (arena corrected to space)
  ASH_051: card({ id: 'ASH_051', type: 'unit', arena: 'space', power: 5, hp: 5, keywords: [{ name: 'Restore', value: 1 }] }), // Reinforcing Light Cruiser
  ASH_214: card({ id: 'ASH_214', type: 'unit', arena: 'ground', power: 2, hp: 2 }), // Amnesty Officer
  ASH_238: card({ id: 'ASH_238', type: 'unit', arena: 'ground', power: 2, hp: 3 }), // Attendant Navigator
  ASH_255: card({ id: 'ASH_255', type: 'unit', arena: 'ground', power: 6, hp: 4, keywords: [{ name: 'Hidden' }, { name: 'Saboteur' }] }), // Anakin Skywalker
  ASH_082: card({ id: 'ASH_082', type: 'unit', arena: 'ground', cost: 6, power: 5, hp: 6, keywords: [{ name: 'Grit' }] }), // Trexler Armored Marauder
  ASH_194: card({ id: 'ASH_194', type: 'unit', arena: 'space', power: 4, hp: 3, keywords: [{ name: 'Ambush' }] }), // Snub Fighter Squadron
  ASH_167: card({ id: 'ASH_167', type: 'unit', arena: 'space', power: 2, hp: 1 }), // Flarestar Attack Shuttle
  KW_U: card({ id: 'KW_U', type: 'unit', arena: 'ground', power: 2, hp: 2, keywords: [{ name: 'Sentinel' }] }),
  CHEAP: card({ id: 'CHEAP', type: 'unit', arena: 'ground', cost: 3, power: 2, hp: 2 }),
  EXPENSIVE: card({ id: 'EXPENSIVE', type: 'unit', arena: 'ground', cost: 5, power: 2, hp: 5 }),
  UPG: card({ id: 'UPG', type: 'upgrade', power: 0, hp: 0 }),
  // D3
  ASH_071: card({ id: 'ASH_071', type: 'unit', arena: 'space', power: 2, hp: 3 }), // Battered Haulcraft
  ASH_158: card({ id: 'ASH_158', type: 'unit', arena: 'ground', power: 3, hp: 7, keywords: [{ name: 'Saboteur' }] }), // Han Solo
  ASH_112: card({ id: 'ASH_112', type: 'unit', arena: 'ground', power: 5, hp: 5, keywords: [{ name: 'Restore', value: 1 }] }), // Luke Skywalker
  ASH_176: card({ id: 'ASH_176', type: 'unit', arena: 'ground', power: 4, hp: 6 }), // Imposing Scout Walker
  TOUGH_SPACE: card({ id: 'TOUGH_SPACE', type: 'unit', arena: 'space', power: 1, hp: 4 }),
  // D4 — generalised next-unit grants
  ASH_237: card({ id: 'ASH_237', type: 'unit', arena: 'ground', power: 1, hp: 1, keywords: [{ name: 'Raid', value: 1 }] }), // Mouse Droid
  ASH_248: card({ id: 'ASH_248', type: 'unit', arena: 'ground', power: 2, hp: 3 }), // Neel
  IMP3: card({ id: 'IMP3', type: 'unit', arena: 'ground', cost: 3, power: 2, hp: 2, traits: ['Imperial'] }),
  NONIMP3: card({ id: 'NONIMP3', type: 'unit', arena: 'ground', cost: 3, power: 2, hp: 2 }),
  LOWPOW: card({ id: 'LOWPOW', type: 'unit', arena: 'ground', cost: 2, power: 1, hp: 3 }),
  // Phase 2 — multi-target pick
  ASH_205: card({ id: 'ASH_205', type: 'unit', arena: 'ground', power: 3, hp: 3 }), // Inspiring Veteran
  ASH_053: card({ id: 'ASH_053', type: 'unit', arena: 'ground', power: 6, hp: 6 }), // Pre Vizsla
}
const accept = (s: GameState, targetInstanceId?: string) => resolve(s, { type: 'acceptChoice', choiceId: s.pendingChoices![0].id, targetInstanceId })
const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)!

/** Play `cardId` from hand and return the resulting state (ample resources; no aspect penalties). */
const play = (cardId: string, pl: Partial<PlayerState> = {}, opp: Partial<PlayerState> = {}): GameState =>
  resolve(state({ cards: D, players: { player: player({ hand: [cardId], resources: ready(15), ...pl }), opponent: player(opp) } }), { type: 'playCard', handIndex: 0 })
const played = (s: GameState, cardId: string) => s.players.player.units.find(u => u.cardId === cardId)!
const advs = (u: { upgrades: { cardId: string }[] }) => u.upgrades.filter(a => a.cardId === TOKEN_ADVANTAGE).length
const shields = (u: { upgrades: { cardId: string }[] }) => u.upgrades.filter(a => a.cardId === TOKEN_SHIELD).length

describe('Group D1 — When Played, self / no-target (#355)', () => {
  it('Ferry Droid (218): 4 Advantage tokens to itself', () => {
    expect(advs(played(play('ASH_218'), 'ASH_218'))).toBe(4)
  })

  it('Zealous Soldier (251): 1 Advantage token to itself', () => {
    expect(advs(played(play('ASH_251'), 'ASH_251'))).toBe(1)
  })

  it('Knobby White Ice Spider (178): 1 Advantage to itself per enemy unit', () => {
    const s = play('ASH_178', {}, { units: [unit('e1', 'GRUNT'), unit('e2', 'GRUNT'), unit('e3', 'SPACER')] })
    expect(advs(played(s, 'ASH_178'))).toBe(3)
    expect(advs(played(play('ASH_178'), 'ASH_178'))).toBe(0) // no enemies → none
  })

  it('Helix Starfighter (221): a Shield if an opponent controls a space unit, else 2 Advantage', () => {
    const withSpace = play('ASH_221', {}, { units: [unit('e', 'SPACER', { arena: 'space' })] })
    expect(shields(played(withSpace, 'ASH_221'))).toBe(1)
    expect(advs(played(withSpace, 'ASH_221'))).toBe(0)
    const without = play('ASH_221', {}, { units: [unit('e', 'GRUNT', { arena: 'ground' })] }) // ground only
    expect(advs(played(without, 'ASH_221'))).toBe(2)
    expect(shields(played(without, 'ASH_221'))).toBe(0)
  })

  it('Children of the Watch (111): creates 2 Mandalorian tokens', () => {
    const s = play('ASH_111')
    expect(s.players.player.units.filter(u => u.cardId === TOKEN_MANDALORIAN)).toHaveLength(2)
  })

  it('Protectorate Fighter (124): creates a Mandalorian token only if you control a unique unit', () => {
    const withUnique = play('ASH_124', { units: [unit('u', 'UNIQUE_U')] })
    expect(withUnique.players.player.units.filter(u => u.cardId === TOKEN_MANDALORIAN)).toHaveLength(1)
    const without = play('ASH_124', { units: [unit('g', 'GRUNT')] })
    expect(without.players.player.units.filter(u => u.cardId === TOKEN_MANDALORIAN)).toHaveLength(0)
  })

  it('Home One (065): heals all damage from each friendly unit, not enemies', () => {
    const s = play('ASH_065', { units: [unit('a', 'GRUNT', { damage: 2 }), unit('b', 'GRUNT', { damage: 1 })] }, { units: [unit('e', 'GRUNT', { damage: 2 })] })
    expect(s.players.player.units.find(u => u.instanceId === 'a')!.damage).toBe(0)
    expect(s.players.player.units.find(u => u.instanceId === 'b')!.damage).toBe(0)
    expect(s.players.opponent.units.find(u => u.instanceId === 'e')!.damage).toBe(2)
  })

  it('The Armorer (064): gives a Shield to each friendly Shielded unit (including herself)', () => {
    const s = play('ASH_064', { units: [unit('sh', 'SHIELDED_U'), unit('pl', 'GRUNT')] })
    expect(shields(s.players.player.units.find(u => u.instanceId === 'sh')!)).toBe(1) // Shielded friendly
    expect(shields(s.players.player.units.find(u => u.instanceId === 'pl')!)).toBe(0) // non-Shielded
    expect(shields(played(s, 'ASH_064'))).toBe(2) // her Shielded-on-enter token + the ability's
  })
})

describe('Group D2 — When Played, single target (#355)', () => {
  it('LEP Ratcatcher (259): may deal 1 to a ground unit (or decline)', () => {
    const s = play('ASH_259', { units: [unit('g', 'GRUNT')] }, { units: [unit('e', 'GRUNT'), unit('sp', 'SPACER', { arena: 'space' })] })
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'mayDamage', amount: 1 })
    expect((s.pendingChoices![0] as { targets: string[] }).targets).toEqual(expect.arrayContaining(['g', 'e']))
    expect((s.pendingChoices![0] as { targets: string[] }).targets).not.toContain('sp') // space unit ineligible
    const done = accept(s, 'e')
    expect(U(done, 'e').damage).toBe(1)
  })

  it('Desert Sharpshooter (170): may deal 2 only to an upgraded ground unit', () => {
    const s = play('ASH_170', {}, { units: [unit('up', 'EXPENSIVE', { upgrades: [{ cardId: 'UPG', owner: 'opponent' }] }), unit('bare', 'GRUNT')] })
    expect((s.pendingChoices![0] as { targets: string[] }).targets).toEqual(['up'])
    expect(U(accept(s, 'up'), 'up').damage).toBe(2) // EXPENSIVE has 5 HP → survives
  })

  it('StarFortress Heavy Bomber (174): may deal 6 only to a non-unique ground unit', () => {
    const s = play('ASH_174', {}, { units: [unit('c', 'GRUNT'), unit('u', 'UNIQUE_U')] })
    expect((s.pendingChoices![0] as { targets: string[] }).targets).toEqual(['c'])
  })

  it('Nebulon-C Frigate (081): may heal 3 from a damaged unit or base (optional)', () => {
    const s = play('ASH_081', { units: [unit('d', 'GRUNT', { damage: 3 })] })
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'selectHealTarget', amount: 3 })
    expect(resolve(s, { type: 'skipTrigger', choiceId: s.pendingChoices![0].id }).players.player.units.find(u => u.instanceId === 'd')!.damage).toBe(3) // decline
    expect(accept(s, 'd').players.player.units.find(u => u.instanceId === 'd')!.damage).toBe(0)
  })

  it('Reinforcing Light Cruiser (051): may exhaust a unit', () => {
    const s = play('ASH_051', {}, { units: [unit('e', 'GRUNT')] })
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'mayExhaustUnit' })
    expect(U(accept(s, 'e'), 'e').exhausted).toBe(true)
  })

  it('Amnesty Officer (214): may exhaust only a unit with one or more keywords', () => {
    const s = play('ASH_214', { units: [unit('kw', 'KW_U'), unit('plain', 'GRUNT')] })
    expect((s.pendingChoices![0] as { targets: string[] }).targets).toEqual(['kw'])
  })

  it('Attendant Navigator (238): may give 2 Advantage to a space unit', () => {
    const s = play('ASH_238', {}, { units: [unit('sp', 'SPACER', { arena: 'space' }), unit('gr', 'GRUNT')] })
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'mayGiveTokens', count: 2 })
    expect((s.pendingChoices![0] as { targets: string[] }).targets).toEqual(['sp'])
    expect(advs(U(accept(s, 'sp'), 'sp'))).toBe(2)
  })

  it('Anakin Skywalker (255): gives a Shield to another friendly unit (mandatory, not itself)', () => {
    const s = play('ASH_255', { units: [unit('f', 'GRUNT')] })
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'mayGiveTokens' })
    expect((s.pendingChoices![0] as { targets: string[] }).targets).toEqual(['f']) // another friendly, not Anakin
    expect(legalMoves(s).some(a => a.type === 'skipTrigger')).toBe(false) // mandatory — no decline
    expect(shields(U(accept(s, 'f'), 'f'))).toBe(1)
  })

  it('Trexler Armored Marauder (082): may give a Shield to a unit that costs 3 or less', () => {
    const s = play('ASH_082', {}, { units: [unit('cheap', 'CHEAP'), unit('exp', 'EXPENSIVE')] })
    expect((s.pendingChoices![0] as { targets: string[] }).targets).toEqual(['cheap'])
    expect(shields(U(accept(s, 'cheap'), 'cheap'))).toBe(1)
  })

  it('Snub Fighter Squadron (194): deals 1 to a space unit — mandatory (no decline)', () => {
    const s = play('ASH_194', {}, { units: [unit('sp', 'SPACER', { arena: 'space' })] })
    const dmg = s.pendingChoices!.find(c => c.kind === 'mayDamage')!
    expect(dmg).toBeDefined()
    expect(legalMoves(s).some(a => a.type === 'skipTrigger' && a.choiceId === dmg.id)).toBe(false) // mandatory
    const done = resolve(s, { type: 'acceptChoice', choiceId: dmg.id, targetInstanceId: 'sp' })
    expect(U(done, 'sp').damage).toBe(1)
  })
})

describe('Group D3 — When Played, multi-step (#355)', () => {
  it('Battered Haulcraft (071): deals 1 to itself and 1 to a (mandatory) enemy space unit', () => {
    const s = play('ASH_071', {}, { units: [unit('es', 'TOUGH_SPACE', { arena: 'space' }), unit('eg', 'GRUNT', { arena: 'ground' })] })
    expect(played(s, 'ASH_071').damage).toBe(1) // self-damage
    const dmg = s.pendingChoices!.find(c => c.kind === 'mayDamage')!
    expect((dmg as { targets: string[] }).targets).toEqual(['es']) // only the enemy space unit; mandatory
    expect(legalMoves(s).some(a => a.type === 'skipTrigger' && a.choiceId === dmg.id)).toBe(false)
    expect(U(resolve(s, { type: 'acceptChoice', choiceId: dmg.id, targetInstanceId: 'es' }), 'es').damage).toBe(1)
  })

  it('Han Solo (158): deals 3 to itself and gives 3 Advantage to a chosen unit', () => {
    const s = play('ASH_158', { units: [unit('f', 'GRUNT')] })
    expect(played(s, 'ASH_158').damage).toBe(3)
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'mayGiveTokens', count: 3 })
    expect(advs(U(accept(s, 'f'), 'f'))).toBe(3)
  })

  it('Luke Skywalker (112): deals 3 to each enemy unit only if you control at least 4 units', () => {
    // Luke + 3 others = 4 units. Enemies are tough enough to survive 3 and show the damage.
    const four = play('ASH_112', { units: [unit('a', 'GRUNT'), unit('b', 'GRUNT'), unit('c', 'GRUNT')] }, { units: [unit('e1', 'EXPENSIVE'), unit('e2', 'TOUGH_SPACE', { arena: 'space' })] })
    expect(U(four, 'e1').damage).toBe(3)
    expect(U(four, 'e2').damage).toBe(3)
    const three = play('ASH_112', { units: [unit('a', 'GRUNT'), unit('b', 'GRUNT')] }, { units: [unit('e1', 'EXPENSIVE')] })
    expect(U(three, 'e1').damage).toBe(0) // only 3 units → no area damage
  })

  it('Imposing Scout Walker (176): may deal 3 to a ground unit; if it dies this way, 3 Advantage to itself', () => {
    const kills = play('ASH_176', {}, { units: [unit('weak', 'GRUNT')] }) // GRUNT 2 HP dies to 3
    const done = accept(kills, 'weak')
    expect(done.players.opponent.units.find(u => u.instanceId === 'weak')).toBeUndefined() // defeated
    expect(advs(played(done, 'ASH_176'))).toBe(3) // reward
    const survives = play('ASH_176', {}, { units: [unit('tough', 'EXPENSIVE')] }) // 5 HP survives
    const done2 = accept(survives, 'tough')
    expect(U(done2, 'tough').damage).toBe(3)
    expect(advs(played(done2, 'ASH_176'))).toBe(0) // no reward — not defeated
  })
})

describe('Group D4 — generalised next-unit grants (#355)', () => {
  it('Mouse Droid (237): grants −1 cost to the next Imperial unit', () => {
    expect(play('ASH_237').players.player.nextUnitGrants).toEqual([{ costDelta: -1, trait: 'Imperial' }])
  })

  it('the −1 cost applies to an Imperial unit, not others, and only that unit consumes it', () => {
    const grant = [{ costDelta: -1, trait: 'Imperial' }]
    const s = state({ cards: D, players: { player: player({ nextUnitGrants: grant }), opponent: player() } })
    expect(effectiveCost(s, 'player', D.IMP3)).toBe(2) // 3 − 1
    expect(effectiveCost(s, 'player', D.NONIMP3)).toBe(3) // non-Imperial unchanged
    // a non-Imperial unit played leaves the grant in place; the Imperial unit consumes it
    expect(play('NONIMP3', { nextUnitGrants: grant }).players.player.nextUnitGrants).toEqual(grant)
    expect(play('IMP3', { nextUnitGrants: grant, resources: ready(2) }).players.player.nextUnitGrants).toBeUndefined()
  })

  it('Neel (248): the next unit you play with 1 or less power enters ready; a higher-power one does not', () => {
    expect(play('ASH_248').players.player.nextUnitGrants).toEqual([{ entersReady: true, maxPower: 1 }])
    const grant = [{ entersReady: true, maxPower: 1 }]
    const low = play('LOWPOW', { nextUnitGrants: grant })
    expect(played(low, 'LOWPOW').exhausted).toBe(false) // power 1 → enters ready
    expect(low.players.player.nextUnitGrants).toBeUndefined() // consumed
    const high = play('GRUNT', { nextUnitGrants: grant })
    expect(played(high, 'GRUNT').exhausted).toBe(true) // power 2 → normal (exhausted)
    expect(high.players.player.nextUnitGrants).toEqual(grant) // not consumed
  })
})

describe('Group D Phase 2 — multi-target pick (#355)', () => {
  const pickTargets = (s: GameState) => (s.pendingChoices![0] as { targets: string[] }).targets

  it('Inspiring Veteran (205): an Advantage to each of up to 3 exhausted units (self is exhausted too)', () => {
    const s = play('ASH_205', { units: [unit('a', 'GRUNT', { exhausted: true }), unit('b', 'GRUNT', { exhausted: true })] }, { units: [unit('d', 'GRUNT')] })
    const iv = played(s, 'ASH_205').instanceId // enters exhausted → eligible
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'multiPick' })
    expect(pickTargets(s)).toEqual(expect.arrayContaining(['a', 'b', iv]))
    expect(pickTargets(s)).not.toContain('d') // ready
    let cur = s
    for (const id of ['a', 'b', iv]) cur = resolve(cur, { type: 'acceptChoice', choiceId: cur.pendingChoices![0].id, targetInstanceId: id })
    expect(cur.pendingChoices ?? []).toHaveLength(0) // 3 picked → done
    expect(advs(U(cur, 'a'))).toBe(1)
    expect(advs(U(cur, 'b'))).toBe(1)
  })

  it('Inspiring Veteran: can stop early with Done', () => {
    const s = play('ASH_205', { units: [unit('a', 'GRUNT', { exhausted: true })] })
    const s1 = accept(s, 'a')
    expect(s1.pendingChoices?.[0]).toMatchObject({ kind: 'multiPick' }) // self still eligible
    const done = resolve(s1, { type: 'skipTrigger', choiceId: s1.pendingChoices![0].id })
    expect(done.pendingChoices ?? []).toHaveLength(0)
  })

  it('Pre Vizsla (053): defeats non-leader units up to 6 total remaining HP; a Mando token per defeat', () => {
    const s = play('ASH_053', {}, { units: [unit('a', 'GRUNT'), unit('b', 'GRUNT'), unit('big', 'EXPENSIVE')] }) // GRUNT 2hp, EXPENSIVE 5hp
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'multiPick' })
    expect(pickTargets(s)).toEqual(expect.arrayContaining(['a', 'b', 'big'])) // all ≤ 6 individually
    const s1 = accept(s, 'a') // defeat a (2) → budget 4
    expect(s1.players.opponent.units.find(u => u.instanceId === 'a')).toBeUndefined()
    expect(s1.players.player.units.filter(u => u.cardId === TOKEN_MANDALORIAN)).toHaveLength(1)
    expect(pickTargets(s1)).toEqual(['b']) // big (5) now exceeds the 4 budget
    const s2 = accept(s1, 'b') // defeat b (2) → budget 2, no targets left → done
    expect(s2.pendingChoices ?? []).toHaveLength(0)
    expect(s2.players.player.units.filter(u => u.cardId === TOKEN_MANDALORIAN)).toHaveLength(2)
  })
})
