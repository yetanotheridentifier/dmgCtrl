import { describe, it, expect } from 'vitest'
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import { resolve } from '../engine/resolve'
import { legalMoves, effectiveCost } from '../engine/legalMoves'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { TOKEN_ADVANTAGE, TOKEN_SHIELD } from '../engine/tokenUpgrades'
import { TOKEN_MANDALORIAN } from '../engine/tokenUnits'
import type { GameState, PlayerState } from '../engine/types'

/**
 * "When Played" effects. Most reuse existing effect primitives. Tests play the unit
 * through the real `playUnit` path and assert the resulting board.
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
  // Single-target effects
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
  // Multi-step effects
  ASH_071: card({ id: 'ASH_071', type: 'unit', arena: 'space', power: 2, hp: 3 }), // Battered Haulcraft
  ASH_158: card({ id: 'ASH_158', type: 'unit', arena: 'ground', power: 3, hp: 7, keywords: [{ name: 'Saboteur' }] }), // Han Solo
  ASH_112: card({ id: 'ASH_112', type: 'unit', arena: 'ground', power: 5, hp: 5, keywords: [{ name: 'Restore', value: 1 }] }), // Luke Skywalker
  ASH_176: card({ id: 'ASH_176', type: 'unit', arena: 'ground', power: 4, hp: 6 }), // Imposing Scout Walker
  TOUGH_SPACE: card({ id: 'TOUGH_SPACE', type: 'unit', arena: 'space', power: 1, hp: 4 }),
  // "Next unit you play" grants
  ASH_237: card({ id: 'ASH_237', type: 'unit', arena: 'ground', power: 1, hp: 1, keywords: [{ name: 'Raid', value: 1 }] }), // Mouse Droid
  ASH_248: card({ id: 'ASH_248', type: 'unit', arena: 'ground', power: 2, hp: 3 }), // Neel
  IMP3: card({ id: 'IMP3', type: 'unit', arena: 'ground', cost: 3, power: 2, hp: 2, traits: ['Imperial'] }),
  NONIMP3: card({ id: 'NONIMP3', type: 'unit', arena: 'ground', cost: 3, power: 2, hp: 2 }),
  LOWPOW: card({ id: 'LOWPOW', type: 'unit', arena: 'ground', cost: 2, power: 1, hp: 3 }),
  // Multi-target pick
  ASH_205: card({ id: 'ASH_205', type: 'unit', arena: 'ground', power: 3, hp: 3 }), // Inspiring Veteran
  ASH_053: card({ id: 'ASH_053', type: 'unit', arena: 'ground', power: 6, hp: 6 }), // Pre Vizsla
  // Discard from hand
  ASH_260: card({ id: 'ASH_260', type: 'unit', arena: 'ground', power: 1, hp: 3 }), // Mos Espa Watermonger
  // Opponent discard + distribute damage
  ASH_148: card({ id: 'ASH_148', type: 'unit', arena: 'ground', power: 8, hp: 7, keywords: [{ name: 'Overwhelm' }] }), // Ninth Sister
  COST3: card({ id: 'COST3', type: 'unit', arena: 'ground', cost: 3, power: 2, hp: 2 }),
  COST0: card({ id: 'COST0', type: 'event', cost: 0 }),
  // Look at opponent's hand
  ASH_250: card({ id: 'ASH_250', type: 'unit', arena: 'ground', power: 3, hp: 2 }), // Imperial Defector
  ASH_220: card({ id: 'ASH_220', type: 'unit', arena: 'ground', power: 3, hp: 3 }), // Remnant Lookouts
  DRAWN: card({ id: 'DRAWN', type: 'unit', arena: 'ground', power: 1, hp: 1 }),
  // Search top 5 for a trait match
  ASH_107: card({ id: 'ASH_107', type: 'unit', arena: 'ground', power: 3, hp: 2, traits: ['Mandalorian'] }), // Clan Wren Loyalist
  TRAIT_U: card({ id: 'TRAIT_U', type: 'unit', arena: 'ground', power: 2, hp: 2, traits: ['Rebel'] }),
  REBELCARD: card({ id: 'REBELCARD', type: 'unit', arena: 'ground', traits: ['Rebel'] }),
  MANDOCARD: card({ id: 'MANDOCARD', type: 'unit', arena: 'ground', traits: ['Mandalorian'] }),
  NEUTRAL: card({ id: 'NEUTRAL', type: 'unit', arena: 'ground', traits: ['Jedi'] }),
  EXTRA: card({ id: 'EXTRA', type: 'unit', arena: 'ground', traits: [] }),
  // Play a discounted Heroism unit
  ASH_108: card({ id: 'ASH_108', type: 'unit', arena: 'ground', power: 3, hp: 2, aspects: ['Heroism'] }), // Crix Madine
  HEROUNIT: card({ id: 'HEROUNIT', type: 'unit', arena: 'ground', cost: 5, power: 2, hp: 2, aspects: ['Heroism'] }),
  VILLAINUNIT: card({ id: 'VILLAINUNIT', type: 'unit', arena: 'ground', cost: 3, power: 2, hp: 2, aspects: ['Villainy'] }),
  // Admiral Ackbar: self-defeat + search top 10 for cheap space units, play free
  ASH_110: card({ id: 'ASH_110', type: 'unit', arena: 'ground', power: 6, hp: 6 }), // Admiral Ackbar
  SPACE2: card({ id: 'SPACE2', type: 'unit', arena: 'space', cost: 2, power: 2, hp: 2 }),
  SPACE3: card({ id: 'SPACE3', type: 'unit', arena: 'space', cost: 3, power: 3, hp: 3 }),
  SPACE6: card({ id: 'SPACE6', type: 'unit', arena: 'space', cost: 6, power: 6, hp: 6 }),
  GROUND2: card({ id: 'GROUND2', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 2 }),
  // Name a card
  ASH_077: card({ id: 'ASH_077', type: 'unit', arena: 'ground', power: 2, hp: 5, keywords: [{ name: 'Restore', value: 1 }] }), // Ryder Azadi
  // Modal / variable damage & heal
  ASH_147: card({ id: 'ASH_147', type: 'unit', arena: 'ground', power: 3, hp: 7, keywords: [{ name: 'Grit' }] }), // The Cyborg Mech
  ASH_044: card({ id: 'ASH_044', type: 'unit', arena: 'ground', power: 3, hp: 4 }), // Barriss Offee
  TANK: card({ id: 'TANK', type: 'unit', arena: 'ground', power: 1, hp: 10 }),
  TANKSPACE: card({ id: 'TANKSPACE', type: 'unit', arena: 'space', power: 1, hp: 10 }),
}
const readyCount = (s: GameState) => s.players.player.resources.filter(r => !r.exhausted).length
const accept = (s: GameState, targetInstanceId?: string) => resolve(s, { type: 'acceptChoice', choiceId: s.pendingChoices![0].id, targetInstanceId })
const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)!

/** Play `cardId` from hand and return the resulting state (ample resources; no aspect penalties). */
const play = (cardId: string, pl: Partial<PlayerState> = {}, opp: Partial<PlayerState> = {}): GameState =>
  resolve(state({ cards: D, players: { player: player({ hand: [cardId], resources: ready(15), ...pl }), opponent: player(opp) } }), { type: 'playUnit', handIndex: 0 })
