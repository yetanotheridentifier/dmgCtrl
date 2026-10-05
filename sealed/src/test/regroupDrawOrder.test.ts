import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { Action } from '../engine/actions'
import type { EngineCard, GameState, PendingChoice, PlayerId } from '../engine/types'

/**
 * "When the regroup phase starts" comes before the regroup draw (CR: the phase starts, then the draw
 * step), so every such ability, and every choice one raises, resolves before either player draws.
 * Foresight prints the order outright: "When the regroup phase starts (before drawing cards)".
 */
const F: Record<string, EngineCard> = {
  ...CARDS,
  SHD_015: card({ id: 'SHD_015', name: 'Doctor Aphra', type: 'leader', cost: 5, power: 3, hp: 5 }),
  SHD_203: card({ id: 'SHD_203', name: 'Zorii Bliss', arena: 'ground', cost: 3, power: 3, hp: 4, unique: true }),
  TWI_068: card({ id: 'TWI_068', name: 'Foresight', type: 'upgrade', cost: 1, power: 0, hp: 0 }),
  GRD: card({ id: 'GRD', name: 'Guard', arena: 'ground', cost: 2, power: 2, hp: 5 }),
  BIG: card({ id: 'BIG', name: 'Big Unit', arena: 'ground', cost: 4, power: 3, hp: 9 }),
  WEAK: card({ id: 'WEAK', name: 'Weak Unit', arena: 'ground', cost: 1, power: 1, hp: 1 }),
}
type Side = Parameters<typeof player>[0]
const board = (mine: Side = {}, theirs: Side = {}): GameState => state({
  cards: F,
  players: {
    player: player({ resources: ready(4), deck: ['GRD', 'GRD', 'GRD', 'GRD'], ...mine }),
    opponent: player({ resources: ready(4), deck: ['GRD', 'GRD', 'GRD', 'GRD'], ...theirs }),
  },
})
/** Both players pass, which ends the action phase and enters the regroup phase. */
const toRegroup = (s: GameState) => resolve({ ...s, consecutivePasses: 1 }, { type: 'pass' })
const choice = (s: GameState): PendingChoice => {
  expect(s.pendingChoices?.length ?? 0, 'a choice is raised').toBeGreaterThan(0)
  return s.pendingChoices![0]
}
const answer = (s: GameState, extra: Partial<Extract<Action, { type: 'acceptChoice' }>> = {}) =>
  resolve({ ...s, activePlayer: choice(s).controller }, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const decline = (s: GameState) => resolve({ ...s, activePlayer: choice(s).controller }, { type: 'skipTrigger', choiceId: choice(s).id })
const hand = (s: GameState, id: PlayerId = 'player') => s.players[id].hand

describe('the regroup draw waits on "when the regroup phase starts"', () => {
  it('an ability with no choice resolves against the deck as it was before the draw (Doctor Aphra)', () => {
    const s = toRegroup(board({ leader: { cardId: 'SHD_015', deployed: false, epicActionUsed: false, exhausted: false }, deck: ['WEAK', 'BIG', 'GRD', 'GRD'] }))
    expect(s.phase).toBe('regroup')
    expect(s.players.player.discard).toEqual(['WEAK'])
    expect(hand(s)).toEqual(['BIG', 'GRD'])
  })

  it("a choice is answered before anyone draws, then both players draw (Zorii Bliss discards from the hand as it was)", () => {
    const s = toRegroup(board({ units: [unit('z', 'SHD_203')], hand: ['WEAK'], deck: ['BIG', 'GRD', 'GRD'] }))
    expect(choice(s).kind).toBe('selectDiscard')
    expect(hand(s), 'nobody has drawn yet').toEqual(['WEAK'])
    expect(hand(s, 'opponent')).toEqual([])
    const after = answer(s, { handIndex: 0 })
    expect(after.players.player.discard).toEqual(['WEAK'])
    expect(hand(after)).toEqual(['BIG', 'GRD'])
    expect(hand(after, 'opponent')).toEqual(['GRD', 'GRD'])
    expect([after.phase, after.activePlayer, after.pendingChoices ?? []]).toEqual(['regroup', 'player', []])
  })

  it("the other player's regroup-start choice holds both draws, and resourcing then starts with the initiative", () => {
    const s = toRegroup(board({}, { units: [unit('z', 'SHD_203')], hand: ['WEAK'] }))
    expect([s.activePlayer, hand(s), hand(s, 'opponent')]).toEqual(['opponent', [], ['WEAK']])
    const after = answer(s, { handIndex: 0 })
    expect([hand(after), hand(after, 'opponent')]).toEqual([['GRD', 'GRD'], ['GRD', 'GRD']])
    expect(after.activePlayer).toBe('player')
  })

  it('draws once only, however many regroup-start choices there were', () => {
    const s = toRegroup(board({ units: [unit('z', 'SHD_203')], hand: ['WEAK'] }, { units: [unit('z2', 'SHD_203')], hand: ['WEAK'] }))
    expect(choice(s).kind, 'two at once: the initiative orders them').toBe('chooseTriggerOrder')
    const first = answer(answer(s), { handIndex: 0 })
    expect([hand(first), hand(first, 'opponent')], 'still waiting on the second').toEqual([[], ['WEAK']])
    const after = answer(first, { handIndex: 0 })
    expect([hand(after), hand(after, 'opponent')]).toEqual([['GRD', 'GRD'], ['GRD', 'GRD']])
  })
})

describe('Foresight (TWI_068)', () => {
  const withForesight = (deck: string[]) => board({ units: [unit('h', 'GRD', { upgrades: [{ cardId: 'TWI_068', owner: 'player' }] })], deck })

  it('names a card before the draw; when it is the top card, its controller may reveal and draw it', () => {
    const named = answer(toRegroup(withForesight(['BIG', 'GRD', 'WEAK', 'GRD'])), { cardName: 'Big Unit' })
    expect(hand(named), 'not drawn until they say so').toEqual([])
    const drew = answer(named)
    expect(hand(drew)).toEqual(['BIG', 'GRD', 'WEAK'])
    expect(drew.players.player.deck).toEqual(['GRD'])
  })

  it('declined, or named wrong, leaves the top card for the regroup draw', () => {
    const declined = decline(answer(toRegroup(withForesight(['BIG', 'GRD', 'WEAK'])), { cardName: 'Big Unit' }))
    expect(hand(declined)).toEqual(['BIG', 'GRD'])
    const wrong = answer(toRegroup(withForesight(['BIG', 'GRD', 'WEAK'])), { cardName: 'Weak Unit' })
    expect(wrong.pendingChoices ?? []).toEqual([])
    expect(hand(wrong)).toEqual(['BIG', 'GRD'])
  })
})
