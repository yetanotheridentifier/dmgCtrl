import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useBases } from '../hooks/useBases'

const mockNormalBases = {
  total_cards: 2,
  data: [
    {
      Set: 'SOR',
      Number: '023',
      Name: 'Command Center',
      Subtitle: 'Death Star',
      Type: 'Base',
      Aspects: ['Command'],
      HP: '30',
      FrontArt: 'https://cdn.swu-db.com/images/cards/SOR/023.png',
      FrontText: '',
      Rarity: 'Common',
      VariantType: 'Normal',
    },
    {
      Set: 'SOR',
      Number: '026',
      Name: 'Catacombs of Cadera',
      Subtitle: 'Jedha',
      Type: 'Base',
      Aspects: ['Aggression'],
      HP: '30',
      FrontArt: 'https://cdn.swu-db.com/images/cards/SOR/026.png',
      FrontText: '',
      Rarity: 'Common',
      VariantType: 'Normal',
    },
  ],
}

const mockHyperspaceBases = {
  total_cards: 1,
  data: [
    {
      Set: 'SOR',
      Number: '289',
      Name: 'Command Center',
      Subtitle: 'Death Star',
      Type: 'Base',
      Aspects: ['Command'],
      HP: '30',
      FrontArt: 'https://cdn.swu-db.com/images/cards/SOR/289.png',
      FrontText: '',
      Rarity: 'Common',
      VariantType: 'Hyperspace',
    },
  ],
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    if (url.includes('variant:hyperspace') || url.includes('variant%3Ahyperspace')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockHyperspaceBases),
      })
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(mockNormalBases),
    })
  }))

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

describe('useBases', () => {

  it('Returns bases after loading', async () => {
    const { result } = renderHook(() => useBases())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.bases.length).toBeGreaterThan(0)
  })

  it('Sets loading to false after fetch completes', async () => {
    const { result } = renderHook(() => useBases())
    await waitFor(() => expect(result.current.loading).toBe(false))
  })

  it('Returns no error on successful fetch', async () => {
    const { result } = renderHook(() => useBases())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeNull()
  })

  it('Makes two fetch calls — one for normal bases and one for hyperspace', async () => {
    const { result } = renderHook(() => useBases())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
  })

  it('Attaches hyperspaceArt to a base that has a matching hyperspace variant', async () => {
    const { result } = renderHook(() => useBases())
    await waitFor(() => expect(result.current.loading).toBe(false))
    const commandCenter = result.current.bases.find(
      b => b.name === 'Command Center' && b.subtitle === 'Death Star'
    )
    expect(commandCenter).toBeDefined()
    expect(commandCenter?.hyperspaceArt).toBe(
      'https://cdn.swu-db.com/images/cards/SOR/289.png'
    )
  })

  it('Leaves hyperspaceArt undefined for a base with no hyperspace variant', async () => {
    const { result } = renderHook(() => useBases())
    await waitFor(() => expect(result.current.loading).toBe(false))
    const catacombs = result.current.bases.find(
      b => b.name === 'Catacombs of Cadera'
    )
    expect(catacombs).toBeDefined()
    expect(catacombs?.hyperspaceArt).toBeUndefined()
  })

  it('Does not include hyperspace cards as standalone bases in the list', async () => {
    const { result } = renderHook(() => useBases())
    await waitFor(() => expect(result.current.loading).toBe(false))
    const hyperspaceStandalone = result.current.bases.filter(
      b => b.number === '289'
    )
    expect(hyperspaceStandalone).toHaveLength(0)
  })

  it('Returns error state when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))
    const { result } = renderHook(() => useBases())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).not.toBeNull()
  })

  it('Uses cached data when cache is fresh', async () => {
    const cachedData = {
      timestamp: Date.now(),
      data: [
        {
          set: 'SOR',
          number: '023',
          name: 'Command Center',
          subtitle: 'Death Star',
          hp: 30,
          frontArt: 'https://cdn.swu-db.com/images/cards/SOR/023.png',
          hyperspaceArt: 'https://cdn.swu-db.com/images/cards/SOR/289.png',
          epicAction: '',
          aspects: ['Command'],
          rarity: 'Common',
        }
      ]
    }
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue(JSON.stringify(cachedData)),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    })
    const { result } = renderHook(() => useBases())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

})