const played = (s: GameState, cardId: string) => s.players.player.units.find(u => u.cardId === cardId)!
const advs = (u: { upgrades: { cardId: string }[] }) => u.upgrades.filter(a => a.cardId === TOKEN_ADVANTAGE).length
const shields = (u: { upgrades: { cardId: string }[] }) => u.upgrades.filter(a => a.cardId === TOKEN_SHIELD).length

describe('When Played — self / no target', () => {
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
    const s = play('ASH_065', { units: [unit('a', 'GRUNT', { damage: 1 }), unit('b', 'GRUNT', { damage: 1 })] }, { units: [unit('e', 'GRUNT', { damage: 1 })] })
    expect(s.players.player.units.find(u => u.instanceId === 'a')!.damage).toBe(0)
    expect(s.players.player.units.find(u => u.instanceId === 'b')!.damage).toBe(0)
    expect(s.players.opponent.units.find(u => u.instanceId === 'e')!.damage).toBe(1) // enemies aren't healed
  })

  it('The Armorer (064): gives a Shield to each friendly Shielded unit (including herself)', () => {
    const s = play('ASH_064', { units: [unit('sh', 'SHIELDED_U'), unit('pl', 'GRUNT')] })
    expect(shields(s.players.player.units.find(u => u.instanceId === 'sh')!)).toBe(1) // Shielded friendly
    expect(shields(s.players.player.units.find(u => u.instanceId === 'pl')!)).toBe(0) // non-Shielded
    expect(shields(played(s, 'ASH_064'))).toBe(2) // her Shielded-on-enter token + the ability's
  })
})

