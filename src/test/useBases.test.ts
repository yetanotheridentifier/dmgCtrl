import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useBases } from '../hooks/useBases'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// swu-db.com proxy response — covers SOR (swu-db only) and LAW (overlap with swuapi.com)
const mockSwuDbResponse = {
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
      Set: 'LAW',
      Number: '021',
      Name: 'Coaxium Mine',
      Subtitle: 'Kessel',
      Type: 'Base',
      Aspects: ['Vigilance'],
      HP: '27',
      FrontArt: 'https://cdn.swu-db.com/images/cards/LAW/021.png',
      FrontText: 'Epic Action: Play a card from your hand, ignoring 1 of its aspect penalties.',
      Rarity: 'Common',
      VariantType: 'Normal',
    },
  ],
}

// swuapi.com page 1 — LAW base (overlaps with swu-db.com) plus its hyperspace variant
const swuApiPage1 = {
  cards: [
    {
      uuid: 'uuid-coaxium-standard',
      name: 'Coaxium Mine',
      subtitle: null,
      set_code: 'LAW',
      card_number: 21,
      hp: 27,
      aspects: ['Vigilance'],
      rarity: 'Common',
      variant_type: 'Standard',
      variant_of_uuid: null,
      front_image_url: 'https://cdn.starwarsunlimited.com/coaxium-mine.png',
      epic_action: null,
    },
    {
      uuid: 'uuid-coaxium-hyperspace',
      name: 'Coaxium Mine',
      set_code: 'LAW',
      card_number: 285,
      hp: 27,
      aspects: ['Vigilance'],
      rarity: 'Common',
      variant_type: 'Hyperspace',
      variant_of_uuid: 'uuid-coaxium-standard',
      front_image_url: 'https://cdn.starwarsunlimited.com/coaxium-mine-hs.png',
      epic_action: null,
    },
  ],
  pagination: { limit: 100, next_cursor: 'cursor-page-2' },
}

