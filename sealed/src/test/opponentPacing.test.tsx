// @vitest-environment jsdom
import { StrictMode } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { db } from '../data/db'
import { useGame } from '../hooks/useGame'
import type { UseGameOptions } from '../hooks/useGame'
import type { SavedDeck } from '../data/deckStore'
import type { SwuCard } from '../data/cards'
import type { GameState } from '../engine/types'
import { legalMoves } from '../engine/legalMoves'

/**
 * Opponent pacing: with a delay set, the opponent's actions are shown one at a time, each no sooner
 * than the delay after the one before it. The delay is a floor on the gap, not a wait added on top of
 * however long the AI took to choose. With no delay the whole reply lands synchronously, as it always
 * has, and both ways record the same game.
 */

const SWU_CARDS: SwuCard[] = [
  { Set: 'TST', Number: '001', Name: 'Test Leader', Type: 'Leader', Cost: '5', Power: '4', HP: '7' },
  { Set: 'TST', Number: '002', Name: 'Test Base', Type: 'Base', HP: '30' },
  { Set: 'TST', Number: '900', Name: 'Small Test Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '3', HP: '3' },
]

const DECK: SavedDeck = {
  id: 'deck-1',
  name: 'Small Deck',
  leader: 'TST_001',
  base: 'TST_002',
  cards: [{ id: 'TST_900', count: 30 }],
  importedAt: 1,
}

const identity = <T,>(arr: T[]) => arr
/** legalMoves puts the do-nothing move last, so the last move is passive in every phase. */
const passiveAi = (s: GameState) => legalMoves(s).at(-1) ?? null
/** The first legal move: plays out its hand, so an opponent left alone takes several actions in a row. */
const eagerAi = (s: GameState) => legalMoves(s)[0] ?? null

const BASE: UseGameOptions = { shuffle: identity, ai: passiveAi, firstPlayer: 'player', rngSeed: 7 }
const DELAY = 500

async function seedCards() {
  for (const card of SWU_CARDS) {
    await db.cards.put({ id: `TST_${card.Number}`, json: card, fetchedAt: 1 })
  }
}

/**
 * A loaded game with the clock faked from here on. Loading runs on real timers (it waits on
 * IndexedDB), and only the timers and the clock are faked, so a later load still completes.
 */
async function startGame(options: UseGameOptions, wrapper?: typeof StrictMode) {
  const hook = renderHook((opts: UseGameOptions) => useGame(DECK, DECK, opts), { initialProps: options, wrapper })
  await waitFor(() => expect(hook.result.current.status).toBe('playing'))
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  return hook
}

type Hook = Awaited<ReturnType<typeof startGame>>

const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })
const finishOpponent = () => act(() => { vi.runAllTimers() })
const moves = (hook: Hook) => hook.result.current.replayData().moves
const opponentMoves = (hook: Hook) => moves(hook).filter(m => m.by === 'opponent').length
const active = (hook: Hook) => hook.result.current.gameState!.activePlayer

/** Through setup to round 1 with the player to act, the opponent's replies played out. */
function toRoundOne(hook: Hook) {
  for (const action of [{ type: 'keepHand' }, { type: 'setupResource', handIndex: 0 }, { type: 'setupResource', handIndex: 0 }] as const) {
    act(() => hook.result.current.act(action))
    finishOpponent()
  }
  expect(hook.result.current.gameState!.phase).toBe('action')
  expect(active(hook)).toBe('player')
}

