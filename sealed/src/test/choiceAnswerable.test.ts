import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import '../engine/cardDefinitions' // side-effect: registers every implemented card
import { state, player, card, CARDS, unit } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'

/**
 * A pending choice must always be answerable by *somebody*. A choice belongs to whoever the card
 * says (the U-Wing's controller distributes its token, whichever side that is), but `choiceMoves`
 * only offers the active player's choices, so raising one for the other side without handing over
 * `activePlayer` leaves a board with zero legal moves and hangs the game (#365).
 *
 * This is the guard for the whole class, not just the card that exposed it.
 */
export function assertAnswerable(s: GameState, label: string) {
  if (s.winner !== null) return
  const moves = legalMoves(s)
  const owners = [...new Set((s.pendingChoices ?? []).map(c => c.controller))]
  expect(moves.length, `${label}: no legal move (phase=${s.phase}, active=${s.activePlayer}, choices owned by ${owners.join()})`).toBeGreaterThan(0)
}

const UWING = card({ id: 'ASH_159', name: 'Alphabet Squadron U-Wing', type: 'unit', arena: 'space', power: 3, hp: 3 })

/** One pass away from ending the phase, with a deck to draw from at regroup. */
function aboutToRegroup(uwingOwner: 'player' | 'opponent'): GameState {
  const withUwing = { units: [unit('u9', 'ASH_159')] }
  return state({
    phase: 'action',
    activePlayer: 'player',
    initiative: 'player',
    consecutivePasses: 1,
    cards: { ...CARDS, ASH_159: UWING },
    players: {
      player: player({ deck: ['D1', 'D2', 'D3', 'D4'], ...(uwingOwner === 'player' ? withUwing : {}) }),
      opponent: player({ deck: ['D1', 'D2', 'D3', 'D4'], ...(uwingOwner === 'opponent' ? withUwing : {}) }),
    },
  })
}

describe('a raised choice is always answerable', () => {
  it('regroup trigger owned by the initiative holder', () => {
    const after = resolve(aboutToRegroup('player'), { type: 'pass' })
    expect(after.phase).toBe('regroup')
    assertAnswerable(after, 'regroup, choice owned by initiative holder')
  })

  /** The case that hung: the choice is correctly the opponent's, but the turn never went to them. */
  it('regroup trigger owned by the player WITHOUT the initiative', () => {
    const after = resolve(aboutToRegroup('opponent'), { type: 'pass' })
    expect(after.phase).toBe('regroup')
    expect(after.pendingChoices?.[0].controller).toBe('opponent') // the card's controller decides
    expect(after.activePlayer).toBe('opponent') // …so the turn must be theirs to answer it
    assertAnswerable(after, 'regroup, choice owned by non-initiative player')
  })

  it('hands back to the initiative holder to resource once the choice drains', () => {
    const after = resolve(aboutToRegroup('opponent'), { type: 'pass' })
    const choiceId = after.pendingChoices![0].id
    const resolved = resolve(after, { type: 'acceptChoice', choiceId, targetInstanceId: 'u9' })

    expect(resolved.pendingChoices ?? []).toHaveLength(0)
    expect(resolved.phase).toBe('regroup')
    expect(resolved.activePlayer).toBe('player') // initiative holder resources first
    assertAnswerable(resolved, 'regroup after the choice drained')
    expect(legalMoves(resolved).some(m => m.type === 'skipResource')).toBe(true)
  })

  it('both sides holding a regroup trigger each get to answer', () => {
    const both = state({
      phase: 'action',
      activePlayer: 'player',
      initiative: 'player',
      consecutivePasses: 1,
      cards: { ...CARDS, ASH_159: UWING },
      players: {
        player: player({ deck: ['D1', 'D2', 'D3', 'D4'], units: [unit('u1', 'ASH_159')] }),
        opponent: player({ deck: ['D1', 'D2', 'D3', 'D4'], units: [unit('u9', 'ASH_159')] }),
      },
    })
    let s = resolve(both, { type: 'pass' })
    for (let i = 0; i < 4 && (s.pendingChoices ?? []).length > 0; i++) {
      assertAnswerable(s, `both-sided regroup, step ${i}`)
      const choice = s.pendingChoices!.find(c => c.controller === s.activePlayer)
      expect(choice, `step ${i}: active player has nothing to answer`).toBeTruthy()
      s = resolve(s, { type: 'acceptChoice', choiceId: choice!.id, targetInstanceId: 'u1' })
    }
    expect(s.pendingChoices ?? []).toHaveLength(0)
    assertAnswerable(s, 'both-sided regroup, drained')
  })
})