// swuapi.com page 2 — TS26 base (swuapi.com only, not in swu-db.com)
const swuApiPage2 = {
  cards: [
    {
      uuid: 'uuid-ts26-dookus-palace',
      name: "Dooku's Palace",
      subtitle: null,
      set_code: 'TS26',
      card_number: 10,
      hp: 25,
      aspects: ['Command'],
      rarity: 'Common',
      variant_type: 'Standard',
      variant_of_uuid: null,
      front_image_url: 'https://cdn.starwarsunlimited.com/ts26-dookus-palace.png',
      epic_action: null,
    },
  ],
  pagination: { limit: 100, next_cursor: null },
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    if (url.includes('swuapi.com') && url.includes('cursor-page-2')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(swuApiPage2) })
    }
    if (url.includes('swuapi.com')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(swuApiPage1) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(mockSwuDbResponse) })
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useBases', () => {

  // --- Initial / loading state ---

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

  // --- Pagination ---

  it('Fetches all swuapi.com pages when pagination returns a next_cursor', async () => {
    const { result } = renderHook(() => useBases())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(expect.stringContaining('cursor-page-2'))
  })

  it('Includes bases from swuapi.com page 2 in the results', async () => {
    const { result } = renderHook(() => useBases())
    await waitFor(() => expect(result.current.loading).toBe(false))
    const ts26Base = result.current.bases.find(b => b.name === "Dooku's Palace")
    expect(ts26Base).toBeDefined()
  })

  // --- Source merging: swuapi.com + swu-db.com overlap ---

  it('Populates subtitle from swu-db.com for bases in both sources', async () => {
    const { result } = renderHook(() => useBases())
    await waitFor(() => expect(result.current.loading).toBe(false))
    const coaxiumMine = result.current.bases.find(b => b.name === 'Coaxium Mine')
    expect(coaxiumMine?.subtitle).toBe('Kessel')
  })

  it('Populates epicAction from swu-db.com for bases in both sources', async () => {
    const { result } = renderHook(() => useBases())
    await waitFor(() => expect(result.current.loading).toBe(false))
    const coaxiumMine = result.current.bases.find(b => b.name === 'Coaxium Mine')
    expect(coaxiumMine?.epicAction).toBe('Epic Action: Play a card from your hand, ignoring 1 of its aspect penalties.')
  })

  it('Populates frontArt (hi-res swu-db.com CDN URL) for bases in both sources', async () => {
    const { result } = renderHook(() => useBases())
    await waitFor(() => expect(result.current.loading).toBe(false))
    const coaxiumMine = result.current.bases.find(b => b.name === 'Coaxium Mine')
    expect(coaxiumMine?.frontArt).toBe('https://cdn.swu-db.com/images/cards/LAW/021.png')
  })

  it('Populates frontArtLowRes (swuapi.com URL) for bases in swuapi.com', async () => {
    const { result } = renderHook(() => useBases())
    await waitFor(() => expect(result.current.loading).toBe(false))
    const coaxiumMine = result.current.bases.find(b => b.name === 'Coaxium Mine')
    expect(coaxiumMine?.frontArtLowRes).toBe('https://cdn.starwarsunlimited.com/coaxium-mine.png')
  })

  it('Attaches hyperspaceArtHiRes (constructed swu-db.com URL) for bases with hyperspace in swuapi.com', async () => {
    const { result } = renderHook(() => useBases())
    await waitFor(() => expect(result.current.loading).toBe(false))
    const coaxiumMine = result.current.bases.find(b => b.name === 'Coaxium Mine')
    expect(coaxiumMine?.hyperspaceArtHiRes).toBe('https://cdn.swu-db.com/images/cards/LAW/285.png')
  })

  it('Attaches hyperspaceArt (swuapi.com URL) as reliable fallback for bases with hyperspace in swuapi.com', async () => {
    const { result } = renderHook(() => useBases())
    await waitFor(() => expect(result.current.loading).toBe(false))
    const coaxiumMine = result.current.bases.find(b => b.name === 'Coaxium Mine')
    expect(coaxiumMine?.hyperspaceArt).toBe('https://cdn.starwarsunlimited.com/coaxium-mine-hs.png')
  })

  it('Does not include hyperspace cards as standalone bases', async () => {
    const { result } = renderHook(() => useBases())
    await waitFor(() => expect(result.current.loading).toBe(false))
    const hyperspaceStandalone = result.current.bases.filter(b => b.number === '285' && b.set === 'LAW')
    expect(hyperspaceStandalone).toHaveLength(0)
  })

  // --- swuapi.com-only bases (e.g. TS26) ---

  it('Leaves frontArt null for bases not yet on swu-db.com CDN', async () => {
    const { result } = renderHook(() => useBases())
    await waitFor(() => expect(result.current.loading).toBe(false))
    const ts26Base = result.current.bases.find(b => b.name === "Dooku's Palace")
    expect(ts26Base?.frontArt).toBeNull()
  })

  it('Populates frontArtLowRes for swuapi.com-only bases', async () => {
    const { result } = renderHook(() => useBases())
    await waitFor(() => expect(result.current.loading).toBe(false))
    const ts26Base = result.current.bases.find(b => b.name === "Dooku's Palace")
    expect(ts26Base?.frontArtLowRes).toBe('https://cdn.starwarsunlimited.com/ts26-dookus-palace.png')
  })

  it('Leaves subtitle as empty string for swuapi.com-only bases with no swu-db.com match', async () => {
    const { result } = renderHook(() => useBases())
    await waitFor(() => expect(result.current.loading).toBe(false))
    const ts26Base = result.current.bases.find(b => b.name === "Dooku's Palace")
    expect(ts26Base?.subtitle).toBe('')
  })

  it('Leaves epicAction as empty string for swuapi.com-only bases with no swu-db.com match', async () => {
    const { result } = renderHook(() => useBases())
    await waitFor(() => expect(result.current.loading).toBe(false))
    const ts26Base = result.current.bases.find(b => b.name === "Dooku's Palace")
    expect(ts26Base?.epicAction).toBe('')
  })

  // --- swu-db.com-only bases (SOR/SHD/TWI — not in swuapi.com) ---

  it('Includes SOR bases sourced from swu-db.com even though they are absent from swuapi.com', async () => {
    const { result } = renderHook(() => useBases())
    await waitFor(() => expect(result.current.loading).toBe(false))
    const commandCenter = result.current.bases.find(b => b.name === 'Command Center' && b.set === 'SOR')
    expect(commandCenter).toBeDefined()
    expect(commandCenter?.hp).toBe(30)
  })

  it('Applies static hyperspace map: populates hyperspaceArtHiRes for SOR bases via card number offset', async () => {
    const { result } = renderHook(() => useBases())
    await waitFor(() => expect(result.current.loading).toBe(false))
    const commandCenter = result.current.bases.find(b => b.name === 'Command Center' && b.set === 'SOR')
    // SOR Command Center is card 023; hyperspace offset +266 = 289
    expect(commandCenter?.hyperspaceArtHiRes).toBe('https://cdn.swu-db.com/images/cards/SOR/289.png')
  })

  it('Leaves hyperspaceArt null for SOR bases (swuapi.com no longer returns them)', async () => {
    const { result } = renderHook(() => useBases())
    await waitFor(() => expect(result.current.loading).toBe(false))
    const commandCenter = result.current.bases.find(b => b.name === 'Command Center' && b.set === 'SOR')
    expect(commandCenter?.hyperspaceArt).toBeNull()
  })

  it('Leaves frontArtLowRes null for SOR bases (swuapi.com no longer returns them)', async () => {
    const { result } = renderHook(() => useBases())
    await waitFor(() => expect(result.current.loading).toBe(false))
    const commandCenter = result.current.bases.find(b => b.name === 'Command Center' && b.set === 'SOR')
    expect(commandCenter?.frontArtLowRes).toBeNull()
  })

  // --- Caching ---

  it('Uses cached data when lastChecked is within the refresh interval', async () => {
    const cachedData = {
      lastChecked: Date.now(),
      data: [
        {
          set: 'SOR',
          number: '023',
          name: 'Command Center',
          subtitle: 'Death Star',
          hp: 30,
          frontArt: 'https://cdn.swu-db.com/images/cards/SOR/023.png',
          frontArtLowRes: null,
          hyperspaceArtHiRes: 'https://cdn.swu-db.com/images/cards/SOR/289.png',
          hyperspaceArt: null,
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

  it('Fetches fresh data when lastChecked is older than the refresh interval', async () => {
    const staleData = {
      lastChecked: Date.now() - (8 * 24 * 60 * 60 * 1000), // 8 days old
      data: [{ set: 'SOR', number: '023', name: 'Command Center', subtitle: 'Death Star',
        hp: 30, frontArt: 'cached-url', frontArtLowRes: null,
        hyperspaceArtHiRes: null, hyperspaceArt: null, epicAction: '', aspects: ['Command'], rarity: 'Common' }]
    }
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue(JSON.stringify(staleData)),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    })
    const { result } = renderHook(() => useBases())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(vi.mocked(fetch)).toHaveBeenCalled()
  })

  it('Serves stale cached data when fetch fails rather than setting an error', async () => {
    const staleData = {
      lastChecked: Date.now() - (8 * 24 * 60 * 60 * 1000), // stale
      data: [{ set: 'SOR', number: '023', name: 'Command Center', subtitle: 'Death Star',
        hp: 30, frontArt: 'https://cdn.swu-db.com/images/cards/SOR/023.png', frontArtLowRes: null,
        hyperspaceArtHiRes: 'https://cdn.swu-db.com/images/cards/SOR/289.png', hyperspaceArt: null,
        epicAction: '', aspects: ['Command'], rarity: 'Common' }]
    }
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue(JSON.stringify(staleData)),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))
    const { result } = renderHook(() => useBases())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeNull()
    expect(result.current.bases.length).toBeGreaterThan(0)
    expect(result.current.bases[0].name).toBe('Command Center')
  })

  it('Sets error only when fetch fails and no cache exists at all', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))
    const { result } = renderHook(() => useBases())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).not.toBeNull()
  })

})