describe('opponent pacing', () => {
  beforeEach(async () => {
    await db.cards.clear()
    await db.games.clear()
    await seedCards()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the player’s own action at once and the opponent’s reply only after the delay', async () => {
    const hook = await startGame({ ...BASE, opponentDelayMs: DELAY })

    act(() => hook.result.current.act({ type: 'keepHand' }))
    expect(moves(hook)).toEqual([{ by: 'player', action: { type: 'keepHand' } }])
    expect(active(hook)).toBe('opponent')
    expect(hook.result.current.log.filter(e => e.by === 'opponent')).toHaveLength(0)

    advance(DELAY - 1)
    expect(opponentMoves(hook)).toBe(0)

    advance(1)
    expect(opponentMoves(hook)).toBe(1)
    expect(hook.result.current.log.filter(e => e.by === 'opponent' && !e.outcome)).toHaveLength(1)
    expect(active(hook)).toBe('player')
  })

  it('shows consecutive opponent actions one delay apart, each with its own log lines', async () => {
    const hook = await startGame({ ...BASE, opponentDelayMs: DELAY })
    act(() => hook.result.current.act({ type: 'keepHand' }))
    finishOpponent()
    act(() => hook.result.current.act({ type: 'setupResource', handIndex: 0 }))
    const before = opponentMoves(hook)
    const logBefore = hook.result.current.log.length

    // The player's second resource hands the opponent its own two.
    act(() => hook.result.current.act({ type: 'setupResource', handIndex: 0 }))
    expect(opponentMoves(hook)).toBe(before)
    expect(hook.result.current.log).toHaveLength(logBefore + 1)

    advance(DELAY)
    expect(opponentMoves(hook)).toBe(before + 1)
    expect(hook.result.current.log.filter(e => e.by === 'opponent' && !e.outcome)).toHaveLength(before + 1)
    expect(active(hook)).toBe('opponent')

    advance(DELAY - 1)
    expect(opponentMoves(hook)).toBe(before + 1)

    advance(1)
    expect(opponentMoves(hook)).toBe(before + 2)
    expect(hook.result.current.gameState!.phase).toBe('action')
    expect(active(hook)).toBe('player')
    expect(vi.getTimerCount()).toBe(0)
  })

  /**
   * The delay is a floor. An AI that takes longer than the delay to choose has already kept the player
   * waiting, so its action shows as soon as it is ready; the next one is held to the delay again.
   */
  it('adds no wait on top of an AI that took longer than the delay to choose', async () => {
    const slow = { onCall: 0, ms: 0 }
    let calls = 0
    const ai = (s: GameState) => {
      calls++
      // Thinking is synchronous, so the time it takes is time the clock moves with no timer firing.
      if (calls === slow.onCall) vi.setSystemTime(Date.now() + slow.ms)
      return eagerAi(s)
    }
    const hook = await startGame({ ...BASE, ai, opponentDelayMs: DELAY })
    toRoundOne(hook)
    const before = opponentMoves(hook)
    slow.onCall = calls + 2
    slow.ms = 800

    // With the initiative taken the player is out of the round, so the opponent plays on alone.
    act(() => hook.result.current.act({ type: 'takeInitiative' }))
    advance(DELAY)
    expect(opponentMoves(hook)).toBe(before + 1)
    expect(active(hook)).toBe('opponent')

    // The second choice takes 800ms: it is shown the moment it is made, not 500ms after that.
    advance(80)
    expect(calls).toBe(slow.onCall)
    expect(opponentMoves(hook)).toBe(before + 2)

    // The third is a fast choice again, so it waits out the delay from when the second was shown.
    advance(DELAY - 80)
    expect(opponentMoves(hook)).toBe(before + 2)
    advance(80)
    expect(opponentMoves(hook)).toBe(before + 3)
  })

  it('takes no input while the opponent’s actions are pending', async () => {
    const hook = await startGame({ ...BASE, ai: eagerAi, opponentDelayMs: DELAY })
    toRoundOne(hook)
    expect(hook.result.current.canUndo).toBe(true)

    act(() => hook.result.current.act({ type: 'takeInitiative' }))
    advance(DELAY)
    const shown = hook.result.current.gameState
    const recorded = moves(hook)

    expect(active(hook)).toBe('opponent')
    expect(hook.result.current.legal).toEqual([])
    expect(hook.result.current.canUndo).toBe(false)
    expect(hook.result.current.cancelChoice).toBeUndefined()
    act(() => hook.result.current.act({ type: 'pass' }))
    act(() => hook.result.current.undo())
    expect(hook.result.current.gameState).toBe(shown)
    expect(moves(hook)).toEqual(recorded)

    finishOpponent()
    expect(hook.result.current.canUndo).toBe(true)
  })

  it('undoes to before the player’s own action once the opponent has finished', async () => {
    const hook = await startGame({ ...BASE, ai: eagerAi, opponentDelayMs: DELAY })
    toRoundOne(hook)
    const before = hook.result.current.gameState
    const movesBefore = moves(hook)
    const logBefore = hook.result.current.log

    act(() => hook.result.current.act({ type: 'takeInitiative' }))
    finishOpponent()
    expect(opponentMoves(hook)).toBeGreaterThan(movesBefore.filter(m => m.by === 'opponent').length + 1)

    act(() => hook.result.current.undo())
    expect(hook.result.current.gameState).toBe(before)
    expect(moves(hook)).toEqual(movesBefore)
    expect(hook.result.current.log).toEqual(logBefore)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('applies no pending opponent action to a new game', async () => {
    const hook = await startGame({ ...BASE, ai: eagerAi, opponentDelayMs: DELAY })
    toRoundOne(hook)
    act(() => hook.result.current.act({ type: 'takeInitiative' }))
    advance(DELAY)
    expect(active(hook)).toBe('opponent')

    act(() => hook.result.current.rematch())
    expect(vi.getTimerCount()).toBe(0)
    finishOpponent()
    vi.useRealTimers()
    await waitFor(() => expect(hook.result.current.status).toBe('playing'))

    expect(moves(hook)).toEqual([])
    expect(hook.result.current.log).toEqual([])
    expect(hook.result.current.canUndo).toBe(false)
    expect(hook.result.current.gameState!.phase).toBe('setup')
    expect(active(hook)).toBe('player')
  })

  it('drops the pending opponent actions when the game is left', async () => {
    const hook = await startGame({ ...BASE, ai: eagerAi, opponentDelayMs: DELAY })
    toRoundOne(hook)
    act(() => hook.result.current.act({ type: 'takeInitiative' }))
    advance(DELAY)
    const recorded = moves(hook)

    hook.unmount()
    expect(vi.getTimerCount()).toBe(0)
    vi.runAllTimers()
    expect(moves(hook)).toEqual(recorded)
  })

  it('finishes the opponent’s turn without further waits when the delay is switched off mid-turn', async () => {
    const hook = await startGame({ ...BASE, ai: eagerAi, opponentDelayMs: DELAY })
    toRoundOne(hook)
    act(() => hook.result.current.act({ type: 'takeInitiative' }))
    advance(DELAY)
    expect(active(hook)).toBe('opponent')

    hook.rerender({ ...BASE, ai: eagerAi, opponentDelayMs: 0 })
    // The action already being waited on arrives on time, and the rest of the turn with it.
    advance(DELAY)
    expect(active(hook)).toBe('player')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('paces a turn started after the delay is switched on mid-game', async () => {
    const hook = await startGame({ ...BASE, opponentDelayMs: 0 })
    act(() => hook.result.current.act({ type: 'keepHand' }))
    expect(active(hook)).toBe('player')
    expect(vi.getTimerCount()).toBe(0)

    hook.rerender({ ...BASE, opponentDelayMs: DELAY })
    act(() => hook.result.current.act({ type: 'setupResource', handIndex: 0 }))
    act(() => hook.result.current.act({ type: 'setupResource', handIndex: 0 }))
    expect(active(hook)).toBe('opponent')
    finishOpponent()
    expect(active(hook)).toBe('player')
  })

  it('logs each opponent action once under StrictMode', async () => {
    const hook = await startGame({ ...BASE, opponentDelayMs: DELAY }, StrictMode)
    act(() => hook.result.current.act({ type: 'keepHand' }))
    finishOpponent()

    expect(opponentMoves(hook)).toBe(1)
    expect(hook.result.current.log.filter(e => e.by === 'opponent' && !e.outcome)).toHaveLength(1)
  })

  /** Both sides take their first legal move until the game ends or the cap is reached. */
  function playOut(hook: Hook) {
    for (let i = 0; i < 150 && hook.result.current.gameState!.winner === null; i++) {
      const move = hook.result.current.legal[0]
      if (!move) break
      act(() => hook.result.current.act(move))
      finishOpponent()
    }
    return { moves: moves(hook), state: hook.result.current.gameState!, log: hook.result.current.log }
  }

  it('records the same moves, log and final state paced as instant', async () => {
    const instantHook = await startGame({ ...BASE, ai: eagerAi })
    const instant = playOut(instantHook)
    instantHook.unmount()
    vi.useRealTimers()

    const pacedHook = await startGame({ ...BASE, ai: eagerAi, opponentDelayMs: DELAY })
    const paced = playOut(pacedHook)

    expect(instant.moves.filter(m => m.by === 'opponent').length).toBeGreaterThan(20)
    expect(paced.moves).toEqual(instant.moves)
    expect(paced.log).toEqual(instant.log)
    expect(paced.state).toEqual(instant.state)
  })

  describe('when the opponent acts first', () => {
    it('shows the opening board before the opponent’s first action', async () => {
      const hook = renderHook(() => useGame(DECK, DECK, { ...BASE, firstPlayer: 'opponent', opponentDelayMs: 60_000 }))
      await waitFor(() => expect(hook.result.current.status).toBe('playing'))

      expect(hook.result.current.replayData().moves).toEqual([])
      expect(hook.result.current.gameState!.activePlayer).toBe('opponent')
      expect(hook.result.current.legal).toEqual([])
    })

    it('reaches the same position as an instant start', async () => {
      const instant = renderHook(() => useGame(DECK, DECK, { ...BASE, firstPlayer: 'opponent' }))
      await waitFor(() => expect(instant.result.current.status).toBe('playing'))
      expect(instant.result.current.gameState!.activePlayer).toBe('player')

      const paced = renderHook(() => useGame(DECK, DECK, { ...BASE, firstPlayer: 'opponent', opponentDelayMs: 20 }))
      await waitFor(() => expect(paced.result.current.gameState?.activePlayer).toBe('player'))

      expect(paced.result.current.replayData().moves).toEqual(instant.result.current.replayData().moves)
      expect(paced.result.current.gameState).toEqual(instant.result.current.gameState)
      expect(paced.result.current.log).toEqual(instant.result.current.log)
    })
  })
})
