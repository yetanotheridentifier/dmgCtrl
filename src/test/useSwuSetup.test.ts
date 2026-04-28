import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSwuSetup } from '../hooks/useSwuSetup'
import { useBases, Base } from '../hooks/useBases'

vi.mock('../hooks/useBases')

const baseA: Base = {
  set: 'SOR',
  number: '026',
  name: 'Catacombs of Cadera',
  subtitle: 'Jedha',
  hp: 30,
  frontArt: 'https://cdn.swu-db.com/images/cards/SOR/026.png',
  frontArtLowRes: null,
  hyperspaceArtHiRes: 'https://cdn.swu-db.com/images/cards/SOR/292.png',
  hyperspaceArt: null,
  epicAction: '',
  aspects: ['Aggression'],
  rarity: 'Common',
}

const baseB: Base = {
  set: 'SOR',
  number: '022',
  name: 'Energy Conversion Lab',
  subtitle: 'Eadu',
  hp: 25,
  frontArt: 'https://cdn.swu-db.com/images/cards/SOR/022.png',
  frontArtLowRes: null,
  hyperspaceArtHiRes: 'https://cdn.swu-db.com/images/cards/SOR/288.png',
  hyperspaceArt: null,
  epicAction: 'Epic Action: Play a unit that costs 6 or less.',
  aspects: ['Cunning'],
  rarity: 'Rare',
}

const baseC: Base = {
  set: 'TWI',
  number: '001',
  name: 'Coruscant Undercity',
  subtitle: 'Coruscant',
  hp: 28,
  frontArt: 'https://cdn.swu-db.com/images/cards/TWI/001.png',
  frontArtLowRes: null,
  hyperspaceArtHiRes: null,
  hyperspaceArt: null,
  epicAction: '',
  aspects: ['Aggression'],
  rarity: 'Common',
}

// Extra bases to give SOR+Aggression and TWI multiple options,
// preventing auto-select from interfering with cascade-reset tests
const baseD: Base = {
  set: 'SOR',
  number: '027',
  name: 'Tarkintown',
  subtitle: 'Lothal',
  hp: 30,
  frontArt: 'https://cdn.swu-db.com/images/cards/SOR/027.png',
  frontArtLowRes: null,
  hyperspaceArtHiRes: 'https://cdn.swu-db.com/images/cards/SOR/293.png',
  hyperspaceArt: null,
  epicAction: '',
  aspects: ['Aggression'],
  rarity: 'Common',
}

const baseF: Base = {
  set: 'TWI',
  number: '002',
  name: 'Senate Chamber',
  subtitle: 'Coruscant',
  hp: 30,
  frontArt: 'https://cdn.swu-db.com/images/cards/TWI/002.png',
  frontArtLowRes: null,
  hyperspaceArtHiRes: null,
  hyperspaceArt: null,
  epicAction: '',
  aspects: ['Command'],
  rarity: 'Common',
}

const aspectlessBase: Base = {
  set: 'JTL',
  number: '031',
  name: 'Lake Country',
  subtitle: 'Naboo',
  hp: 30,
  frontArt: 'https://cdn.swu-db.com/images/cards/JTL/031.png',
  frontArtLowRes: null,
  hyperspaceArtHiRes: null,
  hyperspaceArt: null,
  epicAction: '',
  aspects: [],
  rarity: 'Common',
}

const mockBases = [baseA, baseB, baseC, baseD, baseF]

