import { describe, it, expect } from 'vitest'
import { searchCount } from '../engine/effects'
import '../engine/cardDefinitions' // registers ASH_084's searchModifier
import { state, player, unit, card, CARDS } from './helpers/engineFixtures'

/**
 * Deck-search sizing, and Arcana Star Map's x2 (#513).
 *
 * > **Arcana Star Map** (ASH_084): Attached unit gains: "If **you** would search a number of cards
 * > from your deck, search twice that number of cards instead."
 *
 * **"You" is the controller, not the attached unit.** Units do not search; players do. The upgrade
 * grants its host an ability whose effect is about the player, so **every** search that player makes
 * is doubled while the host is in play, whichever card is doing the searching.
 *
 * This was previously scoped to the searching unit's own upgrades, which made the card do nothing
 * except in the one case where the Star Map happened to sit on the very unit that searched. Reported
 * from live play: a Star Map on Imperial Defector, Clan Wren Loyalist played afterwards, and the
 * search still showed five cards instead of ten.
 */

const cards = { ...CARDS, ASH_084: card({ id: 'ASH_084', type: 'upgrade', power: 0, hp: 0 }) }
const starMap = { cardId: 'ASH_084', owner: 'player' as const }

describe('searchCount', () => {
  it('is the base count with no modifier in play', () => {
    const s = state({ players: { player: player({ units: [unit('u1', 'TST_U1')] }), opponent: player() } })
    expect(searchCount(s, 'player', 3)).toBe(3)
  })

  it('doubles when the Star Map is on the unit doing the searching', () => {
    const s = state({
      cards,
      players: { player: player({ units: [unit('u1', 'TST_U1', { upgrades: [starMap] })] }), opponent: player() },
    })
    expect(searchCount(s, 'player', 3)).toBe(6)
  })

  /** **The reported defect.** The Star Map sits on one unit and a different one searches. */
  it('doubles when the Star Map is on ANY unit its controller has', () => {
    const s = state({
      cards,
      players: {
        player: player({ units: [unit('host', 'TST_U1', { upgrades: [starMap] }), unit('searcher', 'TST_U3')] }),
        opponent: player(),
      },
    })
    expect(searchCount(s, 'player', 5)).toBe(10)
  })

  /** It reads "your deck", so an opponent's Star Map must not enlarge our search. */
  it('ignores a Star Map the opponent controls', () => {
    const s = state({
      cards,
      players: {
        player: player({ units: [unit('u1', 'TST_U1')] }),
        opponent: player({ units: [unit('e1', 'TST_U1', { upgrades: [{ cardId: 'ASH_084', owner: 'opponent' }] })] }),
      },
    })
    expect(searchCount(s, 'player', 5)).toBe(5)
  })

  /** Nothing in play at all, which is the searching-on-an-empty-board case. */
  it('is the base count with no units', () => {
    expect(searchCount(state({ cards }), 'player', 8)).toBe(8)
  })

  /**
   * Modifiers multiply rather than add, so two would be x4. Arcana Star Map is Unique so a player
   * cannot field two, but the rule is a property of the mechanism rather than of that one card.
   */
  it('multiplies when more than one modifier is in play', () => {
    const s = state({
      cards,
      players: {
        player: player({ units: [unit('a', 'TST_U1', { upgrades: [starMap] }), unit('b', 'TST_U3', { upgrades: [starMap] })] }),
        opponent: player(),
      },
    })
    expect(searchCount(s, 'player', 3)).toBe(12)
  })
})
