import { describe, it, expect } from 'vitest'
import { state, player, card, unit, ready, CARDS } from './helpers/engineFixtures'
import { lossIsCertain } from '../ai/race'
import { concessionOffer, driverAction } from '../ai/concession'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * Conceding (#537). A seat's loss is **certain** when, in the action phase, every legal move hands the
 * opponent a one-action kill on their turn. Measured before building it: no seat in that position
 * has ever won (101 of 101 under greedy, 21 of 21 under beam), where the looser "they could finish"
 * reading let 23% of seats survive.
 *
 * The bot offers to concede there, once a game; the player accepts or declines. Either player may
 * also concede outright on their own turn.
 */
const cards = {
  ...CARDS,
  KILLER: card({ id: 'KILLER', type: 'unit', arena: 'ground', cost: 2, power: 8, hp: 4 }),
  BIGUNIT: card({ id: 'BIGUNIT', type: 'unit', arena: 'ground', cost: 2, power: 5, hp: 5 }),
  FRAIL_BASE: card({ id: 'FRAIL_BASE', type: 'base', hp: 8 }),
}

/** The player's base is in one-shot range of the opponent's ready KILLER, and the player can do nothing about it. */
const doomed = (): GameState => state({
  cards,
  players: {
    player: player({ base: { cardId: 'FRAIL_BASE', damage: 0 } }),
    opponent: player({ units: [unit('e0', 'KILLER')] }),
  },
})

describe('lossIsCertain', () => {
  it('is true when every legal move hands them a one-action kill on their turn', () => {
    expect(lossIsCertain(doomed(), 'player')).toBe(true)
  })

  /** One move that removes the threat is enough: BIGUNIT kills the 4 HP KILLER. */
  it('is false when one move stops the kill', () => {
    const s = state({
      cards,
      players: {
        player: player({ base: { cardId: 'FRAIL_BASE', damage: 0 }, units: [unit('u0', 'BIGUNIT')] }),
        opponent: player({ units: [unit('e0', 'KILLER')] }),
      },
    })
    expect(lossIsCertain(s, 'player')).toBe(false)
  })

  it('is false when they cannot finish at all', () => {
    const s = state({
      cards,
      players: { player: player(), opponent: player({ units: [unit('e0', 'KILLER')] }) },
    })
    expect(lossIsCertain(s, 'player')).toBe(false)
  })

  it('is false outside the action phase', () => {
    expect(lossIsCertain({ ...doomed(), phase: 'regroup' }, 'player')).toBe(false)
  })

  it('is false for a seat that is not the one to act', () => {
    expect(lossIsCertain(doomed(), 'opponent')).toBe(false)
  })
})

describe('concessionOffer', () => {
  it('offers when the acting seat\'s loss is certain', () => {
    expect(concessionOffer(doomed())).toEqual({ type: 'offerConcession' })
  })

  it('does not offer when the loss is not certain', () => {
    const s = state({ cards, players: { player: player(), opponent: player({ units: [unit('e0', 'KILLER')] }) } })
    expect(concessionOffer(s)).toBeNull()
  })

  /** Once declined, the seat plays it out: asking again an action later is noise. */
  it('does not offer again after a decline', () => {
    const declined = resolve(resolve(doomed(), { type: 'offerConcession' }), { type: 'declineConcession' })
    expect(concessionOffer(declined)).toBeNull()
  })
})

/** The one step both drivers take, the app's turn loop and the bench's `playGame`. */
describe('driverAction', () => {
  const passOnly = () => ({ type: 'pass' as const })

  it('offers to concede ahead of the AI\'s own move when the loss is certain', () => {
    expect(driverAction(doomed(), passOnly)).toEqual({ type: 'offerConcession' })
  })

  it('leaves the move to the AI otherwise', () => {
    const s = state({ cards, players: { player: player(), opponent: player() } })
    expect(driverAction(s, passOnly)).toEqual({ type: 'pass' })
  })

  it('never offers when concession is turned off', () => {
    expect(driverAction(doomed(), passOnly, { concede: false })).toEqual({ type: 'pass' })
  })
})

describe('the concession actions', () => {
  it('hands the turn to the other player to answer, with only accept and decline open to them', () => {
    const offered = resolve(doomed(), { type: 'offerConcession' })
    expect(offered.concessionOffer).toBe('player')
    expect(offered.activePlayer).toBe('opponent')
    expect(legalMoves(offered)).toEqual([{ type: 'acceptConcession' }, { type: 'declineConcession' }])
  })

  it('ends the game as the answerer\'s win when accepted, recording who conceded', () => {
    const accepted = resolve(resolve(doomed(), { type: 'offerConcession' }), { type: 'acceptConcession' })
    expect(accepted.winner).toBe('opponent')
    expect(accepted.concededBy).toBe('player')
  })

  it('hands the turn back to the offerer when declined, with the game going on', () => {
    const declined = resolve(resolve(doomed(), { type: 'offerConcession' }), { type: 'declineConcession' })
    expect(declined.winner).toBeNull()
    expect(declined.concessionOffer).toBeUndefined()
    expect(declined.activePlayer).toBe('player')
    expect(legalMoves(declined).length).toBeGreaterThan(0)
  })

  it('refuses a second offer after a decline', () => {
    const declined = resolve(resolve(doomed(), { type: 'offerConcession' }), { type: 'declineConcession' })
    expect(() => resolve(declined, { type: 'offerConcession' })).toThrow(/declined/)
  })

  /** The player's own Concede button: legal at any point on their turn, not only when the bot would. */
  it('lets the acting player concede outright', () => {
    const s = state({ cards, players: { player: player({ resources: ready(3) }), opponent: player() } })
    const conceded = resolve(s, { type: 'concede' })
    expect(conceded.winner).toBe('opponent')
    expect(conceded.concededBy).toBe('player')
  })

  /** A search must never weigh conceding as a move, or "lose now" could outscore a bad position. */
  it('never lists concession among a seat\'s ordinary moves', () => {
    const types = legalMoves(doomed()).map(m => m.type)
    expect(types).not.toContain('concede')
    expect(types).not.toContain('offerConcession')
  })
})