describe('When Played — single target', () => {
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
    const s = play('ASH_081', { units: [unit('d', 'EXPENSIVE', { damage: 3 })] })
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

describe('When Played — multi-step', () => {
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

describe('When Played — "next unit you play" grants', () => {
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

describe('When Played — multi-target pick', () => {
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

describe('When Played — discard from hand (Mos Espa Watermonger)', () => {
  const discard = (s: GameState, handIndex: number) =>
    resolve(s, { type: 'acceptChoice', choiceId: s.pendingChoices![0].id, handIndex })
  const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: s.pendingChoices![0].id })
  // Play Mos Espa with `extraHand` still in hand and `deck` to draw from.
  const setup = (deck: string[], extraHand: string[] = []) =>
    play('ASH_260', { hand: ['ASH_260', ...extraHand], deck })

  it('offers an optional "may draw" when played', () => {
    const s = setup(['GRUNT'], ['SPACER'])
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'mayPayToDraw', cost: 0, draw: 1 })
  })

  it('drawing then forces a discard from hand', () => {
    const s0 = setup(['GRUNT'], ['SPACER']) // hand after play: ['SPACER']; deck ['GRUNT']
    const s1 = accept(s0) // draw GRUNT
    expect(s1.players.player.hand).toEqual(['SPACER', 'GRUNT'])
    expect(s1.pendingChoices?.[0]).toMatchObject({ kind: 'selectDiscard', count: 1 })
    const s2 = discard(s1, 1) // discard the drawn GRUNT
    expect(s2.players.player.hand).toEqual(['SPACER'])
    expect(s2.players.player.discard).toContain('GRUNT')
    expect(s2.pendingChoices ?? []).toHaveLength(0)
  })

  it('every hand card is a legal discard target', () => {
    const s1 = accept(setup(['GRUNT'], ['SPACER', 'CHEAP'])) // hand now [SPACER, CHEAP, GRUNT]
    const picks = legalMoves(s1).filter(a => a.type === 'acceptChoice').map(a => a.handIndex)
    expect(picks.sort()).toEqual([0, 1, 2])
  })

  it('declining the draw skips the discard entirely', () => {
    const s = skip(setup(['GRUNT'], ['SPACER']))
    expect(s.players.player.hand).toEqual(['SPACER']) // no draw, no discard
    expect(s.pendingChoices ?? []).toHaveLength(0)
  })

  it('an empty deck draws nothing, so no discard is forced', () => {
    const s = accept(setup([], ['SPACER']))
    expect(s.players.player.hand).toEqual(['SPACER'])
    expect(s.pendingChoices ?? []).toHaveLength(0)
  })
})

describe('When Played — opponent discard, then distribute damage (Ninth Sister)', () => {
  const oppDiscard = (s: GameState, handIndex: number) =>
    resolve(s, { type: 'acceptChoice', choiceId: s.pendingChoices![0].id, handIndex })
  const deal = (s: GameState, id: string) => resolve(s, { type: 'acceptChoice', choiceId: s.pendingChoices![0].id, targetInstanceId: id })
  const done = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: s.pendingChoices![0].id })

  it('hands the discard to the opponent, then hands the distribute back to the player', () => {
    const s0 = play('ASH_148', {}, { hand: ['COST3'], units: [unit('e', 'EXPENSIVE', { arena: 'ground' })] })
    expect(s0.pendingChoices?.[0]).toMatchObject({ kind: 'selectDiscard', controller: 'opponent', count: 1 })
    expect(s0.activePlayer).toBe('opponent') // handed off to the opponent to choose
    const s1 = oppDiscard(s0, 0) // opponent discards its COST3 (cost 3)
    expect(s1.players.opponent.discard).toContain('COST3')
    expect(s1.pendingChoices?.[0]).toMatchObject({ kind: 'distributeDamage', controller: 'player', remaining: 3, total: 3 })
    expect(s1.activePlayer).toBe('player') // control returns to Ninth Sister's owner
  })

  it('distributes the cost as damage, one point per click, among any units on either side', () => {
    const s1 = oppDiscard(play('ASH_148', {}, { hand: ['COST3'], units: [unit('e', 'EXPENSIVE', { arena: 'ground' })] }), 0)
    const own = played(s1, 'ASH_148').instanceId
    let s = deal(s1, 'e') // 1 → enemy
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'distributeDamage', remaining: 2 })
    s = deal(s, own) // 1 → own Ninth Sister
    s = deal(s, 'e') // 1 → enemy again (3 dealt, done)
    expect(U(s, 'e').damage).toBe(2)
    expect(U(s, own).damage).toBe(1)
    expect(s.pendingChoices ?? []).toHaveLength(0) // all spent → resolved
  })

  it('is optional — the player may deal none', () => {
    const s1 = oppDiscard(play('ASH_148', {}, { hand: ['COST3'], units: [unit('e', 'EXPENSIVE', { arena: 'ground' })] }), 0)
    const s = done(s1) // decline the "may deal damage"
    expect(U(s, 'e').damage).toBe(0)
    expect(s.pendingChoices ?? []).toHaveLength(0)
  })

  it('a defeated unit drops out of the remaining targets', () => {
    const s1 = oppDiscard(play('ASH_148', {}, { hand: ['COST3'], units: [unit('e', 'GRUNT', { arena: 'ground' })] }), 0) // GRUNT 2hp
    const own = played(s1, 'ASH_148').instanceId
    let s = deal(s1, 'e') // 1
    s = deal(s, 'e') // 2 → GRUNT defeated
    expect(U(s, own)).toBeDefined()
    expect([...s.players.opponent.units].find(u => u.instanceId === 'e')).toBeUndefined()
    // 1 damage left, GRUNT gone — only Ninth Sister remains as a target
    const targets = legalMoves(s).filter(a => a.type === 'acceptChoice').map(a => a.targetInstanceId)
    expect(targets).toEqual([own])
  })

  it('a cost-0 discard deals no damage (no distribute choice)', () => {
    const s = oppDiscard(play('ASH_148', {}, { hand: ['COST0'], units: [unit('e', 'GRUNT', { arena: 'ground' })] }), 0)
    expect(s.players.opponent.discard).toContain('COST0')
    expect(s.pendingChoices ?? []).toHaveLength(0)
  })

  it('an opponent with an empty hand skips the whole ability', () => {
    const s = play('ASH_148', {}, { hand: [], units: [unit('e', 'GRUNT', { arena: 'ground' })] })
    expect(s.pendingChoices ?? []).toHaveLength(0)
    expect(played(s, 'ASH_148')).toBeDefined() // still entered play
  })
})

