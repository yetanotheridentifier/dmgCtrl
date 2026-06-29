import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSquadSlot } from '../hooks/useSquadSlot'

const VALID_XWS = JSON.stringify({
  pilots: [
    { name: 'asajjventress', ship: 'lancerclasspursuitcraft', points: 15 },
    { name: 'bobafett-armedanddangerous', ship: 'firesprayclasspatrolcraft', points: 18 },
    { name: 'bossk', ship: 'yv666lightfreighter', points: 17 },
  ],
  points: 50,
})

const XWS_LOW_POINTS = JSON.stringify({
  pilots: [
    { name: 'pilota', ship: 'shipa', points: 15 },
    { name: 'pilotb', ship: 'shipb', points: 15 },
    { name: 'pilotc', ship: 'shipc', points: 15 },
  ],
  points: 45,
})

const XWS_TOO_FEW_SHIPS = JSON.stringify({
  pilots: [
    { name: 'pilota', ship: 'shipa', points: 25 },
    { name: 'pilotb', ship: 'shipb', points: 25 },
  ],
  points: 50,
})

describe('useSquadSlot', () => {

  // --- Initial state ---

  it('starts with empty text', () => {
    const { result } = renderHook(() => useSquadSlot())
    expect(result.current.text).toBe('')
  })

  it('starts with no error', () => {
    const { result } = renderHook(() => useSquadSlot())
    expect(result.current.error).toBeNull()
  })

  it('starts unconfirmed', () => {
    const { result } = renderHook(() => useSquadSlot())
    expect(result.current.confirmed).toBe(false)
  })

  it('starts with empty pilots', () => {
    const { result } = renderHook(() => useSquadSlot())
    expect(result.current.pilots).toEqual([])
  })

  // --- setText ---

  it('setText updates the text value', () => {
    const { result } = renderHook(() => useSquadSlot())
    act(() => { result.current.setText('hello') })
    expect(result.current.text).toBe('hello')
  })

  // --- confirm: None mode ---

  it('confirm(None) sets confirmed to true', () => {
    const { result } = renderHook(() => useSquadSlot())
    act(() => { result.current.confirm('None') })
    expect(result.current.confirmed).toBe(true)
  })

  it('confirm(None) leaves pilots empty', () => {
    const { result } = renderHook(() => useSquadSlot())
    act(() => { result.current.confirm('None') })
    expect(result.current.pilots).toEqual([])
  })

  it('confirm(None) leaves error null', () => {
    const { result } = renderHook(() => useSquadSlot())
    act(() => { result.current.confirm('None') })
    expect(result.current.error).toBeNull()
  })

  // --- confirm: XWA mode — success ---

  it('confirm(XWA) with valid XWS sets confirmed to true', () => {
    const { result } = renderHook(() => useSquadSlot())
    act(() => { result.current.setText(VALID_XWS) })
    act(() => { result.current.confirm('XWA') })
    expect(result.current.confirmed).toBe(true)
  })

  it('confirm(XWA) with valid XWS populates pilots', () => {
    const { result } = renderHook(() => useSquadSlot())
    act(() => { result.current.setText(VALID_XWS) })
    act(() => { result.current.confirm('XWA') })
    expect(result.current.pilots).toHaveLength(3)
  })

  it('confirm(XWA) with valid XWS clears any prior error', () => {
    const { result } = renderHook(() => useSquadSlot())
    act(() => { result.current.setText('bad') })
    act(() => { result.current.confirm('XWA') })
    act(() => { result.current.setText(VALID_XWS) })
    act(() => { result.current.confirm('XWA') })
    expect(result.current.error).toBeNull()
  })

  // --- confirm: XWA mode — failures ---

  it('confirm(XWA) with empty text sets an error', () => {
    const { result } = renderHook(() => useSquadSlot())
    act(() => { result.current.confirm('XWA') })
    expect(result.current.error).not.toBeNull()
  })

  it('confirm(XWA) with empty text leaves confirmed false', () => {
    const { result } = renderHook(() => useSquadSlot())
    act(() => { result.current.confirm('XWA') })
    expect(result.current.confirmed).toBe(false)
  })

  it('confirm(XWA) with invalid JSON sets an error', () => {
    const { result } = renderHook(() => useSquadSlot())
    act(() => { result.current.setText('not valid json {{{') })
    act(() => { result.current.confirm('XWA') })
    expect(result.current.error).not.toBeNull()
    expect(result.current.confirmed).toBe(false)
  })

  it('confirm(XWA) with a points total below 46 sets an error', () => {
    const { result } = renderHook(() => useSquadSlot())
    act(() => { result.current.setText(XWS_LOW_POINTS) })
    act(() => { result.current.confirm('XWA') })
    expect(result.current.error).toBe('invalid-total')
    expect(result.current.confirmed).toBe(false)
  })

  it('confirm(XWA) with fewer than 3 ships sets an error', () => {
    const { result } = renderHook(() => useSquadSlot())
    act(() => { result.current.setText(XWS_TOO_FEW_SHIPS) })
    act(() => { result.current.confirm('XWA') })
    expect(result.current.error).toBe('too-few-ships')
    expect(result.current.confirmed).toBe(false)
  })

  // --- edit ---

  it('edit() after confirm resets confirmed to false', () => {
    const { result } = renderHook(() => useSquadSlot())
    act(() => { result.current.confirm('None') })
    act(() => { result.current.edit() })
    expect(result.current.confirmed).toBe(false)
  })

  it('edit() clears any error', () => {
    const { result } = renderHook(() => useSquadSlot())
    act(() => { result.current.confirm('XWA') })
    act(() => { result.current.edit() })
    expect(result.current.error).toBeNull()
  })

  it('edit() retains text so the textarea is pre-filled on re-edit', () => {
    const { result } = renderHook(() => useSquadSlot())
    act(() => { result.current.setText(VALID_XWS) })
    act(() => { result.current.confirm('XWA') })
    act(() => { result.current.edit() })
    expect(result.current.text).toBe(VALID_XWS)
  })

  it('edit() retains pilots so a previous import summary can still be shown', () => {
    const { result } = renderHook(() => useSquadSlot())
    act(() => { result.current.setText(VALID_XWS) })
    act(() => { result.current.confirm('XWA') })
    act(() => { result.current.edit() })
    expect(result.current.pilots).toHaveLength(3)
  })

  it('re-confirming after edit with new valid XWS updates pilots', () => {
    const { result } = renderHook(() => useSquadSlot())
    act(() => { result.current.setText(VALID_XWS) })
    act(() => { result.current.confirm('XWA') })
    act(() => { result.current.edit() })
    const newXws = JSON.stringify({
      pilots: [
        { name: 'pilota', ship: 'shipa', points: 17 },
        { name: 'pilotb', ship: 'shipb', points: 17 },
        { name: 'pilotc', ship: 'shipc', points: 16 },
      ],
      points: 50,
    })
    act(() => { result.current.setText(newXws) })
    act(() => { result.current.confirm('XWA') })
    expect(result.current.confirmed).toBe(true)
    expect(result.current.pilots[0].name).toBe('pilota')
  })

})
