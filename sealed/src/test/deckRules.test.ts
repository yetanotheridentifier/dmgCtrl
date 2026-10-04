import { describe, it, expect } from 'vitest'
import type { SwuCard } from '../data/cards'
import { deckReport, unpaidAspects } from '../deckgen/rules'
import type { ParsedDeck } from '../utils/parseProtectThePod'

/**
 * The deck-construction rules encoded as a checkable report (#408): legality (size, copies,
 * aspect coverage) plus the realism shape (curve, type caps, rarity mix, alignment balance). The
 * generator builds to satisfy this, and the coverage test relies on it to explain any failure.
 * Tested against a small synthetic pool so the thresholds are pinned exactly.
 */

const c = (id: string, o: Partial<SwuCard> = {}): SwuCard => ({
  Set: 'TST', Number: id, Name: id, Type: 'Unit', Cost: '3', Aspects: ['Command'], Rarity: 'Common', Unique: false, ...o,
})

const LEADER = c('L', { Type: 'Leader', Aspects: ['Command', 'Heroism'] })
const BASE = c('B', { Type: 'Base', Aspects: ['Aggression'], HP: '30' })

/** Build a 30-card deck from a compact spec, plus the id->card map covering it. */
function build(spec: { id: string; card: Partial<SwuCard>; count: number }[]): { deck: ParsedDeck; byId: Map<string, SwuCard> } {
  const byId = new Map<string, SwuCard>([['TST_L', LEADER], ['TST_B', BASE]])
  const cards = spec.map(s => {
    const card = c(s.id, s.card)
    byId.set(`TST_${s.id}`, card)
    return { id: `TST_${s.id}`, count: s.count }
  })
  return { deck: { name: 'test', leader: 'TST_L', base: 'TST_B', cards }, byId }
}

/** A deck that satisfies every rule: 8 cheap units, 19 mid, 3 bombs; sane rarity + alignment mix. */
function validSpec(): { id: string; card: Partial<SwuCard>; count: number }[] {
  const s: { id: string; card: Partial<SwuCard>; count: number }[] = []
  // 8 cheap units (cost <=2); 6 carry the leader's alignment (Heroism)
  for (let i = 0; i < 8; i++) s.push({ id: `cheap${i}`, card: { Cost: i % 2 ? '2' : '1', Aspects: i < 6 ? ['Command', 'Heroism'] : ['Command'], Rarity: 'Common' }, count: 1 })
  // 19 mid units (cost 3-6); 7 carry Heroism, giving 13/30 = 43% alignment overall
  for (let i = 0; i < 19; i++) {
    const rarity = i < 12 ? 'Common' : i < 17 ? 'Uncommon' : 'Rare'
    s.push({ id: `mid${i}`, card: { Cost: String(3 + (i % 4)), Aspects: i < 7 ? ['Command', 'Heroism'] : ['Aggression'], Rarity: rarity }, count: 1 })
  }
  // 3 bombs (cost >=7)
  for (let i = 0; i < 3; i++) s.push({ id: `bomb${i}`, card: { Cost: '7', Aspects: ['Command'], Rarity: i === 0 ? 'Legendary' : 'Rare' }, count: 1 })
  return s
}

/**
 * An aspect penalty is paid per **icon**, not per aspect: a card showing two Command icons needs two
 * Command between the leader and the base, and one short costs the penalty however many other icons
 * are covered.
 */
describe('unpaidAspects', () => {
  const card = (aspects: string[]) => c('x', { Aspects: aspects })
  const commandBase = c('B2', { Type: 'Base', Aspects: ['Command'] })

  it('is empty for a card whose icons the leader and base cover', () => {
    expect(unpaidAspects(card(['Command', 'Heroism']), LEADER, BASE)).toEqual([])
    expect(unpaidAspects(card([]), LEADER, BASE)).toEqual([])
  })

  it('names an aspect neither supplies', () => {
    expect(unpaidAspects(card(['Villainy']), LEADER, BASE)).toEqual(['Villainy'])
  })

  it('names a doubled aspect the leader and base supply only once', () => {
    expect(unpaidAspects(card(['Command', 'Command']), LEADER, BASE)).toEqual(['Command'])
  })

  it('pays a doubled aspect that the leader and base both supply', () => {
    expect(unpaidAspects(card(['Command', 'Command']), LEADER, commandBase)).toEqual([])
  })

  /**
   * A card with another way to be played is penalty-free when that way is paid: The Mandalorian (JTL)
   * prints two Cunning but pilots for one, and a Smuggle card can carry aspects of its own.
   */
  it('pays a card through its Piloting or Smuggle aspects', () => {
    const pilot = c('p', { Aspects: ['Command', 'Command'], FrontText: 'Piloting [C=2 Command]' })
    expect(unpaidAspects(pilot, LEADER, BASE)).toEqual([])
    const smuggler = c('s', { Aspects: ['Villainy'], FrontText: 'Smuggle [C=4 Aggression]' })
    expect(unpaidAspects(smuggler, LEADER, BASE)).toEqual([])
  })

  it('still names the printed aspects when no way of playing the card is paid', () => {
    const smuggler = c('s', { Aspects: ['Villainy'], FrontText: 'Smuggle [C=4 Cunning]' })
    expect(unpaidAspects(smuggler, LEADER, BASE)).toEqual(['Villainy'])
  })
})