describe('When Played — look at the opponent\'s hand', () => {
  const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: s.pendingChoices![0].id })
  const pick = (s: GameState, handIndex: number) => resolve(s, { type: 'acceptChoice', choiceId: s.pendingChoices![0].id, handIndex })

  it('Imperial Defector (250): a view-only look at the opponent hand, dismissed with Done', () => {
    const s = play('ASH_250', {}, { hand: ['GRUNT', 'SPACER'] })
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'lookAtHand', controller: 'player', target: 'opponent' })
    expect(s.pendingChoices?.[0]).not.toHaveProperty('mayDiscard', true)
    const moves = legalMoves(s)
    expect(moves).toEqual([{ type: 'skipTrigger', choiceId: s.pendingChoices![0].id }]) // Done only
    const done = skip(s)
    expect(done.pendingChoices ?? []).toHaveLength(0)
    expect(done.players.opponent.hand).toEqual(['GRUNT', 'SPACER']) // untouched
  })

  it('Remnant Lookouts (220): may discard a card from the opponent hand; if so, they draw', () => {
    const s = play('ASH_220', {}, { hand: ['GRUNT', 'SPACER'], deck: ['DRAWN'] })
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'lookAtHand', controller: 'player', target: 'opponent', mayDiscard: true, thenDraw: true })
    // one accept per opponent hand card, plus Done
    const picks = legalMoves(s).filter(a => a.type === 'acceptChoice').map(a => a.handIndex)
    expect(picks.sort()).toEqual([0, 1])
    const s1 = pick(s, 0) // discard the opponent's GRUNT → they draw DRAWN
    expect(s1.players.opponent.discard).toContain('GRUNT')
    expect(s1.players.opponent.hand).toEqual(['SPACER', 'DRAWN'])
    expect(s1.pendingChoices ?? []).toHaveLength(0)
  })

  it('Remnant Lookouts: declining discards nothing and draws nothing', () => {
    const s = skip(play('ASH_220', {}, { hand: ['GRUNT', 'SPACER'], deck: ['DRAWN'] }))
    expect(s.players.opponent.hand).toEqual(['GRUNT', 'SPACER']) // no discard
    expect(s.players.opponent.deck).toEqual(['DRAWN']) // no draw
    expect(s.pendingChoices ?? []).toHaveLength(0)
  })

  it('Remnant Lookouts: an empty opponent hand offers only Done', () => {
    const s = play('ASH_220', {}, { hand: [], deck: ['DRAWN'] })
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'lookAtHand', mayDiscard: true })
    expect(legalMoves(s)).toEqual([{ type: 'skipTrigger', choiceId: s.pendingChoices![0].id }])
  })
})

