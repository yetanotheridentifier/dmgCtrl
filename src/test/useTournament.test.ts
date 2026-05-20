import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTournament } from '../hooks/useTournament'
import type { Base } from '../hooks/useBases'

const mockBase: Base = {
  set: 'SOR',
  number: '026',
  name: 'Catacombs of Cadera',
  subtitle: 'Jedha',
  hp: 30,
  frontArt: 'https://cdn.swu-db.com/images/cards/SOR/026.png',
  frontArtLowRes: null,
  hyperspaceArtHiRes: null,
  hyperspaceArt: null,
  epicAction: '',
  aspects: ['Aggression'],
  rarity: 'Common',
}

const altBase: Base = {
  set: 'SOR',
  number: '022',
  name: 'Energy Conversion Lab',
  subtitle: 'Eadu',
  hp: 25,
  frontArt: 'https://cdn.swu-db.com/images/cards/SOR/022.png',
  frontArtLowRes: null,
  hyperspaceArtHiRes: null,
  hyperspaceArt: null,
  epicAction: '',
  aspects: ['Cunning'],
  rarity: 'Rare',
}

function setupTournament(
  result: ReturnType<typeof renderHook<ReturnType<typeof useTournament>, unknown>>['result'],
  overrides: { totalRounds?: number; playMode?: 'bo1' | 'bo3' } = {},
) {
  act(() => result.current.startTournament(
    mockBase, 'premier', overrides.playMode ?? 'bo3', overrides.totalRounds ?? 5,
  ))
}

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

