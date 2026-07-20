import { describe, it, expect } from 'vitest'
import { normaliseCard, buildCardDb } from '../engine/cardDb'
import type { SwuCard } from '../data/cards'
import type { GameState } from '../engine/types'

const VADER_UNIT: SwuCard = {
  Set: 'SOR',
  Number: '086',
  Name: 'Darth Vader',
  Subtitle: 'Commanding the First Legion',
  Type: 'Unit',
  Arenas: ['Ground'],
  Cost: '7',
  Power: '5',
  HP: '7',
  Aspects: ['Aggression', 'Villainy'],
  Traits: ['FORCE', 'IMPERIAL', 'SITH'],
  Unique: true,
  FrontArt: 'https://cdn.swu-db.com/images/cards/SOR/086.png',
  FrontText: 'When Played: Deal 3 damage to a unit.',
}

describe('normaliseCard', () => {
  it('normalises a unit card', () => {
    const card = normaliseCard(VADER_UNIT)
    expect(card).toEqual({
      id: 'SOR_086',
      name: 'Darth Vader',
      subtitle: 'Commanding the First Legion',
      type: 'unit',
      arena: 'ground',
      cost: 7,
      power: 5,
      hp: 7,
      aspects: ['Aggression', 'Villainy'],
      traits: ['FORCE', 'IMPERIAL', 'SITH'],
      keywords: [],
      unique: true,
      frontArt: 'https://cdn.swu-db.com/images/cards/SOR/086.png',
      text: 'When Played: Deal 3 damage to a unit.',
    })
  })

  it('omits frontArt when the payload has none', () => {
    const card = normaliseCard({ Set: 'SOR', Number: '001', Name: 'Artless', Type: 'Unit' })
    expect(card.frontArt).toBeUndefined()
  })

  it('carries ability text, and omits it when absent', () => {
    expect(normaliseCard(VADER_UNIT).text).toBe('When Played: Deal 3 damage to a unit.')
    expect(normaliseCard({ Set: 'SOR', Number: '001', Name: 'Vanilla', Type: 'Unit' }).text).toBeUndefined()
  })

  it('carries front and back art (leaders/bases are double-sided or landscape)', () => {
    const leader = normaliseCard({
      Set: 'SOR',
      Number: '010',
      Name: 'Darth Vader',
      Type: 'Leader',
      FrontArt: 'https://cdn.swu-db.com/images/cards/SOR/010.png',
      BackArt: 'https://cdn.swu-db.com/images/cards/SOR/010-b.png',
    })
    expect(leader.frontArt).toBe('https://cdn.swu-db.com/images/cards/SOR/010.png')
    expect(leader.backArt).toBe('https://cdn.swu-db.com/images/cards/SOR/010-b.png')
    expect(normaliseCard({ Set: 'SOR', Number: '001', Name: 'X', Type: 'Unit' }).backArt).toBeUndefined()
  })

  it('normalises a space unit arena', () => {
    const card = normaliseCard({ ...VADER_UNIT, Arenas: ['Space'] })
    expect(card.arena).toBe('space')
  })

  it('normalises a base card (HP, no arena)', () => {
    const card = normaliseCard({
      Set: 'SOR',
      Number: '029',
      Name: 'Tarkintown',
      Type: 'Base',
      HP: '30',
      Aspects: ['Aggression'],
    })
    expect(card.type).toBe('base')
    expect(card.hp).toBe(30)
    expect(card.arena).toBeUndefined()
    expect(card.cost).toBe(0)
  })

  it('normalises a leader card', () => {
    const card = normaliseCard({
      Set: 'SOR',
      Number: '010',
      Name: 'Darth Vader',
      Subtitle: 'Dark Lord of the Sith',
      Type: 'Leader',
      Cost: '7',
      Power: '5',
      HP: '8',
      Aspects: ['Aggression', 'Villainy'],
    })
    expect(card.type).toBe('leader')
    expect(card.cost).toBe(7)
  })

  it('normalises events and upgrades', () => {
    expect(normaliseCard({ Set: 'SOR', Number: '078', Name: 'Vanquish', Type: 'Event', Cost: '5' }).type).toBe('event')
    expect(normaliseCard({ Set: 'SOR', Number: '072', Name: 'Entrenched', Type: 'Upgrade', Cost: '2' }).type).toBe('upgrade')
  })

  it('defaults missing numerics to 0 and missing lists to empty', () => {
    const card = normaliseCard({ Set: 'SOR', Number: '001', Name: 'Mystery', Type: 'Unit' })
    expect(card.cost).toBe(0)
    expect(card.power).toBe(0)
    expect(card.hp).toBe(0)
    expect(card.aspects).toEqual([])
    expect(card.traits).toEqual([])
    expect(card.unique).toBe(false)
  })
})