describe('deckReport', () => {
  it('passes a well-formed deck', () => {
    const { deck, byId } = build(validSpec())
    const report = deckReport(deck, byId)
    expect(report.violations, report.violations.join('; ')).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.size).toBe(30)
  })

  it('flags the wrong deck size', () => {
    const { deck, byId } = build(validSpec().slice(0, 29))
    expect(deckReport(deck, byId).violations.some(v => /size/i.test(v))).toBe(true)
  })

  it('flags more than 3 copies of a card', () => {
    const spec = validSpec()
    spec[0].count = 4
    spec.pop() // keep size 30ish; still triggers the copy rule regardless
    const { deck, byId } = build(spec)
    expect(deckReport(deck, byId).violations.some(v => /cop/i.test(v))).toBe(true)
  })

  it('flags a doubled aspect the leader and base supply only once', () => {
    const spec = validSpec()
    spec[10].card = { ...spec[10].card, Aspects: ['Command', 'Command'] }
    const { deck, byId } = build(spec)
    expect(deckReport(deck, byId).violations.some(v => /aspect/i.test(v))).toBe(true)
  })

  /**
   * A rare base comes out of a pack in a rare slot, so a deck on one has one rare card fewer to play.
   * The valid deck carries four Rares; a fifth is inside the cap on a common base and over it on a rare one.
   */
  it('counts a rare base against the deck\'s rares', () => {
    const spec = validSpec()
    spec[0].card = { ...spec[0].card, Rarity: 'Rare' }
    const common = build(spec)
    expect(deckReport(common.deck, common.byId).violations).toEqual([])

    const rare = build(spec)
    rare.byId.set('TST_B', { ...BASE, Rarity: 'Rare' })
    expect(deckReport(rare.deck, rare.byId).violations.some(v => /rare/i.test(v))).toBe(true)
  })

  /**
   * A deck whose base repeats the leader's colour draws every card from one colour's pool, and one
   * colour may not print two big units it can play: SOR's Aggression and Cunning print one each. So it
   * needs only one, where a two-colour deck still needs two.
   */
  it('needs only one big unit when the base repeats the leader\'s colour', () => {
    const oneBomb = () => validSpec().map((s, i) => i >= 28 ? { ...s, card: { ...s.card, Cost: '5' } } : s)
    const twoColour = build(oneBomb())
    expect(deckReport(twoColour.deck, twoColour.byId).violations.some(v => /bomb/i.test(v))).toBe(true)

    const monoSpec = oneBomb().map(s => s.card.Aspects?.includes('Aggression') ? { ...s, card: { ...s.card, Aspects: ['Command'] } } : s)
    const mono = build(monoSpec)
    mono.byId.set('TST_B', { ...BASE, Aspects: ['Command'] })
    expect(deckReport(mono.deck, mono.byId).violations).toEqual([])
  })

  it('flags an off-aspect card (aspect penalty)', () => {
    const spec = validSpec()
    spec[10].card = { ...spec[10].card, Aspects: ['Villainy'] } // not covered by Command/Heroism/Aggression
    const { deck, byId } = build(spec)
    expect(deckReport(deck, byId).violations.some(v => /aspect/i.test(v))).toBe(true)
  })

  it('flags too few cheap units (curve)', () => {
    const spec = validSpec()
    for (let i = 0; i < 5; i++) spec[i].card = { ...spec[i].card, Cost: '4' } // only 3 cheap left
    const { deck, byId } = build(spec)
    expect(deckReport(deck, byId).violations.some(v => /cheap|curve/i.test(v))).toBe(true)
  })

  it('flags too many events', () => {
    const spec = validSpec()
    for (let i = 0; i < 7; i++) spec[9 + i].card = { ...spec[9 + i].card, Type: 'Event', Cost: '2' }
    const { deck, byId } = build(spec)
    expect(deckReport(deck, byId).violations.some(v => /event/i.test(v))).toBe(true)
  })

  it('flags too many legendaries', () => {
    const spec = validSpec()
    for (let i = 0; i < 4; i++) spec[9 + i].card = { ...spec[9 + i].card, Rarity: 'Legendary' }
    const { deck, byId } = build(spec)
    expect(deckReport(deck, byId).violations.some(v => /legendary/i.test(v))).toBe(true)
  })
})
