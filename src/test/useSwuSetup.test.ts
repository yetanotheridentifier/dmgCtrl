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
  hyperspaceArt: 'https://cdn.swu-db.com/images/cards/SOR/292.png',
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
  epicAction: '',
  aspects: ['Command'],
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

  it('useHyperspace starts as false when localStorage has no value', () => {
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    expect(result.current.useHyperspace).toBe(false)
  })

  it('useHyperspace starts as true when localStorage has true', () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockImplementation((key: string) => key === 'pref_hyperspace' ? 'true' : null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    })
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    expect(result.current.useHyperspace).toBe(true)
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

  // --- Hyperspace toggle ---

  it('handleHyperspaceToggle updates useHyperspace', () => {
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    act(() => result.current.handleHyperspaceToggle(true))
    expect(result.current.useHyperspace).toBe(true)
  })

  it('handleHyperspaceToggle persists to localStorage', () => {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue(null),
      setItem,
      removeItem: vi.fn(),
      clear: vi.fn(),
    })
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    act(() => result.current.handleHyperspaceToggle(true))
    expect(setItem).toHaveBeenCalledWith('pref_hyperspace', 'true')
  })

  // --- showHyperspaceToggle ---

  it('showHyperspaceToggle is false when no base is selected', () => {
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    expect(result.current.showHyperspaceToggle).toBe(false)
  })

  it('showHyperspaceToggle is true when selected base has hyperspaceArt and no image failures', () => {
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    act(() => result.current.handleSetChange('SOR'))
    act(() => result.current.handleAspectChange('Aggression'))
    act(() => result.current.handleKeyChange('SOR-026'))
    expect(result.current.showHyperspaceToggle).toBe(true)
  })

  it('showHyperspaceToggle is false when selected base has no hyperspaceArt', () => {
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    act(() => result.current.handleSetChange('SOR'))
    act(() => result.current.handleAspectChange('Cunning'))
    act(() => result.current.handleKeyChange('SOR-022'))
    expect(result.current.showHyperspaceToggle).toBe(false)
  })

  it('showHyperspaceToggle is false after hyperspace image fails', () => {
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    act(() => result.current.handleSetChange('SOR'))
    act(() => result.current.handleAspectChange('Aggression'))
    act(() => result.current.handleKeyChange('SOR-026'))
    act(() => result.current.handleHyperspaceImageFailed())
    expect(result.current.showHyperspaceToggle).toBe(false)
  })

  it('showHyperspaceToggle is false after normal image fails', () => {
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    act(() => result.current.handleSetChange('SOR'))
    act(() => result.current.handleAspectChange('Aggression'))
    act(() => result.current.handleKeyChange('SOR-026'))
    act(() => result.current.handleNormalImageFailed())
    expect(result.current.showHyperspaceToggle).toBe(false)
  })

  // --- Image failure reset ---

  it('image failure flags reset when selected key changes', () => {
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    act(() => result.current.handleSetChange('SOR'))
    act(() => result.current.handleAspectChange('Aggression'))
    act(() => result.current.handleKeyChange('SOR-026'))
    act(() => result.current.handleNormalImageFailed())
    // Change to a different base (need Cunning for baseB)
    act(() => result.current.handleAspectChange('Cunning'))
    act(() => result.current.handleKeyChange('SOR-022'))
    // After key change, image failures should reset — showHyperspaceToggle driven by absence of hyperspaceArt, not failure flags
    expect(result.current.normalImageFailed).toBe(false)
    expect(result.current.hyperspaceImageFailed).toBe(false)
  })

  // --- handleSubmit ---

  it('handleSubmit calls onConfirm with selectedBase and useHyperspace', () => {
    const onConfirm = vi.fn()
    const { result } = renderHook(() => useSwuSetup(onConfirm))
    act(() => result.current.handleSetChange('SOR'))
    act(() => result.current.handleAspectChange('Aggression'))
    act(() => result.current.handleKeyChange('SOR-026'))
    act(() => result.current.handleSubmit())
    expect(onConfirm).toHaveBeenCalledWith(baseA, false)
  })

  it('handleSubmit does nothing when no base is selected', () => {
    const onConfirm = vi.fn()
    const { result } = renderHook(() => useSwuSetup(onConfirm))
    act(() => result.current.handleSubmit())
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('handleSubmit passes current useHyperspace value to onConfirm', () => {
    const onConfirm = vi.fn()
    const { result } = renderHook(() => useSwuSetup(onConfirm))
    act(() => result.current.handleSetChange('SOR'))
    act(() => result.current.handleAspectChange('Aggression'))
    act(() => result.current.handleKeyChange('SOR-026'))
    act(() => result.current.handleHyperspaceToggle(true))
    act(() => result.current.handleSubmit())
    expect(onConfirm).toHaveBeenCalledWith(baseA, true)
  })

})