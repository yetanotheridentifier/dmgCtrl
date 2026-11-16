import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { normaliseCard } from '../engine/cardDb'
import { poolFor } from '../bench/setPools'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { GameState, PendingChoice, UnitState } from '../engine/types'

/**
 * Blue Leader (JTL_096), a space unit with Ambush: "When Played: You may pay 2 resources. If you do,
 * move this unit to the ground arena and give 2 Experience tokens to it." The two When Played
 * abilities resolve in the order its controller picks, so whether Ambush has anything to attack is a
 * question for the moment Ambush resolves, not for the moment the unit is played: moved first, it
 * ambushes a ground unit; and an Ambush that ends up with nothing to attack leaves the unit exhausted.
 */
const row = poolFor(['JTL']).find(c => c.Set === 'JTL' && String(c.Number) === '096')!
const BLUE = normaliseCard(row)
const SPC = card({ id: 'SPC', arena: 'space', cost: 1, power: 1, hp: 9 })
const GRD = card({ id: 'GRD', arena: 'ground', cost: 1, power: 1, hp: 9 })
/** `unit` reads the arena from the shared fixture cards only, so the space unit says so itself. */
const ship = () => unit('sp', 'SPC', { arena: 'space' })

const board = (enemies: UnitState[]): GameState => state({
  phase: 'action',
  activePlayer: 'player',
  cards: { ...CARDS, JTL_096: BLUE, SPC, GRD },
  players: {
    player: player({ hand: ['JTL_096'], resources: ready(10), deck: ['GRD'] }),
    opponent: player({ units: enemies, deck: ['GRD'] }),
  },
})

const play = (s: GameState) => resolve(s, { type: 'playUnit', handIndex: 0 })
const head = (s: GameState): PendingChoice | undefined => s.pendingChoices?.[0]
const blue = (s: GameState) => s.players.player.units.find(u => u.cardId === 'JTL_096')!
const accept = (s: GameState) => resolve(s, { type: 'acceptChoice', choiceId: head(s)!.id })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger' })
/** Answers the trigger-order question with whichever ability raises a choice of `kind` (or none). */
const orderFirst = (s: GameState, first: 'ambush' | 'pay'): GameState => {
  const choice = head(s)!
  expect(choice.kind).toBe('chooseNextTrigger')
  const options = legalMoves(s).map(m => resolve(s, m))
  const pick = options.find(o => (head(o)?.kind === 'ambush') === (first === 'ambush'))
  expect(pick).toBeDefined()
  return pick!
}
const attackTargets = (s: GameState) => legalMoves(s).flatMap(m => (m.type === 'attack' && m.target.kind === 'unit' ? [m.target.instanceId] : []))

describe('Blue Leader (JTL_096): Ambush and the pay-2 move, in either order', () => {
  it('ambushes a ground unit once the move has resolved, when there is nothing to ambush in space', () => {
    const s = play(board([unit('g', 'GRD')]))
    // Ambush has nothing in space, so its place in the order cannot show: only the pay is asked.
    expect(head(s)?.kind).not.toBe('chooseNextTrigger')
    expect(head(s)?.kind).not.toBe('ambush')
    const moved = accept(s)
    expect(blue(moved).arena).toBe('ground')
    expect(head(moved)?.kind).toBe('ambush')
    expect(blue(moved).exhausted).toBe(false)
    expect(attackTargets(moved)).toEqual(['g'])
    // Declining the Ambush leaves it exhausted, as any declined Ambush does.
    const declined = skip(moved)
    expect(blue(declined).exhausted).toBe(true)
    expect(declined.pendingChoices ?? []).toEqual([])
  })

  it('stays in space and exhausted when the move is declined and there is nothing in space', () => {
    const declined = skip(play(board([unit('g', 'GRD')])))
    expect(blue(declined).arena).toBe('space')
    expect(blue(declined).exhausted).toBe(true)
    expect(declined.pendingChoices ?? []).toEqual([])
  })

  it('ends exhausted when it moves to the ground first and only space units were there to ambush', () => {
    const s = play(board([ship()]))
    const moved = accept(orderFirst(s, 'pay'))
    expect(blue(moved).arena).toBe('ground')
    expect(moved.pendingChoices ?? []).toEqual([])
    expect(blue(moved).exhausted).toBe(true)
  })

  it('ambushes in space first and then moves, when its controller orders it that way', () => {
    const s = orderFirst(play(board([ship()])), 'ambush')
    expect(attackTargets(s)).toEqual(['sp'])
    const attacked = resolve(s, legalMoves(s).find(m => m.type === 'attack')!)
    const moved = accept(attacked)
    expect(blue(moved).arena).toBe('ground')
    expect(blue(moved).exhausted).toBe(true)
  })

  it('offers the order when both arenas have a target, and ambushes on the ground after the move', () => {
    const s = play(board([ship(), unit('g', 'GRD')]))
    const moved = accept(orderFirst(s, 'pay'))
    expect(head(moved)?.kind).toBe('ambush')
    expect(attackTargets(moved)).toEqual(['g'])
  })
})