describe('buildCardDb', () => {
  it('keys normalised cards by id (alongside the built-in token upgrades)', () => {
    const db = buildCardDb([VADER_UNIT, { ...VADER_UNIT, Number: '087', Name: 'Other' }])
    const deckIds = Object.keys(db).filter(id => !id.startsWith('TOKEN_'))
    expect(deckIds.sort()).toEqual(['SOR_086', 'SOR_087'])
    expect(db['SOR_086'].name).toBe('Darth Vader')
    // Token upgrades are always present so attached tokens resolve.
    expect(db['TOKEN_EXPERIENCE']).toBeDefined()
  })
})

describe('upgrade stat overrides — temporary ASH data gap', () => {
  it('fills in Power/HP the source omits (Bokken Saber ASH_180 → +1/+1)', () => {
    const c = normaliseCard({ Set: 'ASH', Number: '180', Name: 'Bokken Saber', Type: 'Upgrade' })
    expect([c.power, c.hp]).toEqual([1, 1])
  })

  it('captures a negative modifier (Nowhere to Hide ASH_198 → -2/0)', () => {
    const c = normaliseCard({ Set: 'ASH', Number: '198', Name: 'Nowhere to Hide', Type: 'Upgrade' })
    expect([c.power, c.hp]).toEqual([-2, 0])
  })

  it('The Way of the Mand\'alor (ASH_263) is +2/+0 — grants no HP', () => {
    const c = normaliseCard({ Set: 'ASH', Number: '263', Name: "The Way of the Mand'alor", Type: 'Upgrade' })
    expect([c.power, c.hp]).toEqual([2, 0])
  })

  it('does not override once the source provides stats (auto-drops out)', () => {
    const c = normaliseCard({ Set: 'ASH', Number: '180', Name: 'Bokken Saber', Type: 'Upgrade', Power: '5', HP: '5' })
    expect([c.power, c.hp]).toEqual([5, 5])
  })

  it('leaves a card with no override entry on its source stats', () => {
    const c = normaliseCard({ Set: 'SOR', Number: '072', Name: 'Entrenched', Type: 'Upgrade', Power: '3', HP: '3' })
    expect([c.power, c.hp]).toEqual([3, 3])
  })
})

describe('card data corrections — wrong source values overridden', () => {
  it('corrects the Moff Gideon unit (ASH_097) cost to its printed 3 (source ships 8)', () => {
    const c = normaliseCard({ Set: 'ASH', Number: '097', Name: 'Moff Gideon', Type: 'Unit', Cost: '8', Power: '2', HP: '5', Arenas: ['Ground'] })
    expect(c.cost).toBe(3)
    expect([c.power, c.hp]).toEqual([2, 5]) // the rest is untouched
  })

  it('corrects the Nebulon-C Frigate (ASH_081) to the Space arena (source ships Ground)', () => {
    const c = normaliseCard({ Set: 'ASH', Number: '081', Name: 'Nebulon-C Frigate', Type: 'Unit', Cost: '5', Power: '3', HP: '6', Arenas: ['Ground'] })
    expect(c.arena).toBe('space')
    expect(c.cost).toBe(5)
  })

  it('leaves cards without a correction entry on their source values', () => {
    const c = normaliseCard({ Set: 'ASH', Number: '999', Name: 'Uncorrected', Type: 'Unit', Cost: '4', Arenas: ['Ground'] })
    expect(c.cost).toBe(4)
    expect(c.arena).toBe('ground')
  })
})

describe('GameState schema', () => {
  it('is plain data — JSON round-trips without loss', () => {
    const state: GameState = {
      cards: buildCardDb([VADER_UNIT]),
      players: {
        player: {
          leader: { cardId: 'SOR_010', deployed: false, epicActionUsed: false, exhausted: false },
          base: { cardId: 'SOR_029', damage: 0 },
          hand: ['SOR_086'],
          deck: [],
          discard: [],
          resources: [{ cardId: 'SOR_100', exhausted: false }],
          units: [{ instanceId: 'u1', cardId: 'SOR_086', arena: 'ground', damage: 0, exhausted: true, isLeader: false, upgrades: [] }],
        },
        opponent: {
          leader: { cardId: 'SOR_005', deployed: false, epicActionUsed: false, exhausted: false },
          base: { cardId: 'SOR_020', damage: 3 },
          hand: [],
          deck: ['SOR_087'],
          discard: [],
          resources: [],
          units: [],
        },
      },
      initiative: 'player',
      initiativeTakenBy: null,
      activePlayer: 'player',
      phase: 'action',
      round: 1,
      consecutivePasses: 0,
      regroupResourced: { player: false, opponent: false },
      instanceCounter: 1,
      rngSeed: 42,
      setupStage: 'resource',
      winner: null,
    }

    expect(JSON.parse(JSON.stringify(state))).toEqual(state)
  })
})
