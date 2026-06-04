import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePhaseTracker } from '../hooks/usePhaseTracker'

const PHASES = ['Planning', 'System', 'Activation', 'Engagement', 'End'] as const

describe('usePhaseTracker', () => {

  it('starts on the first phase', () => {
    const { result } = renderHook(() => usePhaseTracker(PHASES))
    expect(result.current.phase).toBe('Planning')
    expect(result.current.phaseIndex).toBe(0)
  })

  it('advance moves to the next phase', () => {
    const { result } = renderHook(() => usePhaseTracker(PHASES))
    act(() => result.current.advance())
    expect(result.current.phase).toBe('System')
    expect(result.current.phaseIndex).toBe(1)
  })

  it('advance steps through all phases in order', () => {
    const { result } = renderHook(() => usePhaseTracker(PHASES))
    act(() => result.current.advance())
    expect(result.current.phase).toBe('System')
    act(() => result.current.advance())
    expect(result.current.phase).toBe('Activation')
    act(() => result.current.advance())
    expect(result.current.phase).toBe('Engagement')
    act(() => result.current.advance())
    expect(result.current.phase).toBe('End')
  })

  it('isLastPhase is false for non-final phases', () => {
    const { result } = renderHook(() => usePhaseTracker(PHASES))
    expect(result.current.isLastPhase).toBe(false)
    act(() => result.current.advance())
    expect(result.current.isLastPhase).toBe(false)
  })

  it('isLastPhase is true on the final phase', () => {
    const { result } = renderHook(() => usePhaseTracker(PHASES))
    for (let i = 0; i < PHASES.length - 1; i++) {
      act(() => result.current.advance())
    }
    expect(result.current.isLastPhase).toBe(true)
    expect(result.current.phase).toBe('End')
  })

  it('reset returns to the first phase from any position', () => {
    const { result } = renderHook(() => usePhaseTracker(PHASES))
    act(() => result.current.advance())
    act(() => result.current.advance())
    act(() => result.current.reset())
    expect(result.current.phase).toBe('Planning')
    expect(result.current.phaseIndex).toBe(0)
  })

  it('restore sets phase to the specified index', () => {
    const { result } = renderHook(() => usePhaseTracker(PHASES))
    act(() => result.current.restore(3))
    expect(result.current.phase).toBe('Engagement')
    expect(result.current.phaseIndex).toBe(3)
  })

  it('works with a different set of phases', () => {
    const killTeamPhases = ['Initiative', 'Movement', 'Firefight', 'Morale'] as const
    const { result } = renderHook(() => usePhaseTracker(killTeamPhases))
    expect(result.current.phase).toBe('Initiative')
    act(() => result.current.advance())
    expect(result.current.phase).toBe('Movement')
    act(() => result.current.advance())
    act(() => result.current.advance())
    expect(result.current.isLastPhase).toBe(true)
    expect(result.current.phase).toBe('Morale')
  })

})