describe('When Played — search top 5 for a trait match (Clan Wren Loyalist)', () => {
  it('reveals the top 5 and only lets you draw a trait-sharing card', () => {
    const s = play('ASH_107', { units: [unit('u', 'TRAIT_U')], deck: ['REBELCARD', 'NEUTRAL', 'MANDOCARD', 'NEUTRAL', 'NEUTRAL', 'EXTRA'] })
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'searchDraw', revealed: ['REBELCARD', 'NEUTRAL', 'MANDOCARD', 'NEUTRAL', 'NEUTRAL'] })
    // Rebel (index 0, matches TRAIT_U) and Mandalorian (index 2, matches Clan Wren itself) are eligible.
    expect((s.pendingChoices![0] as { eligibleIndices: number[] }).eligibleIndices).toEqual([0, 2])
    expect(legalMoves(s).filter(a => a.type === 'acceptChoice').map(a => a.deckIndex)).toEqual([0, 2])
  })

  it('draws the chosen card and bottoms the rest of the revealed cards', () => {
    const s = play('ASH_107', { units: [unit('u', 'TRAIT_U')], deck: ['REBELCARD', 'NEUTRAL', 'MANDOCARD', 'NEUTRAL', 'NEUTRAL', 'EXTRA'] })
    const s1 = resolve(s, { type: 'acceptChoice', choiceId: s.pendingChoices![0].id, deckIndex: 0 })
    expect(s1.players.player.hand).toContain('REBELCARD')
    // EXTRA (the 6th, untouched top) stays on top; the other four revealed go to the bottom in order.
    expect(s1.players.player.deck).toEqual(['EXTRA', 'NEUTRAL', 'MANDOCARD', 'NEUTRAL', 'NEUTRAL'])
    expect(s1.pendingChoices ?? []).toHaveLength(0)
  })

  it('with no trait match, bottoms all five and draws nothing (no choice)', () => {
    // Clan Wren is Mandalorian, but no Mandalorian/other-controlled-trait card is in the top 5.
    const s = play('ASH_107', { deck: ['NEUTRAL', 'NEUTRAL', 'NEUTRAL', 'NEUTRAL', 'NEUTRAL', 'EXTRA'] })
    expect(s.pendingChoices ?? []).toHaveLength(0)
    expect(s.players.player.hand).toEqual([]) // nothing drawn
    expect(s.players.player.deck).toEqual(['EXTRA', 'NEUTRAL', 'NEUTRAL', 'NEUTRAL', 'NEUTRAL', 'NEUTRAL'])
  })

  it('searches fewer than 5 when the deck is short', () => {
    const s = play('ASH_107', { deck: ['MANDOCARD'] }) // shares Mandalorian with Clan Wren
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'searchDraw', revealed: ['MANDOCARD'], eligibleIndices: [0] })
    const s1 = resolve(s, { type: 'acceptChoice', choiceId: s.pendingChoices![0].id, deckIndex: 0 })
    expect(s1.players.player.hand).toContain('MANDOCARD')
    expect(s1.players.player.deck).toEqual([])
  })
})