beforeEach(() => {
  vi.mocked(useBases).mockReturnValue({ bases: mockBases, loading: false, error: null })
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

describe('useSwuSetup', () => {

  // --- Initial state ---

  it('selectedSet starts empty', () => {
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    expect(result.current.selectedSet).toBe('')
  })

  it('selectedAspect starts empty', () => {
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    expect(result.current.selectedAspect).toBe('')
  })

  it('selectedKey starts empty', () => {
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    expect(result.current.selectedKey).toBe('')
  })

  it('selectedBase starts as null', () => {
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    expect(result.current.selectedBase).toBeNull()
  })

  // --- Pass-through from useBases ---

  it('exposes loading state from useBases', () => {
    vi.mocked(useBases).mockReturnValue({ bases: [], loading: true, error: null })
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    expect(result.current.loading).toBe(true)
  })

  it('exposes error state from useBases', () => {
    vi.mocked(useBases).mockReturnValue({ bases: [], loading: false, error: 'Failed' })
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    expect(result.current.error).toBe('Failed')
  })

  // --- Available sets ---

  it('availableSets returns sorted unique sets', () => {
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    expect(result.current.availableSets).toEqual(['SOR', 'TWI'])
  })

  it('availableSets is empty when no bases loaded', () => {
    vi.mocked(useBases).mockReturnValue({ bases: [], loading: false, error: null })
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    expect(result.current.availableSets).toEqual([])
  })

  // --- Available aspects ---

  it('availableAspects is empty before a set is selected', () => {
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    expect(result.current.availableAspects).toEqual([])
  })

  it('availableAspects returns aspects for the selected set in order', () => {
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    act(() => result.current.handleSetChange('SOR'))
    expect(result.current.availableAspects).toEqual(['Aggression', 'Cunning'])
  })

  // --- Filtered bases ---

  it('filteredBases is empty before set and aspect are selected', () => {
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    expect(result.current.filteredBases).toEqual([])
  })

  it('filteredBases returns only bases matching the selected set and aspect', () => {
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    act(() => result.current.handleSetChange('SOR'))
    act(() => result.current.handleAspectChange('Aggression'))
    // SOR+Aggression has baseA and baseD in the full mock
    expect(result.current.filteredBases).toEqual([baseA, baseD])
  })

  // --- Selected base ---

  it('selectedBase is null when no key is selected', () => {
    // SOR+Aggression has 2 bases (baseA, baseD) so auto-select does not fire
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    act(() => result.current.handleSetChange('SOR'))
    act(() => result.current.handleAspectChange('Aggression'))
    expect(result.current.selectedBase).toBeNull()
  })

  it('selectedBase returns the base matching the selected key', () => {
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    act(() => result.current.handleSetChange('SOR'))
    act(() => result.current.handleAspectChange('Aggression'))
    act(() => result.current.handleKeyChange('SOR-026'))
    expect(result.current.selectedBase).toEqual(baseA)
  })

  // --- Cascade resets ---

  it('handleSetChange resets aspect and key', () => {
    // TWI has multiple aspects (Aggression + Command) so auto-select does not fire
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    act(() => result.current.handleSetChange('SOR'))
    act(() => result.current.handleAspectChange('Aggression'))
    act(() => result.current.handleKeyChange('SOR-026'))
    act(() => result.current.handleSetChange('TWI'))
    expect(result.current.selectedAspect).toBe('')
    expect(result.current.selectedKey).toBe('')
  })

  it('handleAspectChange resets key', () => {
    // SOR+Cunning has only baseB so auto-select would fire — switch from Cunning to Aggression instead.
    // SOR+Aggression has 2 bases (baseA, baseD) so no auto-select.
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    act(() => result.current.handleSetChange('SOR'))
    act(() => result.current.handleAspectChange('Cunning'))
    act(() => result.current.handleKeyChange('SOR-022'))
    act(() => result.current.handleAspectChange('Aggression'))
    expect(result.current.selectedKey).toBe('')
  })

  // --- Auto-select ---

  it('auto-selects aspect when only one is available for the set', () => {
    // Use a mock where a set only has one aspect
    vi.mocked(useBases).mockReturnValue({ bases: [baseA, baseB, baseC], loading: false, error: null })
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    // TWI only has Aggression (baseC) in the reduced mock
    act(() => result.current.handleSetChange('TWI'))
    expect(result.current.selectedAspect).toBe('Aggression')
  })

  it('auto-selects base when only one base matches set and aspect', () => {
    // Use a mock where SOR+Aggression only has one base
    vi.mocked(useBases).mockReturnValue({ bases: [baseA, baseB, baseC], loading: false, error: null })
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    act(() => result.current.handleSetChange('SOR'))
    act(() => result.current.handleAspectChange('Aggression'))
    expect(result.current.selectedKey).toBe('SOR-026')
  })



  // --- handleSubmit ---

  it('handleSubmit calls onConfirm with selectedBase', () => {
    const onConfirm = vi.fn()
    const { result } = renderHook(() => useSwuSetup(onConfirm))
    act(() => result.current.handleSetChange('SOR'))
    act(() => result.current.handleAspectChange('Aggression'))
    act(() => result.current.handleKeyChange('SOR-026'))
    act(() => result.current.handleSubmit())
    expect(onConfirm).toHaveBeenCalledWith(baseA)
  })

  it('handleSubmit does nothing when no base is selected', () => {
    const onConfirm = vi.fn()
    const { result } = renderHook(() => useSwuSetup(onConfirm))
    act(() => result.current.handleSubmit())
    expect(onConfirm).not.toHaveBeenCalled()
  })

  // --- selectBaseByKey ---

  it('selectBaseByKey returns true and resolves selectedBase when key matches', () => {
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    act(() => { result.current.selectBaseByKey('SOR-026') })
    expect(result.current.selectedBase).toEqual(baseA)
  })

  it('selectBaseByKey returns true when base is found', () => {
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    let found = false
    act(() => { found = result.current.selectBaseByKey('SOR-026') })
    expect(found).toBe(true)
  })

  it('selectBaseByKey returns false and leaves selectedBase null when key not found', () => {
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    let found = true
    act(() => { found = result.current.selectBaseByKey('NEW-001') })
    expect(found).toBe(false)
    expect(result.current.selectedBase).toBeNull()
  })

  it('selectBaseByKey sets selectedSet, selectedAspect and selectedKey', () => {
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    act(() => result.current.selectBaseByKey('SOR-026'))
    expect(result.current.selectedSet).toBe('SOR')
    expect(result.current.selectedAspect).toBe('Aggression')
    expect(result.current.selectedKey).toBe('SOR-026')
  })

  it('selectBaseByKey uses None as aspect for an aspectless base', () => {
    vi.mocked(useBases).mockReturnValue({ bases: [...mockBases, aspectlessBase], loading: false, error: null })
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    act(() => result.current.selectBaseByKey('JTL-031'))
    expect(result.current.selectedAspect).toBe('None')
    expect(result.current.selectedBase).toEqual(aspectlessBase)
  })

})