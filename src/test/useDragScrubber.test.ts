import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDragScrubber } from '../hooks/useDragScrubber'

// Minimum viable mock events — only the fields the hook reads
const pointerDown = (clientY: number) => ({
  clientY, clientX: 100, currentTarget: { setPointerCapture: vi.fn() },
} as any)

const pointerMove = (clientY: number) => ({ clientY, clientX: 100 } as any)

// Simulate pointerDown then pointerMove. startY=300, FAR_DRAG_END_Y=100 gives delta=200
// which produces raw value 10 before any cap is applied (well above any realistic max in tests).
const FAR_DRAG_END_Y = 100

function drag(result: any, type: '+' | '-', endY = FAR_DRAG_END_Y) {
  act(() => { result.current.handlePointerDown(type)(pointerDown(300)) })
  act(() => { result.current.handlePointerMove(pointerMove(endY)) })
}

describe('useDragScrubber — dynamic upper bounds', () => {

  // --- + button ---

  it('+ drag value is capped at maxIncrement', () => {
    const { result } = renderHook(() => useDragScrubber(vi.fn(), vi.fn(), 4, 20))
    drag(result, '+')
    expect(result.current.dragIndicator?.value).toBe(4)
  })

  it('+ drag applies capped value on release', () => {
    const onIncrement = vi.fn()
    const { result } = renderHook(() => useDragScrubber(onIncrement, vi.fn(), 3, 20))
    drag(result, '+')
    act(() => { result.current.handlePointerUp() })
    expect(onIncrement).toHaveBeenCalledTimes(3)
  })

  it('+ scrubber does not activate when maxIncrement is 1', () => {
    const onIncrement = vi.fn()
    const { result } = renderHook(() => useDragScrubber(onIncrement, vi.fn(), 1, 20))
    drag(result, '+')
    expect(result.current.dragIndicator).toBeNull()
    act(() => { result.current.handlePointerUp() })
    expect(onIncrement).not.toHaveBeenCalled()
  })

  it('+ scrubber does not activate when maxIncrement is 0', () => {
    const onIncrement = vi.fn()
    const { result } = renderHook(() => useDragScrubber(onIncrement, vi.fn(), 0, 20))
    drag(result, '+')
    expect(result.current.dragIndicator).toBeNull()
    act(() => { result.current.handlePointerUp() })
    expect(onIncrement).not.toHaveBeenCalled()
  })

  // --- - button ---

  it('- drag value is capped at maxDecrement', () => {
    const { result } = renderHook(() => useDragScrubber(vi.fn(), vi.fn(), 20, 3))
    drag(result, '-')
    expect(result.current.dragIndicator?.value).toBe(3)
  })

  it('- drag applies capped value on release', () => {
    const onDecrement = vi.fn()
    const { result } = renderHook(() => useDragScrubber(vi.fn(), onDecrement, 20, 3))
    drag(result, '-')
    act(() => { result.current.handlePointerUp() })
    expect(onDecrement).toHaveBeenCalledTimes(3)
  })

  it('- scrubber does not activate when maxDecrement is 1', () => {
    const onDecrement = vi.fn()
    const { result } = renderHook(() => useDragScrubber(vi.fn(), onDecrement, 20, 1))
    drag(result, '-')
    expect(result.current.dragIndicator).toBeNull()
    act(() => { result.current.handlePointerUp() })
    expect(onDecrement).not.toHaveBeenCalled()
  })

  it('- scrubber does not activate when maxDecrement is 0', () => {
    const onDecrement = vi.fn()
    const { result } = renderHook(() => useDragScrubber(vi.fn(), onDecrement, 20, 0))
    drag(result, '-')
    expect(result.current.dragIndicator).toBeNull()
    act(() => { result.current.handlePointerUp() })
    expect(onDecrement).not.toHaveBeenCalled()
  })

})

describe('useDragScrubber — enabled flag', () => {

  it('drag does not activate when enabled is false (+ button)', () => {
    const onIncrement = vi.fn()
    const { result } = renderHook(() => useDragScrubber(onIncrement, vi.fn(), 20, 20, false))
    drag(result, '+')
    expect(result.current.dragIndicator).toBeNull()
    act(() => { result.current.handlePointerUp() })
    expect(onIncrement).not.toHaveBeenCalled()
  })

  it('drag does not activate when enabled is false (- button)', () => {
    const onDecrement = vi.fn()
    const { result } = renderHook(() => useDragScrubber(vi.fn(), onDecrement, 20, 20, false))
    drag(result, '-')
    expect(result.current.dragIndicator).toBeNull()
    act(() => { result.current.handlePointerUp() })
    expect(onDecrement).not.toHaveBeenCalled()
  })

  it('single tap still works when enabled is false (+ button)', () => {
    const onIncrement = vi.fn()
    const { result } = renderHook(() => useDragScrubber(onIncrement, vi.fn(), 20, 20, false))
    act(() => { result.current.handleClick('+')() })
    expect(onIncrement).toHaveBeenCalledOnce()
  })

  it('single tap still works when enabled is false (- button)', () => {
    const onDecrement = vi.fn()
    const { result } = renderHook(() => useDragScrubber(vi.fn(), onDecrement, 20, 20, false))
    act(() => { result.current.handleClick('-')() })
    expect(onDecrement).toHaveBeenCalledOnce()
  })

})