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

  // --- Player choices ---

  it('starts with no choice for either player', () => {
    const { result } = renderHook(() => useXwingSetup())
    expect(result.current.playerChoice).toBeNull()
    expect(result.current.opponentChoice).toBeNull()
  })

  it('setPlayerChoice records a saved list for the player only', () => {
    const { result } = renderHook(() => useXwingSetup())
    act(() => result.current.setPlayerChoice({ kind: 'list', listId: 'l1' }))
    expect(result.current.playerChoice).toEqual({ kind: 'list', listId: 'l1' })
    expect(result.current.opponentChoice).toBeNull()
  })

  it('setOpponentChoice records No list for the opponent', () => {
    const { result } = renderHook(() => useXwingSetup())
    act(() => result.current.setOpponentChoice({ kind: 'none' }))
    expect(result.current.opponentChoice).toEqual({ kind: 'none' })
  })

  it('a choice can be cleared', () => {
    const { result } = renderHook(() => useXwingSetup())
    act(() => result.current.setPlayerChoice({ kind: 'none' }))
    act(() => result.current.setPlayerChoice(null))
    expect(result.current.playerChoice).toBeNull()
  })

  // --- Remembered lists ---

  const lastSaved = () => JSON.parse(vi.mocked(localStorage.setItem).mock.calls.at(-1)![1])
  const stored = (value: object) =>
    vi.mocked(localStorage.getItem).mockImplementation((key) => key === STORAGE_KEY ? JSON.stringify(value) : null)

  it('remembers your chosen list', () => {
    const { result } = renderHook(() => useXwingSetup())
    act(() => result.current.setPlayerChoice({ kind: 'list', listId: 'l1' }))
    expect(lastSaved().playerListId).toBe('l1')
  })

  it('starts with your remembered list chosen', () => {
    stored({ playerListId: 'l1' })
    const { result } = renderHook(() => useXwingSetup())
    expect(result.current.playerChoice).toEqual({ kind: 'list', listId: 'l1' })
  })

  it('does not remember No list for you, so a list is offered first next time', () => {
    stored({ playerListId: 'l1' })
    const { result } = renderHook(() => useXwingSetup())
    act(() => result.current.setPlayerChoice({ kind: 'none' }))
    expect(lastSaved().playerListId).toBeUndefined()
  })

  it('chooses the opponent afresh each time, offering the last one', () => {
    stored({ lastOpponentListId: 'o1' })
    const { result } = renderHook(() => useXwingSetup())
    expect(result.current.opponentChoice).toBeNull()
    expect(result.current.lastOpponentListId).toBe('o1')
  })

  it('remembers the opponent list as the last opponent', () => {
    const { result } = renderHook(() => useXwingSetup())
    act(() => result.current.setOpponentChoice({ kind: 'list', listId: 'o2' }))
    expect(lastSaved().lastOpponentListId).toBe('o2')
    expect(result.current.lastOpponentListId).toBe('o2')
  })

  it('keeps the last opponent when the opponent has No list', () => {
    stored({ lastOpponentListId: 'o1' })
    const { result } = renderHook(() => useXwingSetup())
    act(() => result.current.setOpponentChoice({ kind: 'none' }))
    expect(result.current.lastOpponentListId).toBe('o1')
  })

  it('starts with no last opponent', () => {
    const { result } = renderHook(() => useXwingSetup())
    expect(result.current.lastOpponentListId).toBeNull()
  })

  it('drops the old remembered list import fields on the next save', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === STORAGE_KEY
        ? JSON.stringify({ matchType: 'Tournament', playerListImport: 'XWA', opponentListImport: 'Favourites', listImport: 'YASB' })
        : null
    )
    const { result } = renderHook(() => useXwingSetup())
    act(() => result.current.setRounds(8))
    const saved = JSON.parse(vi.mocked(localStorage.setItem).mock.calls.at(-1)![1])
    expect(saved).toEqual({ ruleset: 'XWA', matchType: 'Tournament', rounds: 8 })
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
