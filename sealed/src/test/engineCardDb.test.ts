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
  it('keys normalised cards by id', () => {
    const db = buildCardDb([VADER_UNIT, { ...VADER_UNIT, Number: '087', Name: 'Other' }])
    expect(Object.keys(db).sort()).toEqual(['SOR_086', 'SOR_087'])
    expect(db['SOR_086'].name).toBe('Darth Vader')
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
