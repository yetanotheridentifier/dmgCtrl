import { describe, it, expect } from 'vitest'
import sorSet from './fixtures/sorSet.json'
import lofSet from './fixtures/lofSet.json'
import lawSet from './fixtures/lawSet.json'
import ibhSet from './fixtures/ibhSet.json'
import type { SwuCard } from '../data/cards'
import { buildCardDb } from '../engine/cardDb'
import type { PlayerId } from '../engine/types'
import { addGame, baseGroup, matchupsOf, sideOf, totalOf } from '../data/matchups'
import type { MatchupTally } from '../data/matchups'
import { player, state } from './helpers/engineFixtures'

/**
 * The player's record by matchup: a leader on a base against a leader on a base, with bases grouped
 * from the card data the same way on both sides.
 */
const CARDS = buildCardDb([sorSet, lofSet, lawSet, ibhSet].flatMap(s => s as unknown as SwuCard[]))
const group = (id: string) => baseGroup(CARDS[id])

describe('grouping bases', () => {
  it('groups the common aspect bases by aspect', () => {
    // Dagobah Swamp and Capital City: both common, 30 HP, Vigilance.
    expect(group('SOR_021')).toEqual(group('SOR_020'))
    expect(group('SOR_021').label).toBe('Vigilance base')
    // Administrator's Tower is Cunning.
    expect(group('SOR_029')).not.toEqual(group('SOR_021'))
  })

  it('groups every Force base together, whatever its aspect', () => {
    expect(group('LOF_029')).toEqual(group('LOF_026'))
    expect(group('LOF_020')).toEqual(group('LOF_024'))
    expect(group('LOF_029').label).toBe('Force base')
  })

  it('groups every splash base together, whatever its aspect', () => {
    expect(group('LAW_022')).toEqual(group('LAW_025'))
    expect(group('LAW_022').label).toBe('Splash base')
    expect(group('LAW_022')).not.toEqual(group('LOF_029'))
  })

  it('keeps a rare or special base on its own', () => {
    expect(group('SOR_019')).toEqual({ key: 'base:Security Complex', label: 'Security Complex' })
    expect(group('SOR_019')).not.toEqual(group('SOR_022'))
    expect(group('LAW_023').label).toBe('Great Pit of Carkoon')
    expect(group('IBH_2')).not.toEqual(group('IBH_54'))
  })
})

describe('tallying games by matchup', () => {
  const game = (mine: [string, string], theirs: [string, string], winner: PlayerId | 'draw', humanSeat?: PlayerId) => {
    const seats = { player: mine, opponent: theirs }
    if (humanSeat === 'opponent') [seats.player, seats.opponent] = [theirs, mine]
    const side = ([leader, base]: [string, string]) => player({ leader: { cardId: leader, deployed: false, epicActionUsed: false, exhausted: false }, base: { cardId: base, damage: 0 } })
    return {
      initialState: state({ cards: CARDS, players: { player: side(seats.player), opponent: side(seats.opponent) } }),
      winner,
      ...(humanSeat ? { humanSeat } : {}),
    }
  }
  const VADER: [string, string] = ['SOR_010', 'SOR_029']
  const LUKE_SWAMP: [string, string] = ['SOR_005', 'SOR_021']
  const LUKE_CAPITAL: [string, string] = ['SOR_005', 'SOR_020']
  const LUKE_RARE: [string, string] = ['SOR_005', 'SOR_019']
  const tally = (...games: ReturnType<typeof game>[]) => {
    const t: MatchupTally = new Map()
    for (const g of games) addGame(t, g)
    return t
  }
  const vader = sideOf(CARDS['SOR_010'], CARDS['SOR_029'])

  it('counts wins, losses and draws against each leader and base group', () => {
    const t = tally(
      game(VADER, LUKE_SWAMP, 'player'),
      game(VADER, LUKE_CAPITAL, 'player'),
      game(VADER, LUKE_SWAMP, 'opponent'),
      game(VADER, LUKE_CAPITAL, 'draw'),
      game(VADER, LUKE_RARE, 'opponent'),
    )
    const played = matchupsOf(t, vader)
    expect(played.map(m => [m.opponent.label, m.record])).toEqual([
      ['Luke Skywalker, Faithful Friend · Vigilance base', { won: 2, lost: 1, drawn: 1 }],
      ['Luke Skywalker, Faithful Friend · Security Complex', { won: 0, lost: 1, drawn: 0 }],
    ])
    expect(totalOf(played)).toEqual({ won: 2, lost: 2, drawn: 1 })
  })

  it('is kept apart for each side the player played', () => {
    const t = tally(game(VADER, LUKE_SWAMP, 'player'), game(LUKE_CAPITAL, VADER, 'opponent'))
    expect(matchupsOf(t, vader)).toHaveLength(1)
    const luke = sideOf(CARDS['SOR_005'], CARDS['SOR_020'])
    expect(matchupsOf(t, luke).map(m => [m.opponent.label, m.record])).toEqual([
      ['Darth Vader, Dark Lord of the Sith · Cunning base', { won: 0, lost: 1, drawn: 0 }],
    ])
  })

  /** A game with no seat was played from the player seat, the only one a person has held. */
  it('reads each side from the seat the person held', () => {
    const t = tally(game(VADER, LUKE_SWAMP, 'opponent', 'opponent'), game(VADER, LUKE_SWAMP, 'player'))
    expect(matchupsOf(t, vader)[0].record).toEqual({ won: 2, lost: 0, drawn: 0 })
  })

  it('leaves out a game whose cards it cannot read, and has nothing for a side never played', () => {
    const t = tally(game(VADER, ['TST_L', 'TST_B'], 'player'))
    expect(matchupsOf(t, vader)).toEqual([])
    expect(matchupsOf(t, null)).toEqual([])
  })
})
