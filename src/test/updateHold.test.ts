import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { holdUpdate, isUpdateHeld, useHoldsUpdate, useUpdateHeld } from '../components/shared/updateHold'

describe('holdUpdate', () => {

  it('holds until released', () => {
    expect(isUpdateHeld()).toBe(false)
    const release = holdUpdate()
    expect(isUpdateHeld()).toBe(true)
    release()
    expect(isUpdateHeld()).toBe(false)
  })

  it('stays held while any hold remains', () => {
    const first = holdUpdate()
    const second = holdUpdate()
    first()
    expect(isUpdateHeld()).toBe(true)
    second()
    expect(isUpdateHeld()).toBe(false)
  })

  it('releasing a hold twice does not release another', () => {
    const first = holdUpdate()
    const second = holdUpdate()
    first()
    first()
    expect(isUpdateHeld()).toBe(true)
    second()
  })

})

describe('useHoldsUpdate', () => {

  it('holds while active, and lets go when it stops being', () => {
    const { rerender, unmount } = renderHook(({ active }) => useHoldsUpdate(active), { initialProps: { active: false } })
    expect(isUpdateHeld()).toBe(false)
    rerender({ active: true })
    expect(isUpdateHeld()).toBe(true)
    rerender({ active: false })
    expect(isUpdateHeld()).toBe(false)
    unmount()
  })

  it('lets go when its component unmounts', () => {
    const { unmount } = renderHook(() => useHoldsUpdate(true))
    expect(isUpdateHeld()).toBe(true)
    unmount()
    expect(isUpdateHeld()).toBe(false)
  })

})

describe('useUpdateHeld', () => {

  it('follows holds taken and released anywhere', () => {
    const { result } = renderHook(() => useUpdateHeld())
    expect(result.current).toBe(false)
    let release = () => {}
    act(() => { release = holdUpdate() })
    expect(result.current).toBe(true)
    act(() => release())
    expect(result.current).toBe(false)
  })

})
