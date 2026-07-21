import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import '../engine/cardDefinitions' // side-effect: registers every implemented card
import { state, player, card, CARDS, unit, ready } from './helpers/engineFixtures'
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

/**
 * An attack can *resolve* a pending choice (Ambush, Support, Grogu's "you may attack" on taking
 * the initiative). When it does, it must finish the same deferred work that answering the choice
 * through the menu would — above all the turn transition `takeInitiative` parked while the choice
 * was outstanding. Bare `advanceTurn` skipped it, stranding `pendingInitiativeEndsPhase` set: the
 * action phase carried on when it should have ended, and the flag stayed armed to force a regroup
 * at some unrelated later moment.
 */
describe('an attack that resolves a choice completes the deferred transition', () => {
  const GROGU = card({ id: 'ASH_155', name: 'Grogu', type: 'unit', power: 2, hp: 3 })
  const SHIP = card({ id: 'SHIP', name: "Survivors' Langskib", type: 'unit', power: 4, hp: 4 })

  /** The opponent has just passed, so taking the initiative ends the action phase (CR 1.15.5c). */
  const afterOpponentPassed = () => state({
    phase: 'action',
    activePlayer: 'player',
    initiative: 'opponent',
    initiativeTakenBy: null,
    consecutivePasses: 1,
    cards: { ...CARDS, ASH_155: GROGU, SHIP },
    players: {
      player: player({ deck: ['D1', 'D2'], resources: ready(5), units: [unit('g', 'ASH_155'), unit('sh', 'SHIP')] }),
      opponent: player({ deck: ['D1', 'D2'] }),
    },
  })

  it('ends the phase after the granted attack is taken', () => {
    const took = resolve(afterOpponentPassed(), { type: 'takeInitiative' })
    expect(took.pendingChoices?.[0].kind).toBe('mayAttackAnyUnit')
    expect(took.pendingInitiativeEndsPhase).toBe(true)

    const attacked = resolve(took, { type: 'attack', attackerId: 'sh', target: { kind: 'base' } })
    expect(attacked.phase).toBe('regroup') // the parked transition ran
    expect(attacked.pendingInitiativeEndsPhase).toBeUndefined() // …and disarmed
    assertAnswerable(attacked, 'after a granted attack ended the phase')
  })

  it('ends the phase just the same when the granted attack is declined', () => {
    const took = resolve(afterOpponentPassed(), { type: 'takeInitiative' })
    const skipped = resolve(took, { type: 'skipTrigger', choiceId: took.pendingChoices![0].id })
    expect(skipped.phase).toBe('regroup')
    expect(skipped.pendingInitiativeEndsPhase).toBeUndefined()
  })

  /**
   * Taking the initiative ends the phase for the TAKER only: they auto-pass for the rest of the
   * round while the opponent keeps acting until they pass too (the phase ends immediately only
   * when the opponent had already passed, CR 1.15.5c). Resolving the granted attack must not
   * short-circuit that.
   */
  it('leaves the opponent free to act, and the taker out, when the phase did NOT end', () => {
    const midPhase = () => {
      const base = afterOpponentPassed()
      return {
        ...base,
        consecutivePasses: 0,
        players: { ...base.players, opponent: player({ deck: ['D1', 'D2'], hand: ['TST_U2', 'TST_U2'], resources: ready(6) }) },
      }
    }
    const took = resolve(midPhase(), { type: 'takeInitiative' })
    expect(took.pendingInitiativeEndsPhase).toBe(false)

    const attacked = resolve(took, { type: 'attack', attackerId: 'sh', target: { kind: 'base' } })
    expect(attacked.phase).toBe('action')
    expect(attacked.activePlayer).toBe('opponent')
    expect(attacked.pendingInitiativeEndsPhase).toBeUndefined()

    // The opponent keeps the turn across successive actions — it never bounces back to the taker,
    // who has auto-passed for the round.
    const played = resolve(attacked, { type: 'playUnit', handIndex: 0 })
    expect(played.activePlayer).toBe('opponent')
    expect(played.phase).toBe('action')
    const playedAgain = resolve(played, { type: 'playUnit', handIndex: 0 })
    expect(playedAgain.activePlayer).toBe('opponent')
    expect(playedAgain.phase).toBe('action')

    // Only when the opponent passes does the round move on.
    expect(resolve(playedAgain, { type: 'pass' }).phase).toBe('regroup')
    assertAnswerable(attacked, 'after a granted attack mid-phase')
  })
})

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
