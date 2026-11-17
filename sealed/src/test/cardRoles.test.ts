import { describe, it, expect } from 'vitest'
import ashSet from './fixtures/ashSet.json'
import hmwSet from './fixtures/hmwSet.json'
import ibhSet from './fixtures/ibhSet.json'
import jtlSet from './fixtures/jtlSet.json'
import lawSet from './fixtures/lawSet.json'
import lofSet from './fixtures/lofSet.json'
import secSet from './fixtures/secSet.json'
import shdSet from './fixtures/shdSet.json'
import sorSet from './fixtures/sorSet.json'
import twiSet from './fixtures/twiSet.json'
import type { SwuCard } from '../data/cards'
import { createsUnitToken, freeSplashable, isTurnOnePlay, playedCost, removalKind, waivedAspects } from '../deckgen/cardRoles'
import { heuristicScorer } from '../deckgen/scorer'

/**
 * What a deck builder reads off a card: whether it removes an enemy unit, and whether it is a play for
 * the first turn. Labelled by hand from the printed text, across several sets, so the classifier is
 * held to what a player reads rather than to its own regexes.
 */
const ALL = [ashSet, hmwSet, ibhSet, jtlSet, lawSet, lofSet, secSet, shdSet, sorSet, twiSet]
  .flatMap(s => s as unknown as SwuCard[])
const byId = new Map(ALL.map(c => [`${c.Set}_${c.Number}`, c]))
const card = (id: string): SwuCard => {
  const c = byId.get(id)
  if (!c) throw new Error(`no card ${id}`)
  return c
}

describe('removalKind', () => {
  it.each([
    ['SOR_155', 'Aggression: one mode deals 4 damage to a unit'],
    ['ASH_258', 'Grassroots Resistance: deal 3 damage to a unit'],
    ['ASH_067', 'Get Lost: defeat an upgraded non-leader unit'],
    ['ASH_236', 'Far Far Away: return an enemy non-leader unit, after a friendly one'],
    ['HMW_114', 'Breach: a friendly unit deals damage to an enemy unit'],
    ['JTL_129', 'Focus Fire: friendly units deal damage to the chosen unit'],
    ['SEC_195', 'Arrest: your base captures an enemy unit'],
    ['LAW_208', 'Collateral Damage: a unit, then a base or another unit'],
    ['ASH_092', 'Foundling Rescue: you may defeat a unit with 2 or less HP'],
    ['JTL_043', 'No Glory, Only Results: take control of a unit, then defeat it'],
    ['SHD_120', 'Discerning Veteran: When Played, captures an enemy unit'],
    ['HMW_068', 'Imperial Commandos: When Played, may defeat a unit'],
    ['SHD_030', 'Death Trooper: damage to a friendly unit and to an enemy unit'],
    ['ASH_259', 'LEP Ratcatcher: When Played, may deal 1 damage to a ground unit'],
    ['LOF_145', 'Jedi Knight: conditional When Played damage still counts'],
    ['TWI_213', 'Sanctioner\'s Shuttle: a keyword leads the When Played head in'],
    ['JTL_180', 'Piercing Shot: "that unit" is the unit, not its Shield tokens'],
    ['TWI_176', 'Caught in the Crossfire: each deals damage to "the other"'],
    ['SEC_193', 'Grand Admiral Thrawn: "this unit captures that unit", the unit the opponent chose'],
    ['LAW_132', 'The Tree Remembers: "defeat it", the enemy unit of the sentence before'],
  ])('%s is removal (%s)', id => {
    expect(removalKind(card(id))).toBe('removal')
  })

  it.each([
    ['SOR_218', 'Asteroid Sanctuary: exhaust an enemy unit'],
    ['IBH_18', 'Go for the Legs: exhaust an enemy ground unit'],
    ['ASH_233', 'Keep Them Talking: exhaust up to 2 units'],
    ['ASH_231', 'Diplomatic Pageantry: a friendly unit and an enemy unit'],
    ['SEC_189', 'Lurking Snub Fighter: When Played, may exhaust a unit'],
  ])('%s is exhaust, the weak kind (%s)', id => {
    expect(removalKind(card(id))).toBe('exhaust')
  })

  it.each([
    ['ASH_246', 'Exploit Advantage: defeats a friendly upgrade'],
    ['ASH_103', 'Long Live the Empire: defeats a friendly unit'],
    ['HMW_158', 'Battle-Scarred Destroyer: damages a friendly unit'],
    ['ASH_158', 'Han Solo: damages this unit'],
    ['JTL_075', 'Repair: heals'],
    ['ASH_232', 'Full of Surprises: returns an upgrade'],
    ['SEC_163', 'Outer Rim Constable: defeats an upgrade'],
    ['JTL_181', 'Planetary Bombardment: indirect damage to a player'],
    ['LOF_037', 'Darth Vader: removal On Attack, not When Played'],
    ['LOF_091', 'Craving Power: an upgrade, though it deals damage when played'],
    ['HMW_252', 'Villainous Ambition: an upgrade, though it deals damage when played'],
    ['JTL_232', 'Jump to Lightspeed: returns a friendly unit'],
    ['SEC_212', 'Libertine: the enemy unit captures the friendly one'],
    ['HMW_043', 'Darth Vader: damages the units it plays from your deck'],
    ['HMW_204', 'Nightbrother: defeats the unit it played from your discard pile'],
    ['LAW_205', 'Flash the Vents: defeats the unit you attacked with'],
    ['SEC_056', 'Escape Pod: captures a friendly non-Vehicle, non-leader unit'],
  ])('%s is not removal (%s)', id => {
    expect(removalKind(card(id))).toBeNull()
  })
})

