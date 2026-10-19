import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useXwingGame, reachesTarget } from '../hooks/useXwingGame'

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

  // --- reaching 50 ---
  // Reaching 50 does not end the game: it ends at the end of that round, so points scored later in
  // the round still count and either player can finish above 50.

  it('reachesTarget is false when both totals are below 50', () => {
    expect(reachesTarget(49, 49)).toBe(false)
  })

  it('reachesTarget is true when the player total reaches 50', () => {
    expect(reachesTarget(50, 0)).toBe(true)
  })

  it('reachesTarget is true when the opponent total reaches 50', () => {
    expect(reachesTarget(0, 50)).toBe(true)
  })

  it('combined totals include scenario points', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementPlayer(46))
    act(() => result.current.incrementOpponent(10))
    act(() => result.current.addScenarioPoints(4, 2))
    expect(result.current.combinedPlayer).toBe(50)
    expect(result.current.combinedOpponent).toBe(12)
  })

  it('gameOver stays false when player reaches 50', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementPlayer(50))
    expect(result.current.gameOver).toBe(false)
  })

  it('gameOver stays false when opponent reaches 50', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementOpponent(50))
    expect(result.current.gameOver).toBe(false)
  })

  it('player score can go past 50', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementPlayer(50))
    act(() => result.current.incrementPlayer(3))
    expect(result.current.playerScore).toBe(53)
  })

  it('opponent score can go past 50', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementOpponent(50))
    act(() => result.current.incrementOpponent(3))
    expect(result.current.opponentScore).toBe(53)
  })

  it('scenario points can be added after a player reaches 50', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementPlayer(50))
    act(() => result.current.addScenarioPoints(2, 4))
    expect(result.current.playerScenarioScore).toBe(2)
    expect(result.current.opponentScenarioScore).toBe(4)
  })

  // --- result ---

  it('result is win when both pass 50 and player has more', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementPlayer(54))
    act(() => result.current.incrementOpponent(51))
    act(() => result.current.endGame())
    expect(result.current.result).toBe('win')
  })

  it('result is loss when both pass 50 and opponent has more', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementPlayer(50))
    act(() => result.current.incrementOpponent(52))
    act(() => result.current.endGame())
    expect(result.current.result).toBe('loss')
  })

  // --- no-ops when game over ---

  it('incrementPlayer no-ops when gameOver', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementPlayer(50))
    act(() => result.current.endGame())
    act(() => result.current.incrementPlayer(1))
    expect(result.current.playerScore).toBe(50)
  })

  it('decrementPlayer no-ops when gameOver', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementPlayer(50))
    act(() => result.current.endGame())
    act(() => result.current.decrementPlayer(1))
    expect(result.current.playerScore).toBe(50)
  })

  it('incrementOpponent no-ops when gameOver', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementOpponent(50))
    act(() => result.current.endGame())
    act(() => result.current.incrementOpponent(1))
    expect(result.current.opponentScore).toBe(50)
  })

  it('decrementOpponent no-ops when gameOver', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementOpponent(50))
    act(() => result.current.endGame())
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
    act(() => result.current.endGame())
    act(() => result.current.reset())
    expect(result.current.gameOver).toBe(false)
  })

  // --- restoreState ---

  it('restoreState sets playerScore', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementPlayer(10))
    act(() => result.current.restoreState({ playerScore: 3, opponentScore: 0, round: 1 }))
    expect(result.current.playerScore).toBe(3)
  })

  it('restoreState sets opponentScore', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementOpponent(15))
    act(() => result.current.restoreState({ playerScore: 0, opponentScore: 7, round: 1 }))
    expect(result.current.opponentScore).toBe(7)
  })

  it('restoreState sets round', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => { result.current.advanceRound(); result.current.advanceRound() })
    act(() => result.current.restoreState({ playerScore: 0, opponentScore: 0, round: 1 }))
    expect(result.current.round).toBe(1)
  })

  it('restoreState clears gameOver when the restored game had not ended', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementPlayer(50))
    act(() => result.current.endGame())
    expect(result.current.gameOver).toBe(true)
    act(() => result.current.restoreState({ playerScore: 50, opponentScore: 0, round: 3 }))
    expect(result.current.gameOver).toBe(false)
  })

  it('restoreState works when called while gameOver is true', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementPlayer(50))
    act(() => result.current.endGame())
    act(() => result.current.restoreState({ playerScore: 20, opponentScore: 10, round: 5 }))
    expect(result.current.playerScore).toBe(20)
    expect(result.current.opponentScore).toBe(10)
    expect(result.current.round).toBe(5)
  })

  it('restoreState to scores above 50 leaves the game running', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.restoreState({ playerScore: 50, opponentScore: 0, round: 6 }))
    expect(result.current.gameOver).toBe(false)
  })

  // --- endGame ---

  it('endGame sets gameOver to true', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.endGame())
    expect(result.current.gameOver).toBe(true)
  })

  it('result is win when player score is higher after endGame', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementPlayer(10))
    act(() => result.current.incrementOpponent(7))
    act(() => result.current.endGame())
    expect(result.current.result).toBe('win')
  })

  it('result is loss when opponent score is higher after endGame', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementPlayer(5))
    act(() => result.current.incrementOpponent(12))
    act(() => result.current.endGame())
    expect(result.current.result).toBe('loss')
  })

  it('result is draw when scores are equal after endGame', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.incrementPlayer(8))
    act(() => result.current.incrementOpponent(8))
    act(() => result.current.endGame())
    expect(result.current.result).toBe('draw')
  })

  it('reset clears gameEnded', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.endGame())
    expect(result.current.gameOver).toBe(true)
    act(() => result.current.reset())
    expect(result.current.gameOver).toBe(false)
  })

  it('reset accepts initial player and opponent scores', () => {
    const { result } = renderHook(() => useXwingGame())
    act(() => result.current.reset(3, 2))
    expect(result.current.playerScore).toBe(3)
    expect(result.current.opponentScore).toBe(2)
  })

})
