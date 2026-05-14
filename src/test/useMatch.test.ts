import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMatch } from '../hooks/useMatch'

describe('useMatch', () => {

  describe('initial state', () => {
    it('playerScore defaults to 0', () => {
      const { result } = renderHook(() => useMatch('bo1'))
      expect(result.current.playerScore).toBe(0)
    })

    it('opponentScore defaults to 0', () => {
      const { result } = renderHook(() => useMatch('bo1'))
      expect(result.current.opponentScore).toBe(0)
    })

    it('matchOver is false initially for bo1', () => {
      const { result } = renderHook(() => useMatch('bo1'))
      expect(result.current.matchOver).toBe(false)
    })

    it('matchOver is false initially for bo3', () => {
      const { result } = renderHook(() => useMatch('bo3'))
      expect(result.current.matchOver).toBe(false)
    })
  })

  describe('incrementPlayerScore', () => {
    it('increments playerScore by 1', () => {
      const { result } = renderHook(() => useMatch('bo3'))
      act(() => result.current.incrementPlayerScore())
      expect(result.current.playerScore).toBe(1)
    })
  })

  describe('incrementOpponentScore', () => {
    it('increments opponentScore by 1', () => {
      const { result } = renderHook(() => useMatch('bo3'))
      act(() => result.current.incrementOpponentScore())
      expect(result.current.opponentScore).toBe(1)
    })
  })

  describe('bo1 matchOver', () => {
    it('matchOver becomes true when playerScore reaches 1', () => {
      const { result } = renderHook(() => useMatch('bo1'))
      act(() => result.current.incrementPlayerScore())
      expect(result.current.matchOver).toBe(true)
    })

    it('matchOver becomes true when opponentScore reaches 1', () => {
      const { result } = renderHook(() => useMatch('bo1'))
      act(() => result.current.incrementOpponentScore())
      expect(result.current.matchOver).toBe(true)
    })

    it('playerScore does not exceed 1', () => {
      const { result } = renderHook(() => useMatch('bo1'))
      act(() => result.current.incrementPlayerScore())
      act(() => result.current.incrementPlayerScore())
      expect(result.current.playerScore).toBe(1)
    })

    it('opponentScore does not exceed 1', () => {
      const { result } = renderHook(() => useMatch('bo1'))
      act(() => result.current.incrementOpponentScore())
      act(() => result.current.incrementOpponentScore())
      expect(result.current.opponentScore).toBe(1)
    })
  })

  describe('bo3 matchOver', () => {
    it('matchOver is false when playerScore is 1', () => {
      const { result } = renderHook(() => useMatch('bo3'))
      act(() => result.current.incrementPlayerScore())
      expect(result.current.matchOver).toBe(false)
    })

    it('matchOver becomes true when playerScore reaches 2', () => {
      const { result } = renderHook(() => useMatch('bo3'))
      act(() => result.current.incrementPlayerScore())
      act(() => result.current.incrementPlayerScore())
      expect(result.current.matchOver).toBe(true)
    })

    it('matchOver becomes true when opponentScore reaches 2', () => {
      const { result } = renderHook(() => useMatch('bo3'))
      act(() => result.current.incrementOpponentScore())
      act(() => result.current.incrementOpponentScore())
      expect(result.current.matchOver).toBe(true)
    })

    it('playerScore does not exceed 2', () => {
      const { result } = renderHook(() => useMatch('bo3'))
      act(() => result.current.incrementPlayerScore())
      act(() => result.current.incrementPlayerScore())
      act(() => result.current.incrementPlayerScore())
      expect(result.current.playerScore).toBe(2)
    })

    it('opponentScore does not exceed 2', () => {
      const { result } = renderHook(() => useMatch('bo3'))
      act(() => result.current.incrementOpponentScore())
      act(() => result.current.incrementOpponentScore())
      act(() => result.current.incrementOpponentScore())
      expect(result.current.opponentScore).toBe(2)
    })
  })

  describe('resetMatch', () => {
    it('resets playerScore to 0', () => {
      const { result } = renderHook(() => useMatch('bo3'))
      act(() => result.current.incrementPlayerScore())
      act(() => result.current.resetMatch())
      expect(result.current.playerScore).toBe(0)
    })

    it('resets opponentScore to 0', () => {
      const { result } = renderHook(() => useMatch('bo3'))
      act(() => result.current.incrementOpponentScore())
      act(() => result.current.resetMatch())
      expect(result.current.opponentScore).toBe(0)
    })

    it('resets matchOver to false', () => {
      const { result } = renderHook(() => useMatch('bo3'))
      act(() => result.current.incrementPlayerScore())
      act(() => result.current.incrementPlayerScore())
      expect(result.current.matchOver).toBe(true)
      act(() => result.current.resetMatch())
      expect(result.current.matchOver).toBe(false)
    })
  })

  describe('restoreState', () => {
    it('restores playerScore to the given value', () => {
      const { result } = renderHook(() => useMatch('bo3'))
      act(() => result.current.incrementPlayerScore())
      act(() => result.current.restoreState({ playerScore: 0, opponentScore: 0 }))
      expect(result.current.playerScore).toBe(0)
    })

    it('restores opponentScore to the given value', () => {
      const { result } = renderHook(() => useMatch('bo3'))
      act(() => result.current.incrementOpponentScore())
      act(() => result.current.restoreState({ playerScore: 0, opponentScore: 0 }))
      expect(result.current.opponentScore).toBe(0)
    })

    it('matchOver reflects restored scores — false when both are 0', () => {
      const { result } = renderHook(() => useMatch('bo1'))
      act(() => result.current.incrementPlayerScore())
      expect(result.current.matchOver).toBe(true)
      act(() => result.current.restoreState({ playerScore: 0, opponentScore: 0 }))
      expect(result.current.matchOver).toBe(false)
    })

    it('matchOver reflects restored scores — true when scores indicate match over', () => {
      const { result } = renderHook(() => useMatch('bo3'))
      act(() => result.current.restoreState({ playerScore: 2, opponentScore: 0 }))
      expect(result.current.matchOver).toBe(true)
    })

    it('restoring matchDrawn true makes matchOver true', () => {
      const { result } = renderHook(() => useMatch('bo3'))
      act(() => result.current.restoreState({ playerScore: 0, opponentScore: 0, matchDrawn: true }))
      expect(result.current.matchOver).toBe(true)
    })

    it('restoring matchClosedByTimer true makes matchOver true', () => {
      const { result } = renderHook(() => useMatch('bo3'))
      act(() => result.current.restoreState({ playerScore: 0, opponentScore: 0, matchClosedByTimer: true }))
      expect(result.current.matchOver).toBe(true)
    })

    it('restoring matchDrawn false clears a prior recordDraw', () => {
      const { result } = renderHook(() => useMatch('bo3'))
      act(() => result.current.recordDraw())
      expect(result.current.matchOver).toBe(true)
      act(() => result.current.restoreState({ playerScore: 0, opponentScore: 0, matchDrawn: false }))
      expect(result.current.matchOver).toBe(false)
    })
  })

  describe('matchResult', () => {
    it('matchResult is null initially', () => {
      const { result } = renderHook(() => useMatch('bo1'))
      expect(result.current.matchResult).toBeNull()
    })

    it('matchResult is won when playerScore reaches maxScore', () => {
      const { result } = renderHook(() => useMatch('bo1'))
      act(() => result.current.incrementPlayerScore())
      expect(result.current.matchResult).toBe('won')
    })

    it('matchResult is lost when opponentScore reaches maxScore', () => {
      const { result } = renderHook(() => useMatch('bo1'))
      act(() => result.current.incrementOpponentScore())
      expect(result.current.matchResult).toBe('lost')
    })
  })

  describe('recordDraw', () => {
    it('sets matchOver to true', () => {
      const { result } = renderHook(() => useMatch('bo3'))
      act(() => result.current.recordDraw())
      expect(result.current.matchOver).toBe(true)
    })

    it('matchResult is drawn when scores are equal', () => {
      const { result } = renderHook(() => useMatch('bo3'))
      act(() => result.current.recordDraw())
      expect(result.current.matchResult).toBe('drawn')
    })

    it('matchResult is won when playerScore is ahead', () => {
      const { result } = renderHook(() => useMatch('bo3'))
      act(() => result.current.incrementPlayerScore())
      act(() => result.current.recordDraw())
      expect(result.current.matchResult).toBe('won')
    })

    it('matchResult is lost when opponentScore is ahead', () => {
      const { result } = renderHook(() => useMatch('bo3'))
      act(() => result.current.incrementOpponentScore())
      act(() => result.current.recordDraw())
      expect(result.current.matchResult).toBe('lost')
    })

    it('resetMatch clears recordDraw — matchOver becomes false', () => {
      const { result } = renderHook(() => useMatch('bo3'))
      act(() => result.current.recordDraw())
      act(() => result.current.resetMatch())
      expect(result.current.matchOver).toBe(false)
    })

    it('resetMatch clears recordDraw — matchResult becomes null', () => {
      const { result } = renderHook(() => useMatch('bo3'))
      act(() => result.current.recordDraw())
      act(() => result.current.resetMatch())
      expect(result.current.matchResult).toBeNull()
    })
  })

  describe('closeByTimer', () => {
    it('sets matchOver to true', () => {
      const { result } = renderHook(() => useMatch('bo3'))
      act(() => result.current.closeByTimer())
      expect(result.current.matchOver).toBe(true)
    })

    it('matchResult is drawn when scores are equal', () => {
      const { result } = renderHook(() => useMatch('bo3'))
      act(() => result.current.closeByTimer())
      expect(result.current.matchResult).toBe('drawn')
    })

    it('matchResult is won when playerScore is ahead', () => {
      const { result } = renderHook(() => useMatch('bo3'))
      act(() => result.current.incrementPlayerScore())
      act(() => result.current.closeByTimer())
      expect(result.current.matchResult).toBe('won')
    })

    it('matchResult is lost when opponentScore is ahead', () => {
      const { result } = renderHook(() => useMatch('bo3'))
      act(() => result.current.incrementOpponentScore())
      act(() => result.current.closeByTimer())
      expect(result.current.matchResult).toBe('lost')
    })

    it('resetMatch clears closeByTimer — matchOver becomes false', () => {
      const { result } = renderHook(() => useMatch('bo3'))
      act(() => result.current.closeByTimer())
      act(() => result.current.resetMatch())
      expect(result.current.matchOver).toBe(false)
    })

    it('resetMatch clears closeByTimer — matchResult becomes null', () => {
      const { result } = renderHook(() => useMatch('bo3'))
      act(() => result.current.closeByTimer())
      act(() => result.current.resetMatch())
      expect(result.current.matchResult).toBeNull()
    })
  })

})