describe('When Played — play a discounted Heroism unit (Crix Madine)', () => {
  it('offers only Heroism hand units, discounted 2 per arena controlled', () => {
    const s = play('ASH_108', { hand: ['ASH_108', 'HEROUNIT', 'VILLAINUNIT'] }) // Crix alone on ground → controls ground only
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'playUnitFromHand', optional: true, costDelta: -2 })
    const cands = (s.pendingChoices![0] as { candidates: { cardId: string }[] }).candidates.map(c => c.cardId)
    expect(cands).toEqual(['HEROUNIT']) // Villainy unit excluded
  })

  it('discounts 2 per arena controlled — both arenas gives -4', () => {
    const s = play('ASH_108', { hand: ['ASH_108', 'HEROUNIT'], units: [unit('sp', 'SPACER', { arena: 'space' })] })
    expect((s.pendingChoices![0] as { costDelta: number }).costDelta).toBe(-4)
  })

  it('plays the chosen Heroism unit at the discounted cost', () => {
    const s = play('ASH_108', { hand: ['ASH_108', 'HEROUNIT'], resources: ready(20) })
    const before = readyCount(s)
    const s1 = resolve(s, { type: 'acceptChoice', choiceId: s.pendingChoices![0].id, handIndex: 0 })
    expect(s1.players.player.units.some(u => u.cardId === 'HEROUNIT')).toBe(true)
    expect(before - readyCount(s1)).toBe(3) // HEROUNIT cost 5, -2 discount
  })

  it('is optional — the player may decline', () => {
    const s = play('ASH_108', { hand: ['ASH_108', 'HEROUNIT'] })
    const s1 = resolve(s, { type: 'skipTrigger', choiceId: s.pendingChoices![0].id })
    expect(s1.players.player.units.some(u => u.cardId === 'HEROUNIT')).toBe(false)
    expect(s1.pendingChoices ?? []).toHaveLength(0)
  })

  it('does nothing when there is no Heroism unit in hand', () => {
    const s = play('ASH_108', { hand: ['ASH_108', 'VILLAINUNIT'] })
    expect(s.pendingChoices ?? []).toHaveLength(0)
  })
})

