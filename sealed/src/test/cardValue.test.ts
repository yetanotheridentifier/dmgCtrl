import { describe, it, expect } from 'vitest'
import { cardValue, rarityRank } from '../ai/cardValue'
import '../engine/cardDefinitions' // side effect: registers card behaviours, which cardValue counts
import { state, player, card, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState } from '../engine/types'

/**
 * How good a card is IF you get to cast it (#393).
 *
 * The greedy evaluation reads only `hand.length`, so it has no way to prefer one card in hand over
 * another. This is the quality scale that gives it one: cost, stats, keywords, implemented
 * abilities, rarity, aspect icons and uniqueness. Every input contributes positively, so the
 * function is monotone and cannot invert under mis-tuning.
 */
const s: GameState = state({ players: { player: player(), opponent: player() } })

/** A plain 2-cost 2/2 Common with a single aspect: the yardstick everything is compared against. */
const PLAIN: EngineCard = card({ id: 'PLAIN', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 2, aspects: ['Command'], rarity: 'Common' })

/** `cardValue` reads the card it is handed, so a fixture need not be in the db. */
const value = (overrides: Partial<EngineCard>) => cardValue(s, 'player', { ...PLAIN, ...overrides })

describe('rarityRank', () => {
  it('ranks the rarities in printed order', () => {
    expect(rarityRank('Common')).toBeLessThan(rarityRank('Uncommon'))
    expect(rarityRank('Uncommon')).toBeLessThan(rarityRank('Rare'))
    expect(rarityRank('Rare')).toBeLessThan(rarityRank('Legendary'))
  })

  it('treats missing or unknown rarity as the floor, never NaN', () => {
    expect(rarityRank(undefined)).toBe(0)
    expect(rarityRank('Nonsense')).toBe(0)
  })
})

describe('cardValue', () => {
  const baseline = value({})

  it('rises with each input in isolation', () => {
    expect(value({ cost: 5 }), 'cost').toBeGreaterThan(baseline)
    expect(value({ power: 5, hp: 5 }), 'stats').toBeGreaterThan(baseline)
    expect(value({ keywords: [{ name: 'Sentinel' }] }), 'keywords').toBeGreaterThan(baseline)
    expect(value({ rarity: 'Legendary' }), 'rarity').toBeGreaterThan(baseline)
    expect(value({ aspects: ['Command', 'Heroism'] }), 'aspects').toBeGreaterThan(baseline)
    expect(value({ unique: true }), 'unique').toBeGreaterThan(baseline)
  })

  /**
   * Implemented behaviour, not printed text: a card whose ability is not built genuinely does
   * nothing in this engine, so the AI should value it lower. ASH_161 (Zeb Orrelios) has two
   * registered abilities; a made-up id has none.
   */
  it('counts registered abilities, so an implemented card beats an identical unimplemented one', () => {
    const bare = value({ id: 'NOT_A_REAL_CARD' })
    const implemented = value({ id: 'ASH_161' })
    expect(implemented).toBeGreaterThan(bare)
  })

  /**
   * A statless card is not a worthless card: events carry pumps, debuffs, bounce and defeat
   * effects. Valuing them off `power + hp` alone would rank every event below every unit.
   * Placeholder until effect-magnitude scoring lands (see the events ticket).
   */
  it('does not systematically undervalue an event against a unit of the same cost', () => {
    const unit = value({ cost: 5, power: 5, hp: 5, type: 'unit' })
    const event = value({ cost: 5, power: undefined, hp: undefined, type: 'event' })
    expect(event).toBeGreaterThan(0.5 * unit)
  })

  it('is never negative, whatever the card', () => {
    expect(value({ cost: 0, power: 0, hp: 0, aspects: [], rarity: undefined })).toBeGreaterThanOrEqual(0)
  })

  /** The aspect PENALTY is a cost concern, not a quality one, and rides in via effectiveCost. */
  it('reads effective cost, so an off-aspect card is worth more than its printed cost suggests', () => {
    // TST_L/TST_B provide Command + Heroism, so an Aggression card takes a +2 penalty.
    const offAspect = cardValue(s, 'player', { ...PLAIN, aspects: ['Aggression'] })
    const onAspect = cardValue(s, 'player', { ...PLAIN, aspects: ['Command'] })
    expect(offAspect).toBeGreaterThan(onAspect)
  })
})

describe('cardValue over the real pool', () => {
  it('separates a bomb from filler of the same cost', () => {
    const cards = { ...CARDS }
    void cards
    const filler = cardValue(s, 'player', card({ id: 'F', type: 'unit', cost: 7, power: 6, hp: 6, aspects: ['Command'], rarity: 'Common' }))
    const bomb = cardValue(s, 'player', card({
      id: 'ASH_161', type: 'unit', cost: 7, power: 5, hp: 7, aspects: ['Command', 'Heroism'],
      rarity: 'Legendary', unique: true, keywords: [{ name: 'Sentinel' }],
    }))
    expect(bomb).toBeGreaterThan(filler)
  })
})
