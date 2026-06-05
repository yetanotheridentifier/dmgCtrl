import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useXwingSetup } from '../hooks/useXwingSetup'

const STORAGE_KEY = 'xwing_setup'

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: vi.fn().mockReturnValue(null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useXwingSetup', () => {

  // --- Defaults ---

  it('defaults ruleset to XWA', () => {
    const { result } = renderHook(() => useXwingSetup())
    expect(result.current.ruleset).toBe('XWA')
  })

  it('defaults matchType to Casual', () => {
    const { result } = renderHook(() => useXwingSetup())
    expect(result.current.matchType).toBe('Casual')
  })

  it('defaults rounds to 6', () => {
    const { result } = renderHook(() => useXwingSetup())
    expect(result.current.rounds).toBe(6)
  })

  it('defaults listImport to None', () => {
    const { result } = renderHook(() => useXwingSetup())
    expect(result.current.listImport).toBe('None')
  })

  it('defaults playerDeficit to 0', () => {
    const { result } = renderHook(() => useXwingSetup())
    expect(result.current.playerDeficit).toBe(0)
  })

  it('defaults opponentDeficit to 0', () => {
    const { result } = renderHook(() => useXwingSetup())
    expect(result.current.opponentDeficit).toBe(0)
  })

  // --- Load from storage ---

  it('loads ruleset from localStorage', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === STORAGE_KEY ? JSON.stringify({ ruleset: 'Legacy' }) : null
    )
    const { result } = renderHook(() => useXwingSetup())
    expect(result.current.ruleset).toBe('Legacy')
  })

  it('loads matchType from localStorage', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === STORAGE_KEY ? JSON.stringify({ matchType: 'Tournament' }) : null
    )
    const { result } = renderHook(() => useXwingSetup())
    expect(result.current.matchType).toBe('Tournament')
  })

  it('loads rounds from localStorage', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === STORAGE_KEY ? JSON.stringify({ rounds: 8 }) : null
    )
    const { result } = renderHook(() => useXwingSetup())
    expect(result.current.rounds).toBe(8)
  })

  it('loads listImport from localStorage', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === STORAGE_KEY ? JSON.stringify({ listImport: 'YASB' }) : null
    )
    const { result } = renderHook(() => useXwingSetup())
    expect(result.current.listImport).toBe('YASB')
  })

  it('does not load playerDeficit from localStorage (always starts at 0)', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === STORAGE_KEY ? JSON.stringify({ playerDeficit: 3 }) : null
    )
    const { result } = renderHook(() => useXwingSetup())
    expect(result.current.playerDeficit).toBe(0)
  })

  it('does not load opponentDeficit from localStorage (always starts at 0)', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === STORAGE_KEY ? JSON.stringify({ opponentDeficit: 2 }) : null
    )
    const { result } = renderHook(() => useXwingSetup())
    expect(result.current.opponentDeficit).toBe(0)
  })

  // --- Saving ---

  it('saves ruleset to localStorage when setRuleset is called', () => {
    const { result } = renderHook(() => useXwingSetup())
    act(() => result.current.setRuleset('Legacy'))
    const saved = JSON.parse(vi.mocked(localStorage.setItem).mock.calls.at(-1)![1])
    expect(saved.ruleset).toBe('Legacy')
  })

  it('saves matchType to localStorage when setMatchType is called', () => {
    const { result } = renderHook(() => useXwingSetup())
    act(() => result.current.setMatchType('Tournament'))
    const saved = JSON.parse(vi.mocked(localStorage.setItem).mock.calls.at(-1)![1])
    expect(saved.matchType).toBe('Tournament')
  })

  it('saves rounds to localStorage when setRounds is called', () => {
    const { result } = renderHook(() => useXwingSetup())
    act(() => result.current.setRounds(8))
    const saved = JSON.parse(vi.mocked(localStorage.setItem).mock.calls.at(-1)![1])
    expect(saved.rounds).toBe(8)
  })

  it('saves listImport to localStorage when setListImport is called', () => {
    const { result } = renderHook(() => useXwingSetup())
    act(() => result.current.setListImport('YASB'))
    const saved = JSON.parse(vi.mocked(localStorage.setItem).mock.calls.at(-1)![1])
    expect(saved.listImport).toBe('YASB')
  })

  it('does not save playerDeficit to localStorage', () => {
    const { result } = renderHook(() => useXwingSetup())
    act(() => result.current.setPlayerDeficit(3))
    expect(vi.mocked(localStorage.setItem).mock.calls).toHaveLength(0)
  })

  it('does not save opponentDeficit to localStorage', () => {
    const { result } = renderHook(() => useXwingSetup())
    act(() => result.current.setOpponentDeficit(2))
    expect(vi.mocked(localStorage.setItem).mock.calls).toHaveLength(0)
  })

  // --- Deficit clamping ---

  it('setPlayerDeficit clamps at 0', () => {
    const { result } = renderHook(() => useXwingSetup())
    act(() => result.current.setPlayerDeficit(-1))
    expect(result.current.playerDeficit).toBe(0)
  })

  it('setPlayerDeficit clamps at 4', () => {
    const { result } = renderHook(() => useXwingSetup())
    act(() => result.current.setPlayerDeficit(5))
    expect(result.current.playerDeficit).toBe(4)
  })

  it('setOpponentDeficit clamps at 0', () => {
    const { result } = renderHook(() => useXwingSetup())
    act(() => result.current.setOpponentDeficit(-1))
    expect(result.current.opponentDeficit).toBe(0)
  })

  it('setOpponentDeficit clamps at 4', () => {
    const { result } = renderHook(() => useXwingSetup())
    act(() => result.current.setOpponentDeficit(5))
    expect(result.current.opponentDeficit).toBe(4)
  })

})