describe('useTournament', () => {

  // --- Initial state ---

  describe('initial state', () => {
    it('tournament is null when no saved state exists', () => {
      const { result } = renderHook(() => useTournament())
      expect(result.current.tournament).toBeNull()
    })

    it('matchInProgress is false initially', () => {
      const { result } = renderHook(() => useTournament())
      expect(result.current.matchInProgress).toBe(false)
    })

    it('isComplete is false initially', () => {
      const { result } = renderHook(() => useTournament())
      expect(result.current.isComplete).toBe(false)
    })

    it('totals starts at 0-0-0', () => {
      const { result } = renderHook(() => useTournament())
      expect(result.current.totals).toEqual({ won: 0, lost: 0, drawn: 0 })
    })
  })

  // --- startTournament ---

  describe('startTournament', () => {
    it('sets tournament with correct base', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      expect(result.current.tournament?.base).toEqual(mockBase)
    })

    it('sets tournament with correct format', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      expect(result.current.tournament?.format).toBe('premier')
    })

    it('sets tournament with correct playMode', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      expect(result.current.tournament?.playMode).toBe('bo3')
    })

    it('sets tournament with correct totalRounds', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      expect(result.current.tournament?.totalRounds).toBe(5)
    })

    it('starts with no rounds', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      expect(result.current.tournament?.rounds).toHaveLength(0)
    })

    it('persists state to localStorage', () => {
      const setItem = vi.fn()
      vi.stubGlobal('localStorage', {
        getItem: vi.fn().mockReturnValue(null),
        setItem,
        removeItem: vi.fn(),
        clear: vi.fn(),
      })
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      expect(setItem).toHaveBeenCalledWith('tournament_state', expect.any(String))
    })

    it('overwrites an existing tournament', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.startMatch())
      act(() => result.current.completeMatch('won', 2, 0))
      act(() => result.current.startTournament(altBase, 'limited', 'bo1', 3))
      expect(result.current.tournament?.rounds).toHaveLength(0)
      expect(result.current.tournament?.base).toEqual(altBase)
    })
  })

  // --- startMatch ---

  describe('startMatch', () => {
    it('works correctly when called in the same batch as startTournament', () => {
      const { result } = renderHook(() => useTournament())
      // Simulates the container calling both in one event handler (stale-closure scenario)
      act(() => {
        result.current.startTournament(mockBase, 'premier', 'bo3', 5)
        result.current.startMatch()
      })
      expect(result.current.tournament?.rounds).toHaveLength(1)
      expect(result.current.matchInProgress).toBe(true)
    })

    it('adds a round entry with result null', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.startMatch())
      expect(result.current.tournament?.rounds).toHaveLength(1)
      expect(result.current.tournament?.rounds[0].result).toBeNull()
    })

    it('sets matchInProgress to true', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.startMatch())
      expect(result.current.matchInProgress).toBe(true)
    })

    it('assigns roundNumber 1 for the first round', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.startMatch())
      expect(result.current.tournament?.rounds[0].roundNumber).toBe(1)
    })

    it('increments roundNumber for subsequent rounds', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.startMatch())
      act(() => result.current.completeMatch('won', 2, 1))
      act(() => result.current.submitRound())
      act(() => result.current.startMatch())
      expect(result.current.tournament?.rounds[1].roundNumber).toBe(2)
    })

    it('initialises playerScore and opponentScore to 0', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.startMatch())
      expect(result.current.tournament?.rounds[0].playerScore).toBe(0)
      expect(result.current.tournament?.rounds[0].opponentScore).toBe(0)
    })

    it('initialises submitted to false', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.startMatch())
      expect(result.current.tournament?.rounds[0].submitted).toBe(false)
    })

    it('does nothing if a match is already in progress', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.startMatch())
      act(() => result.current.startMatch())
      expect(result.current.tournament?.rounds).toHaveLength(1)
    })
  })

  // --- completeMatch ---

  describe('completeMatch', () => {
    it('sets result on the current round', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.startMatch())
      act(() => result.current.completeMatch('won', 2, 0))
      expect(result.current.tournament?.rounds[0].result).toBe('won')
    })

    it('sets playerScore on the current round', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.startMatch())
      act(() => result.current.completeMatch('won', 2, 1))
      expect(result.current.tournament?.rounds[0].playerScore).toBe(2)
    })

    it('sets opponentScore on the current round', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.startMatch())
      act(() => result.current.completeMatch('won', 2, 1))
      expect(result.current.tournament?.rounds[0].opponentScore).toBe(1)
    })

    it('sets matchInProgress to false', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.startMatch())
      act(() => result.current.completeMatch('won', 2, 0))
      expect(result.current.matchInProgress).toBe(false)
    })

    it('does not mark the round as submitted', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.startMatch())
      act(() => result.current.completeMatch('won', 2, 0))
      expect(result.current.tournament?.rounds[0].submitted).toBe(false)
    })

    it('does nothing when no match is in progress', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.completeMatch('won', 2, 0))
      expect(result.current.tournament?.rounds).toHaveLength(0)
    })
  })

  // --- submitRound ---

  describe('submitRound', () => {
    it('marks the current round as submitted', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.startMatch())
      act(() => result.current.completeMatch('won', 2, 0))
      act(() => result.current.submitRound())
      expect(result.current.tournament?.rounds[0].submitted).toBe(true)
    })

    it('only marks the last round, not previous ones', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.startMatch())
      act(() => result.current.completeMatch('won', 2, 0))
      act(() => result.current.submitRound())
      act(() => result.current.startMatch())
      act(() => result.current.completeMatch('lost', 0, 2))
      act(() => result.current.submitRound())
      expect(result.current.tournament?.rounds[0].submitted).toBe(true)
      expect(result.current.tournament?.rounds[1].submitted).toBe(true)
    })

    it('does nothing when no completed round exists', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.submitRound())
      expect(result.current.tournament?.rounds).toHaveLength(0)
    })

    it('does nothing when the current round is still in progress', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.startMatch())
      act(() => result.current.submitRound())
      expect(result.current.tournament?.rounds[0].submitted).toBe(false)
    })
  })

  // --- dropTournament ---

  describe('dropTournament', () => {
    it('sets tournament to null', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.dropTournament())
      expect(result.current.tournament).toBeNull()
    })

    it('removes state from localStorage', () => {
      const removeItem = vi.fn()
      vi.stubGlobal('localStorage', {
        getItem: vi.fn().mockReturnValue(null),
        setItem: vi.fn(),
        removeItem,
        clear: vi.fn(),
      })
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.dropTournament())
      expect(removeItem).toHaveBeenCalledWith('tournament_state')
    })

    it('resets matchInProgress to false', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.startMatch())
      act(() => result.current.dropTournament())
      expect(result.current.matchInProgress).toBe(false)
    })

    it('resets totals to 0-0-0', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.startMatch())
      act(() => result.current.completeMatch('won', 2, 0))
      act(() => result.current.dropTournament())
      expect(result.current.totals).toEqual({ won: 0, lost: 0, drawn: 0 })
    })
  })

  // --- isComplete ---

  describe('isComplete', () => {
    it('is false when no rounds have been played', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result, { totalRounds: 2 })
      expect(result.current.isComplete).toBe(false)
    })

    it('is false when fewer rounds played than totalRounds', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result, { totalRounds: 2 })
      act(() => result.current.startMatch())
      act(() => result.current.completeMatch('won', 2, 0))
      expect(result.current.isComplete).toBe(false)
    })

    it('is false when the final round is still in progress', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result, { totalRounds: 1 })
      act(() => result.current.startMatch())
      expect(result.current.isComplete).toBe(false)
    })

    it('is true when all rounds have results', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result, { totalRounds: 2 })
      act(() => result.current.startMatch())
      act(() => result.current.completeMatch('won', 2, 0))
      act(() => result.current.startMatch())
      act(() => result.current.completeMatch('lost', 0, 2))
      expect(result.current.isComplete).toBe(true)
    })

    it('is true even when the final round has not been submitted', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result, { totalRounds: 1 })
      act(() => result.current.startMatch())
      act(() => result.current.completeMatch('won', 2, 0))
      expect(result.current.isComplete).toBe(true)
    })
  })

  // --- totals ---

  describe('totals', () => {
    it('returns 0-0-0 with no completed rounds', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      expect(result.current.totals).toEqual({ won: 0, lost: 0, drawn: 0 })
    })

    it('counts wins correctly', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.startMatch())
      act(() => result.current.completeMatch('won', 2, 0))
      act(() => result.current.startMatch())
      act(() => result.current.completeMatch('won', 2, 1))
      expect(result.current.totals.won).toBe(2)
    })

    it('counts losses correctly', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.startMatch())
      act(() => result.current.completeMatch('lost', 0, 2))
      expect(result.current.totals.lost).toBe(1)
    })

    it('counts draws correctly', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.startMatch())
      act(() => result.current.completeMatch('drawn', 1, 1))
      expect(result.current.totals.drawn).toBe(1)
    })

    it('excludes in-progress rounds from totals', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.startMatch())
      expect(result.current.totals).toEqual({ won: 0, lost: 0, drawn: 0 })
    })

    it('counts mixed results correctly', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.startMatch())
      act(() => result.current.completeMatch('won', 2, 0))
      act(() => result.current.startMatch())
      act(() => result.current.completeMatch('lost', 0, 2))
      act(() => result.current.startMatch())
      act(() => result.current.completeMatch('drawn', 1, 1))
      expect(result.current.totals).toEqual({ won: 1, lost: 1, drawn: 1 })
    })
  })

  // --- points ---

  describe('points', () => {
    it('returns 0 with no completed rounds', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      expect(result.current.points).toBe(0)
    })

    it('awards 3 points for a win', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.startMatch())
      act(() => result.current.completeMatch('won', 2, 0))
      expect(result.current.points).toBe(3)
    })

    it('awards 1 point for a draw', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.startMatch())
      act(() => result.current.completeMatch('drawn', 1, 1))
      expect(result.current.points).toBe(1)
    })

    it('awards 0 points for a loss', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.startMatch())
      act(() => result.current.completeMatch('lost', 0, 2))
      expect(result.current.points).toBe(0)
    })

    it('accumulates points across rounds', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.startMatch())
      act(() => result.current.completeMatch('won', 2, 0))   // +3
      act(() => result.current.startMatch())
      act(() => result.current.completeMatch('won', 2, 1))   // +3
      act(() => result.current.startMatch())
      act(() => result.current.completeMatch('drawn', 1, 1)) // +1
      act(() => result.current.startMatch())
      act(() => result.current.completeMatch('lost', 0, 2))  // +0
      expect(result.current.points).toBe(7)
    })

    it('excludes in-progress rounds from points', () => {
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.startMatch())
      expect(result.current.points).toBe(0)
    })
  })

  // --- localStorage persistence ---

  describe('localStorage persistence', () => {
    it('loads saved tournament from localStorage on init', () => {
      const saved = {
        base: mockBase,
        format: 'premier',
        playMode: 'bo3',
        totalRounds: 5,
        rounds: [{ roundNumber: 1, playerScore: 2, opponentScore: 0, result: 'won', submitted: true }],
      }
      vi.stubGlobal('localStorage', {
        getItem: vi.fn((key: string) => key === 'tournament_state' ? JSON.stringify(saved) : null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      })
      const { result } = renderHook(() => useTournament())
      expect(result.current.tournament?.playMode).toBe('bo3')
      expect(result.current.tournament?.rounds).toHaveLength(1)
    })

    it('restores totals from saved state', () => {
      const saved = {
        base: mockBase,
        format: 'premier',
        playMode: 'bo3',
        totalRounds: 5,
        rounds: [{ roundNumber: 1, playerScore: 2, opponentScore: 0, result: 'won', submitted: true }],
      }
      vi.stubGlobal('localStorage', {
        getItem: vi.fn((key: string) => key === 'tournament_state' ? JSON.stringify(saved) : null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      })
      const { result } = renderHook(() => useTournament())
      expect(result.current.totals.won).toBe(1)
    })

    it('restores matchInProgress from saved state when last round has no result', () => {
      const saved = {
        base: mockBase,
        format: 'premier',
        playMode: 'bo3',
        totalRounds: 5,
        rounds: [{ roundNumber: 1, playerScore: 0, opponentScore: 0, result: null, submitted: false }],
      }
      vi.stubGlobal('localStorage', {
        getItem: vi.fn((key: string) => key === 'tournament_state' ? JSON.stringify(saved) : null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      })
      const { result } = renderHook(() => useTournament())
      expect(result.current.matchInProgress).toBe(true)
    })

    it('returns null tournament when localStorage contains invalid JSON', () => {
      vi.stubGlobal('localStorage', {
        getItem: vi.fn((key: string) => key === 'tournament_state' ? 'not-json' : null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      })
      const { result } = renderHook(() => useTournament())
      expect(result.current.tournament).toBeNull()
    })

    it('persists state on startMatch', () => {
      const setItem = vi.fn()
      vi.stubGlobal('localStorage', {
        getItem: vi.fn().mockReturnValue(null),
        setItem,
        removeItem: vi.fn(),
        clear: vi.fn(),
      })
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      setItem.mockClear()
      act(() => result.current.startMatch())
      expect(setItem).toHaveBeenCalledWith('tournament_state', expect.any(String))
    })

    it('persists state on completeMatch', () => {
      const setItem = vi.fn()
      vi.stubGlobal('localStorage', {
        getItem: vi.fn().mockReturnValue(null),
        setItem,
        removeItem: vi.fn(),
        clear: vi.fn(),
      })
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.startMatch())
      setItem.mockClear()
      act(() => result.current.completeMatch('won', 2, 0))
      expect(setItem).toHaveBeenCalledWith('tournament_state', expect.any(String))
    })

    it('persists state on submitRound', () => {
      const setItem = vi.fn()
      vi.stubGlobal('localStorage', {
        getItem: vi.fn().mockReturnValue(null),
        setItem,
        removeItem: vi.fn(),
        clear: vi.fn(),
      })
      const { result } = renderHook(() => useTournament())
      setupTournament(result)
      act(() => result.current.startMatch())
      act(() => result.current.completeMatch('won', 2, 0))
      setItem.mockClear()
      act(() => result.current.submitRound())
      expect(setItem).toHaveBeenCalledWith('tournament_state', expect.any(String))
    })
  })

})