describe('When Played — Admiral Ackbar (110): self-defeat, then search and play free', () => {
  const accept = (s: GameState) => resolve(s, { type: 'acceptChoice', choiceId: s.pendingChoices![0].id })
  const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: s.pendingChoices![0].id })
  const pick = (s: GameState, deckIndex: number) => resolve(s, { type: 'acceptChoice', choiceId: s.pendingChoices![0].id, deckIndex })
  const eligible = (s: GameState) => (s.pendingChoices![0] as { eligibleIndices: number[] }).eligibleIndices

  it('offers an optional self-defeat when played', () => {
    const s = play('ASH_110', { deck: ['SPACE2'] })
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'mayDefeatSelfSearch', controller: 'player' })
    expect(s.players.player.units.some(u => u.cardId === 'ASH_110')).toBe(true) // still in play until accepted
  })

  it('declining leaves Ackbar in play and searches nothing', () => {
    const s = skip(play('ASH_110', { deck: ['SPACE2', 'SPACE3'] }))
    expect(s.players.player.units.some(u => u.cardId === 'ASH_110')).toBe(true)
    expect(s.pendingChoices ?? []).toHaveLength(0)
    expect(s.players.player.deck).toEqual(['SPACE2', 'SPACE3'])
  })

  it('accepting defeats Ackbar and reveals only cost-≤5 space units', () => {
    const s = accept(play('ASH_110', { deck: ['SPACE2', 'SPACE6', 'GROUND2', 'SPACE3'] }))
    expect(s.players.player.units.some(u => u.cardId === 'ASH_110')).toBe(false) // defeated
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'searchPlayFree', budget: 5 })
    expect(eligible(s)).toEqual([0, 3]) // SPACE2, SPACE3 — not SPACE6 (cost 6) nor GROUND2 (ground)
  })

  it('plays space units for free while the combined budget lasts, bottoming the rest', () => {
    let s = accept(play('ASH_110', { deck: ['SPACE2', 'SPACE6', 'GROUND2', 'SPACE3', 'EXTRA'] }))
    s = pick(s, 0) // SPACE2 (cost 2) → budget 3; revealed now [SPACE6, GROUND2, SPACE3, EXTRA]
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'searchPlayFree', budget: 3 })
    expect(eligible(s)).toEqual([2]) // only SPACE3 (cost 3 ≤ 3) fits now
    s = pick(s, 2) // SPACE3 (cost 3) → budget 0 → done
    expect(s.players.player.units.filter(u => ['SPACE2', 'SPACE3'].includes(u.cardId))).toHaveLength(2)
    expect(s.pendingChoices ?? []).toHaveLength(0)
    expect(s.players.player.deck).toEqual(['SPACE6', 'GROUND2', 'EXTRA']) // unplayed searched cards bottomed
  })

  it('Done stops early and returns the searched cards to the bottom', () => {
    const s = skip(accept(play('ASH_110', { deck: ['SPACE2', 'SPACE3'] })))
    expect(s.players.player.units.some(u => ['SPACE2', 'SPACE3'].includes(u.cardId))).toBe(false)
    expect(s.players.player.deck).toEqual(['SPACE2', 'SPACE3'])
  })

  it('with no eligible space unit, defeats Ackbar and searches nothing (no choice)', () => {
    const s = accept(play('ASH_110', { deck: ['GROUND2', 'SPACE6', 'GROUND2'] }))
    expect(s.players.player.units.some(u => u.cardId === 'ASH_110')).toBe(false)
    expect(s.pendingChoices ?? []).toHaveLength(0)
    expect(s.players.player.deck).toEqual(['GROUND2', 'SPACE6', 'GROUND2'])
  })

  it('a freely-played unit still triggers its own When Played', () => {
    // Helix Starfighter (221, space): no enemy space unit → 2 Advantage to itself.
    const s = pick(accept(play('ASH_110', { deck: ['ASH_221'] })), 0)
    const helix = s.players.player.units.find(u => u.cardId === 'ASH_221')!
    expect(helix).toBeDefined()
    expect(advs(helix)).toBe(2) // its When Played fired during the free play
  })

  it("a freely-played unit's own choice interrupts, then the search resumes", () => {
    // Reinforcing Light Cruiser (051, space): When Played "may exhaust a unit" raises a choice.
    let s = pick(accept(play('ASH_110', { deck: ['ASH_051', 'SPACE2'] })), 0) // play 051 (cost 0) free
    expect(s.pendingChoices?.[0]?.kind).toBe('mayExhaustUnit') // its choice is active…
    expect(s.pendingChoices?.[1]?.kind).toBe('searchPlayFree') // …with the search queued behind
    s = resolve(s, { type: 'skipTrigger', choiceId: s.pendingChoices![0].id }) // decline the exhaust
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'searchPlayFree', revealed: ['SPACE2'] })
  })
})