describe('createsUnitToken', () => {
  it.each([
    ['TWI_237', 'Droid Deployment'],
    ['JTL_076', 'Covering the Wing'],
    ['HMW_237', 'Easy Prey: yours first, then the opponent\'s'],
    ['SEC_246', 'Contempt for Culture'],
  ])('%s is guaranteed to create a unit token (%s)', id => {
    expect(createsUnitToken(card(id))).toBe(true)
  })

  it.each([
    ['JTL_122', 'All Wings Report In: one per unit exhausted, possibly none'],
    ['TWI_222', 'Political Pressure: only if they do not discard'],
    ['ASH_257', 'Choose Your Path: one mode of two'],
    ['JTL_205', 'Commence Patrol: only if you do'],
    ['LAW_244', 'Unmarked Credits: a Credit token is not a unit'],
    ['LOF_041', 'Drain Essence: the Force token is not a unit'],
    ['JTL_155', 'They Hate That Ship: the opponent creates them'],
  ])('%s is not (%s)', id => {
    expect(createsUnitToken(card(id))).toBe(false)
  })
})

describe('turn-1 plays, at the cost as played', () => {
  const leader = (aspects: string[]): SwuCard => ({ Set: 'TST', Number: '1', Name: 'L', Type: 'Leader', Aspects: aspects })
  const base = (aspects: string[]): SwuCard => ({ Set: 'TST', Number: '2', Name: 'B', Type: 'Base', Aspects: aspects })
  const unit = (cost: number, aspects: string[]): SwuCard => ({ Set: 'TST', Number: '3', Name: 'U', Type: 'Unit', Cost: String(cost), Aspects: aspects })

  it('counts a unit costing less than 3 as played', () => {
    expect(isTurnOnePlay(unit(2, ['Command']), leader(['Command', 'Heroism']), base(['Vigilance']))).toBe(true)
    expect(isTurnOnePlay(unit(3, ['Command']), leader(['Command', 'Heroism']), base(['Vigilance']))).toBe(false)
  })

  it('counts the aspect penalty: 2 a missing icon', () => {
    const L = leader(['Command', 'Heroism'])
    const B = base(['Vigilance'])
    expect(playedCost(unit(1, ['Aggression']), L, B)).toBe(3)
    expect(isTurnOnePlay(unit(1, ['Aggression']), L, B)).toBe(false)
    expect(playedCost(unit(0, ['Aggression']), L, B)).toBe(2)
    expect(isTurnOnePlay(unit(0, ['Aggression']), L, B)).toBe(true)
    // Two of one icon with only one paid: one missing icon, not two.
    expect(playedCost(unit(1, ['Command', 'Command']), L, B)).toBe(3)
  })

  /**
   * LAW's common bases waive one aspect penalty on one card, once a game. Read from the text, so a later
   * set reusing the wording is covered; a rare base of the same set that prints something else is not.
   */
  it('reads a base that waives one aspect penalty, and the aspects it waives', () => {
    expect(waivedAspects(card('LAW_022'))).toEqual(['Vigilance', 'Command', 'Aggression', 'Cunning'])
    expect(waivedAspects(card('LAW_026')), 'Shipbreaking Yard').toEqual([])
    expect(waivedAspects(card('ASH_023')), 'an ASH base').toEqual([])
  })

  it('lets that base waive one missing colour icon, not an alignment and not two', () => {
    const garrison = card('LAW_022') // Command
    const L = leader(['Vigilance', 'Villainy'])
    expect(freeSplashable(unit(2, ['Aggression']), L, garrison)).toBe(true)
    expect(freeSplashable(unit(2, ['Heroism']), L, garrison), 'an alignment is not waived').toBe(false)
    expect(freeSplashable(unit(2, ['Aggression', 'Cunning']), L, garrison), 'two missing icons').toBe(false)
    expect(freeSplashable(unit(2, ['Command']), L, garrison), 'nothing missing').toBe(false)
    expect(freeSplashable(unit(2, ['Aggression']), L, card('LAW_026')), 'a base that waives nothing').toBe(false)
  })

  it('counts a cheap event only when it is guaranteed to create a unit token', () => {
    const L = leader(['Villainy', 'Command'])
    const B = base(['Cunning'])
    expect(isTurnOnePlay(card('TWI_237'), L, B), 'Droid Deployment').toBe(true)
    expect(isTurnOnePlay(card('ASH_233'), L, B), 'a cheap exhaust event').toBe(false)
    const rock = card('LAW_206')
    expect(isTurnOnePlay(rock, leader(rock.Aspects ?? []), base([])), 'That\'s a Rock, cheap removal').toBe(false)
  })
})

/**
 * A card is worth what it does at its printed cost, divided by what is paid for it. Pricing the worth at
 * the penalised cost instead let the penalty pay for itself: an event's worth is read off its cost, so a
 * penalised event looked nearly as good value as an unpenalised one.
 */
describe('a card\'s worth to a deck', () => {
  it.each([
    ['ASH_258', 'Grassroots Resistance, an event'],
    ['ASH_164', 'Alamite Hunter, a unit'],
  ])('%s at a 2 penalty is its printed worth over the cost paid (%s)', id => {
    const c = card(id)
    const printed = Number(c.Cost)
    const worth = heuristicScorer.card(c, printed) * printed
    expect(heuristicScorer.card(c, printed + 2)).toBeCloseTo(worth / (printed + 2), 9)
    expect(heuristicScorer.card(c, printed + 2)).toBeLessThan(heuristicScorer.card(c, printed) * 0.8)
  })
})
