import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useXwingGame } from '../hooks/useXwingGame'

describe('useXwingGame', () => {

  // --- Initial state ---

  it('player score initialises to 0', () => {
    const { result } = renderHook(() => useXwingGame())
    expect(result.current.playerScore).toBe(0)
  })

  it('opponent score initialises to 0', () => {
    const { result } = renderHook(() => useXwingGame())
    expect(result.current.opponentScore).toBe(0)
  })

  it('round starts at 1', () => {
    const { result } = renderHook(() => useXwingGame())
    expect(result.current.round).toBe(1)
  })

  it('gameOver is false below 50', () => {
    const { result } = renderHook(() => useXwingGame())
    expect(result.current.gameOver).toBe(false)
  })

  it('result is null when game is not over', () => {
    const { result } = renderHook(() => useXwingGame())
    expect(result.current.result).toBeNull()
  })

  // --- incrementPlayer ---

  it('incrementPlayer adds 1 to player score when called with 1', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementPlayer(1))
    expect(result.current.playerScore).toBe(1)
  })

  it('incrementPlayer adds n to player score', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementPlayer(7))
    expect(result.current.playerScore).toBe(7)
  })

  // --- decrementPlayer ---

  it('decrementPlayer removes 1 from player score when called with 1', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementPlayer(1))
    act(() => result.current.decrementPlayer(1))
    expect(result.current.playerScore).toBe(0)
  })

  it('decrementPlayer removes n from player score', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementPlayer(10))
    act(() => result.current.decrementPlayer(4))
    expect(result.current.playerScore).toBe(6)
  })

  it('decrementPlayer clamps at 0', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.decrementPlayer(1))
    expect(result.current.playerScore).toBe(0)
  })

  it('decrementPlayer clamps at 0 when n would overshoot', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementPlayer(3))
    act(() => result.current.decrementPlayer(10))
    expect(result.current.playerScore).toBe(0)
  })

  // --- incrementOpponent ---

  it('incrementOpponent adds 1 to opponent score when called with 1', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementOpponent(1))
    expect(result.current.opponentScore).toBe(1)
  })

  it('incrementOpponent adds n to opponent score', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementOpponent(5))
    expect(result.current.opponentScore).toBe(5)
  })

  // --- decrementOpponent ---

  it('decrementOpponent removes 1 from opponent score when called with 1', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementOpponent(1))
    act(() => result.current.decrementOpponent(1))
    expect(result.current.opponentScore).toBe(0)
  })

  it('decrementOpponent removes n from opponent score', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementOpponent(8))
    act(() => result.current.decrementOpponent(3))
    expect(result.current.opponentScore).toBe(5)
  })

  it('decrementOpponent clamps at 0', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.decrementOpponent(1))
    expect(result.current.opponentScore).toBe(0)
  })

  it('decrementOpponent clamps at 0 when n would overshoot', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementOpponent(2))
    act(() => result.current.decrementOpponent(10))
    expect(result.current.opponentScore).toBe(0)
  })

  // --- gameOver at 50 ---

  it('gameOver is false at 49', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementPlayer(49))
    expect(result.current.gameOver).toBe(false)
  })

  it('gameOver is true when player reaches 50', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementPlayer(50))
    expect(result.current.gameOver).toBe(true)
  })

  it('gameOver is true when opponent reaches 50', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementOpponent(50))
    expect(result.current.gameOver).toBe(true)
  })

  // --- result ---

  it('result is win when player reaches 50', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementPlayer(50))
    expect(result.current.result).toBe('win')
  })

  it('result is loss when opponent reaches 50', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementOpponent(50))
    expect(result.current.result).toBe('loss')
  })

  // --- no-ops when game over ---

  it('incrementPlayer no-ops when gameOver', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementPlayer(50))
    act(() => result.current.incrementPlayer(1))
    expect(result.current.playerScore).toBe(50)
  })

  it('decrementPlayer no-ops when gameOver', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementPlayer(50))
    act(() => result.current.decrementPlayer(1))
    expect(result.current.playerScore).toBe(50)
  })

  it('incrementOpponent no-ops when gameOver', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementOpponent(50))
    act(() => result.current.incrementOpponent(1))
    expect(result.current.opponentScore).toBe(50)
  })

  it('decrementOpponent no-ops when gameOver', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementOpponent(50))
    act(() => result.current.decrementOpponent(1))
    expect(result.current.opponentScore).toBe(50)
  })

  // --- advanceRound ---

  it('advanceRound increments round', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.advanceRound())
    expect(result.current.round).toBe(2)
  })

  it('advanceRound clamps at 12', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => { for (let i = 0; i < 15; i++) result.current.advanceRound() })
    expect(result.current.round).toBe(12)
  })

  // --- reset ---

  it('reset returns player score to 0', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementPlayer(10))
    act(() => result.current.reset())
    expect(result.current.playerScore).toBe(0)
  })

  it('reset returns opponent score to 0', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementOpponent(10))
    act(() => result.current.reset())
    expect(result.current.opponentScore).toBe(0)
  })

  it('reset returns round to 1', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.advanceRound())
    act(() => result.current.reset())
    expect(result.current.round).toBe(1)
  })

  it('reset returns gameOver to false', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementPlayer(50))
    act(() => result.current.reset())
    expect(result.current.gameOver).toBe(false)
  })

})