describe('When Played — name a card (Ryder Azadi)', () => {
  const oppPlayable = (s: GameState) =>
    legalMoves(s).filter(a => a.type === 'playUnit').map(a => s.players.opponent.hand[(a as { handIndex: number }).handIndex])
  const name = (s: GameState, cardName: string) => resolve(s, { type: 'acceptChoice', choiceId: s.pendingChoices![0].id, cardName })

  it('raises a name-a-card choice when played', () => {
    const s = play('ASH_077', {}, { hand: ['GRUNT'] })
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'nameCard', controller: 'player' })
    const names = legalMoves(s).filter(a => a.type === 'acceptChoice').map(a => (a as { cardName: string }).cardName)
    expect(names).toContain('GRUNT') // a card in the game is nameable
  })

  it('forbids the opponent from playing a card with the named name', () => {
    const s = name(play('ASH_077', {}, { hand: ['GRUNT', 'SPACER'] }), 'GRUNT')
    expect(s.activePlayer).toBe('opponent') // turn passed after naming
    expect(played(s, 'ASH_077').namedCard).toBe('GRUNT')
    const playable = oppPlayable(s)
    expect(playable).not.toContain('GRUNT') // named card is locked
    expect(playable).toContain('SPACER') // others are fine
  })

  it('lifts the restriction once Ryder leaves play', () => {
    const named = name(play('ASH_077', {}, { hand: ['GRUNT', 'SPACER'] }), 'GRUNT')
    // Simulate Ryder being defeated: remove it from the board.
    const gone: GameState = { ...named, players: { ...named.players, player: { ...named.players.player, units: [] } } }
    expect(oppPlayable(gone)).toContain('GRUNT') // freely playable again
  })
})

describe('When Played — The Cyborg Mech (147): modal ground strike', () => {
  it('deals 2 to an undamaged ground unit', () => {
    const s = play('ASH_147', {}, { units: [unit('u', 'TANK', { arena: 'ground' })] })
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'variableStrike', undamagedAmount: 2, damagedAmount: 5 })
    expect(U(accept(s, 'u'), 'u').damage).toBe(2)
  })

  it('deals 5 to a damaged ground unit', () => {
    const s = play('ASH_147', {}, { units: [unit('d', 'TANK', { arena: 'ground', damage: 1 })] })
    expect(U(accept(s, 'd'), 'd').damage).toBe(6) // 1 + 5
  })

  it('is mandatory (no decline) and only targets ground units', () => {
    const s = play('ASH_147', {}, { units: [unit('g', 'TANK', { arena: 'ground' }), unit('sp', 'TANKSPACE', { arena: 'space' })] })
    const moves = legalMoves(s)
    expect(moves.some(a => a.type === 'skipTrigger')).toBe(false) // mandatory
    const targets = moves.filter(a => a.type === 'acceptChoice').map(a => a.targetInstanceId)
    expect(targets).toContain('g') // ground enemy
    expect(targets).toContain(played(s, 'ASH_147').instanceId) // and the Mech itself (a ground unit)
    expect(targets).not.toContain('sp') // never the space unit
  })
})

describe('When Played — Barriss Offee (044): heal up to 2, Advantage per heal', () => {
  it('heals up to 2 from a unit and gives that many Advantage tokens', () => {
    const s = play('ASH_044', { units: [unit('h', 'TANK', { arena: 'ground', damage: 3 })] })
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'healForAdvantage', maxHeal: 2 })
    const a = accept(s, 'h')
    expect(U(a, 'h').damage).toBe(1) // 3 → 1 (healed 2)
    expect(advs(U(a, 'h'))).toBe(2)
  })

  it('heals only what damage is there when under 2, with matching tokens', () => {
    const a = accept(play('ASH_044', { units: [unit('h', 'TANK', { arena: 'ground', damage: 1 })] }), 'h')
    expect(U(a, 'h').damage).toBe(0)
    expect(advs(U(a, 'h'))).toBe(1)
  })

  it('offers only damaged units and may be declined', () => {
    const s = play('ASH_044', { units: [unit('h', 'TANK', { arena: 'ground', damage: 1 }), unit('clean', 'TANK', { arena: 'ground' })] })
    const targets = legalMoves(s).filter(a => a.type === 'acceptChoice').map(a => a.targetInstanceId)
    expect(targets).toEqual(['h']) // the undamaged unit isn't a target
    const done = resolve(s, { type: 'skipTrigger', choiceId: s.pendingChoices![0].id })
    expect(done.pendingChoices ?? []).toHaveLength(0)
  })

  it('does nothing when no unit is damaged', () => {
    const s = play('ASH_044', { units: [unit('clean', 'TANK', { arena: 'ground' })] })
    expect(s.pendingChoices ?? []).toHaveLength(0)
  })
})
